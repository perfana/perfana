import { Injectable, Logger, NotFoundException, BadRequestException, BadGatewayException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import axios from 'axios';
import { TempoService } from '../../tempo/tempo.service';
import { validateExternalUrl } from '../../../common/security/url-validator';

const DOWNSTREAM_TIMEOUT_MS = 10_000;
import {
  TestRun,
  SystemUnderTest,
  TracingService,
  PyroscopeInstance,
  ApplicationDashboard,
  MetricsSource,
  DynatraceConfig,
  DsMetricStatistics,
} from '../../../entities';

// ─── Response shape interfaces ────────────────────────────────────────────────

interface GrafanaSourceInfo {
  available: boolean;
  instances: Array<{ id: string; label: string; url: string }>;
  dashboardCount: number;
}

interface TempoSourceInfo {
  available: boolean;
  instances: Array<{ id: string; label: string; apiUrl: string }>;
}

interface PyroscopeSourceInfo {
  available: boolean;
  instance: { id: string; label: string; backendUrl: string } | null;
  configurations: Array<{ application: string; profiler: string }>;
}

interface DynatraceSourceInfo {
  available: boolean;
  configs: Array<{ id: string; label: string; host: string }>;
}

export interface ConnectedSourcesResult {
  grafana: GrafanaSourceInfo;
  tempo: TempoSourceInfo;
  pyroscope: PyroscopeSourceInfo;
  dynatrace: DynatraceSourceInfo;
}

export interface TraceSearchResult {
  traceId: string;
  durationMs: number;
  startTimeUnixNano: string;
  spanCount: number;
  rootServiceName: string;
  rootTraceName: string;
}

export interface TraceDetailsResult {
  traceId: string;
  spans: unknown[];
  durationMs: number;
  spanCount: number;
}

export interface HotspotEntry {
  function: string;
  samples: number;
  percentage: number;
}

interface PanelSummary {
  panelId: number;
  title: string;
  metrics: Array<{
    name: string;
    min: number | null;
    max: number | null;
    avg: number | null;
    last: number | null;
  }>;
}

export interface DashboardSnapshotResult {
  dashboardName: string;
  dashboardLabel: string;
  panels: PanelSummary[];
}

export interface DynatraceProblem {
  problemId: string;
  title: string;
  status: string;
  severityLevel: string;
  startTime: string;
  endTime?: string;
  impactLevel: string;
}

// ─── Internal Pyroscope profile type ──────────────────────────────────────────

interface PyroscopeProfile {
  flamebearer: {
    names: string[];
    levels: number[][];
    numTicks: number;
    maxSelf: number;
  };
  metadata?: Record<string, unknown>;
}

// ─── Dynatrace API timeout ─────────────────────────────────────────────────────

const DYNATRACE_TIMEOUT_MS = 10_000;

@Injectable()
export class TestRunsDataSourcesService {
  private readonly logger = new Logger(TestRunsDataSourcesService.name);

  constructor(
    @InjectRepository(TestRun)
    private readonly testRunRepo: Repository<TestRun>,
    @InjectRepository(TracingService)
    private readonly tracingServiceRepo: Repository<TracingService>,
    @InjectRepository(PyroscopeInstance)
    private readonly pyroscopeInstanceRepo: Repository<PyroscopeInstance>,
    @InjectRepository(ApplicationDashboard)
    private readonly appDashboardRepo: Repository<ApplicationDashboard>,
    @InjectRepository(MetricsSource)
    private readonly metricsSourceRepo: Repository<MetricsSource>,
    @InjectRepository(DynatraceConfig)
    private readonly dynatraceConfigRepo: Repository<DynatraceConfig>,
    @InjectRepository(DsMetricStatistics)
    private readonly metricStatisticsRepo: Repository<DsMetricStatistics>,
    private readonly tempoService: TempoService,
  ) {}

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Load a TestRun with its SystemUnderTest, throwing 404 if not found.
   * Accepts either a UUID (id) or a testRunId string. When the value looks like
   * a UUID we try id first, otherwise we use testRunId.
   */
  private async loadTestRunWithSut(testRunId: string): Promise<TestRun & { systemUnderTest: SystemUnderTest }> {
    // Try to load by the string testRunId column first, then fall back to UUID id
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidPattern.test(testRunId);

    let testRun: TestRun | null = null;

    if (isUuid) {
      testRun = await withRequestEm(this.testRunRepo).findOne({
        where: { id: testRunId },
        relations: ['systemUnderTest'],
      });
    }

    // If not found by UUID (or value is not a UUID), try testRunId string
    if (!testRun) {
      testRun = await withRequestEm(this.testRunRepo).findOne({
        where: { testRunId },
        relations: ['systemUnderTest'],
      });
    }

    if (!testRun || !testRun.systemUnderTest) {
      throw new NotFoundException(`Test run not found: ${testRunId}`);
    }

    return testRun as TestRun & { systemUnderTest: SystemUnderTest };
  }

  /**
   * Find TracingService entries for a SUT. Optionally scoped by test_environment.
   * Each TracingService has an eager-loaded TracingInstance.
   */
  private async loadTracingServices(
    sutId: string,
    testEnvironment?: string,
  ): Promise<TracingService[]> {
    // Find all tracing services for this SUT, then filter.
    // Entries with empty/null test_environment apply to ALL environments.
    const all = await withRequestEm(this.tracingServiceRepo).find({
      where: { systemUnderTestId: sutId },
    });

    if (!testEnvironment) return all;

    return all.filter(
      ts => !ts.testEnvironment || ts.testEnvironment === '' || ts.testEnvironment === testEnvironment,
    );
  }

  /**
   * Fetch a flamegraph from Pyroscope and return the raw profile.
   */
  private async fetchPyroscopeFlamegraph(
    backendUrl: string,
    application: string,
    profilerLabel: string,
    fromMs: number,
    untilMs: number,
  ): Promise<PyroscopeProfile> {
    const profileTypeMap: Record<string, string> = {
      'process_cpu/cpu': 'process_cpu:cpu:nanoseconds:cpu:nanoseconds',
      'memory/alloc_in_new_tlab_bytes': 'memory:alloc_in_new_tlab_bytes:bytes:space:bytes',
      'memory/alloc_in_new_tlab_objects': 'memory:alloc_in_new_tlab_objects:count:space:bytes',
      'mutex/contentions': 'mutex:contentions:count:mutex:count',
      'mutex/delay': 'mutex:delay:nanoseconds:mutex:count',
      'block/contentions': 'block:contentions:count:block:count',
      'block/delay': 'block:delay:nanoseconds:block:count',
    };

    const profileType = profileTypeMap[profilerLabel] ?? profilerLabel;

    // Try with service_name label first. If that returns no data, fall back
    // to querying without service_name filter (JFR agents may not set this label).
    const queryWithLabel = `${profileType}{service_name="${application}"}`;
    const queryWithout = `${profileType}{}`;

    const fromSeconds = Math.floor(fromMs / 1000);
    const untilSeconds = Math.floor(untilMs / 1000);

    // Validate URL to prevent SSRF
    const urlValidation = validateExternalUrl(backendUrl);
    if (!urlValidation.isValid) {
      throw new BadRequestException(`Invalid Pyroscope URL: ${urlValidation.error}`);
    }

    const baseUrl = backendUrl.replace(/\/$/, '');

    // Try with service_name first
    let query = queryWithLabel;
    let url = `${baseUrl}/pyroscope/render?query=${encodeURIComponent(query)}&from=${fromSeconds}&until=${untilSeconds}&format=json`;

    this.logger.debug(`Fetching Pyroscope profile: ${url}`);

    let response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(DOWNSTREAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pyroscope API error ${response.status}: ${errorText}`);
    }

    // Check if the response has data. If not, retry without service_name filter
    // (JFR agents don't always set service_name as a label)
    let data = await response.json() as PyroscopeProfile;
    if (data.flamebearer?.numTicks === 0 && query !== queryWithout) {
      this.logger.debug(`No data with service_name filter, retrying without: ${queryWithout}`);
      query = queryWithout;
      url = `${baseUrl}/pyroscope/render?query=${encodeURIComponent(query)}&from=${fromSeconds}&until=${untilSeconds}&format=json`;

      response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(DOWNSTREAM_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Pyroscope API error ${response.status}: ${errorText}`);
      }

      data = await response.json() as PyroscopeProfile;
    }

    return data;
  }

  /**
   * Parse flamebearer format into a map of function name → self sample count.
   * Mirrors PyroscopeAnalysisService.parseFlamebearerToSamples.
   */
  private parseFlamebearerToSamples(profile: PyroscopeProfile): Map<string, number> {
    const { names, levels } = profile.flamebearer;
    const samples = new Map<string, number>();
    const totalIndex = names.indexOf('total');

    for (const level of levels) {
      for (let i = 0; i < level.length; i += 4) {
        const self = level[i + 2];
        const nameIndex = level[i + 3];

        if (nameIndex === totalIndex) continue;

        if (nameIndex !== undefined && self !== undefined && nameIndex < names.length && self > 0) {
          const fn = names[nameIndex];
          if (fn) {
            samples.set(fn, (samples.get(fn) ?? 0) + self);
          }
        }
      }
    }

    return samples;
  }

  /**
   * Parse flamebearer into collapsed-stack format (for getFlamegraph).
   * Returns lines of the form: "frame1;frame2;frame3 <sampleCount>"
   * This replicates the "collapsed" format that many flamegraph tools understand.
   *
   * Because the flamebearer format encodes levels (not full stacks), we reconstruct
   * approximate stacks by collecting the name of every non-zero-sample frame at each
   * depth level and joining them. For a single-run flamegraph the self-sample approach
   * (one line per leaf function) is the simplest faithful representation.
   */
  private parseFlamebearerToCollapsed(profile: PyroscopeProfile): string[] {
    const samples = this.parseFlamebearerToSamples(profile);
    const lines: string[] = [];

    for (const [fn, count] of samples) {
      lines.push(`${fn} ${count}`);
    }

    // Sort by count descending
    lines.sort((a, b) => {
      const countA = parseInt(a.split(' ').pop() ?? '0', 10);
      const countB = parseInt(b.split(' ').pop() ?? '0', 10);
      return countB - countA;
    });

    return lines;
  }

  /**
   * Validate that a traceId is a hex string. Tempo trace IDs vary in length
   * (can be shorter than 16 chars depending on the backend).
   */
  private validateTraceId(traceId: string): void {
    if (!/^[a-f0-9]+$/i.test(traceId)) {
      throw new BadRequestException(`Invalid trace ID format: ${traceId}. Expected hex characters only.`);
    }
  }

  /**
   * Sanitize a service name for use in TraceQL queries. Rejects characters
   * that could break out of a TraceQL string literal.
   */
  private sanitizeServiceName(service: string): string {
    if (/["{}\\\n\r]/.test(service)) {
      throw new BadRequestException(`Service name contains invalid characters: ${service}`);
    }
    return service;
  }

  /**
   * Validate that a test run has a start time. Throws if null/undefined.
   */
  private requireStartTime(testRun: TestRun): Date {
    if (!testRun.startTime) {
      throw new BadRequestException(`Test run ${testRun.testRunId} has no start time — cannot query time-scoped data`);
    }
    return new Date(testRun.startTime);
  }

  // ─── Public methods ───────────────────────────────────────────────────────

  /**
   * Return all data sources connected to a test run's system-under-test.
   */
  async getConnectedSources(
    testRunId: string,
    _userId: string,
    _roles: string[],
  ): Promise<ConnectedSourcesResult> {
    const testRun = await this.loadTestRunWithSut(testRunId);
    const sut = testRun.systemUnderTest;

    // ── Tracing (Tempo) ────────────────────────────────────────────────────
    const tracingServices = await this.loadTracingServices(sut.id, testRun.testEnvironment);

    const seenInstanceIds = new Set<string>();
    const tempoInstances: Array<{ id: string; label: string; apiUrl: string }> = [];

    for (const ts of tracingServices) {
      const instance = ts.tracingInstance;
      if (instance && !seenInstanceIds.has(instance.id)) {
        seenInstanceIds.add(instance.id);
        tempoInstances.push({
          id: instance.id,
          label: instance.label,
          apiUrl: instance.tracingApiUrl ?? instance.tracingUrl,
        });
      }
    }

    // ── Grafana (ApplicationDashboard) ─────────────────────────────────────
    const appDashboards = await withRequestEm(this.appDashboardRepo).find({
      where: {
        systemUnderTestId: sut.id,
        testEnvironment: testRun.testEnvironment,
      },
      relations: ['grafanaInstance'],
    });

    const seenGrafanaIds = new Set<string>();
    const grafanaInstances: Array<{ id: string; label: string; url: string }> = [];

    for (const ad of appDashboards) {
      const gi = ad.grafanaInstance;
      if (gi && !seenGrafanaIds.has(gi.id)) {
        seenGrafanaIds.add(gi.id);
        grafanaInstances.push({
          id: gi.id,
          label: gi.label,
          url: gi.client_url,
        });
      }
    }

    // ── Pyroscope ──────────────────────────────────────────────────────────
    let pyroscopeInfo: PyroscopeSourceInfo = {
      available: false,
      instance: null,
      configurations: [],
    };

    if (sut.pyroscope_instance_id) {
      const pyroInstance = await withRequestEm(this.pyroscopeInstanceRepo).findOne({
        where: { id: sut.pyroscope_instance_id },
      });

      if (pyroInstance) {
        pyroscopeInfo = {
          available: true,
          instance: {
            id: pyroInstance.id,
            label: pyroInstance.label,
            backendUrl: pyroInstance.backendUrl ?? pyroInstance.pyroscopeUrl,
          },
          configurations: sut.pyroscope_configurations ?? [],
        };
      }
    }

    // ── Dynatrace (metrics_sources → dynatrace_configs) ───────────────────
    // MetricsSource rows with source_type='dynatrace' are created automatically
    // when DynatraceQuery rows are saved, keyed by (sut, env, workload, configId).
    const dynatraceSources = await withRequestEm(this.metricsSourceRepo).find({
      where: {
        systemUnderTestId: sut.id,
        testEnvironment: testRun.testEnvironment,
        workload: testRun.workload,
        sourceType: 'dynatrace',
      },
    });

    const uniqueConfigIds = [...new Set(dynatraceSources.map(s => s.sourceConfigId).filter(Boolean))] as string[];
    const dynatraceConfigs: Array<{ id: string; label: string; host: string }> = [];

    if (uniqueConfigIds.length > 0) {
      const configs = await withRequestEm(this.dynatraceConfigRepo).findBy({ id: In(uniqueConfigIds) });
      for (const config of configs) {
        dynatraceConfigs.push({ id: config.id, label: config.label, host: config.host });
      }
    }

    return {
      grafana: {
        available: grafanaInstances.length > 0,
        instances: grafanaInstances,
        dashboardCount: appDashboards.length,
      },
      tempo: {
        available: tempoInstances.length > 0,
        instances: tempoInstances,
      },
      pyroscope: pyroscopeInfo,
      dynatrace: {
        available: dynatraceConfigs.length > 0,
        configs: dynatraceConfigs,
      },
    };
  }

  /**
   * Search Tempo for the slowest traces within the test run time window.
   *
   * Two modes:
   * - With scenario+transaction: uses TempoService.searchTraces() which filters by
   *   perfana-test-run-id and perfana-request-name span attributes (precise, same as UI)
   * - Without: does a broad time-window search with optional service filter
   */
  async getSlowTraces(
    testRunId: string,
    service: string | undefined,
    limit: number,
    _userId: string,
    _roles: string[],
    scenario?: string,
    transaction?: string,
  ): Promise<TraceSearchResult[]> {
    const testRun = await this.loadTestRunWithSut(testRunId);
    const sut = testRun.systemUnderTest;

    const tracingServices = await this.loadTracingServices(sut.id, testRun.testEnvironment);
    if (tracingServices.length === 0) {
      this.logger.debug(`No tracing services for SUT ${sut.id} / env ${testRun.testEnvironment}`);
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const instance = tracingServices[0]!.tracingInstance;
    if (!instance?.tracingApiUrl) {
      this.logger.warn(`TracingInstance ${instance?.id} has no tracingApiUrl`);
      return [];
    }

    const start = this.requireStartTime(testRun);
    const endTime = testRun.endTime ? new Date(testRun.endTime) : new Date();

    // If scenario and transaction are provided, use TempoService for precise filtering
    // via perfana-test-run-id and perfana-request-name span attributes
    if (scenario && transaction && service) {
      try {
        const result = await this.tempoService.searchTraces({
          tracingInstanceId: instance.id,
          serviceName: this.sanitizeServiceName(service),
          testRunId: testRun.testRunId,
          scenario,
          transaction,
          startTime: start.toISOString(),
          endTime: endTime.toISOString(),
          limit: Math.min(limit * 3, 100),
        });

        const traces: TraceSearchResult[] = result.traces.map(t => ({
          traceId: t.traceId,
          durationMs: t.durationMs,
          startTimeUnixNano: t.startTimeUnixNano,
          spanCount: t.spanCount,
          rootServiceName: t.rootServiceName,
          rootTraceName: t.rootTraceName ?? '',
        }));

        traces.sort((a, b) => b.durationMs - a.durationMs);
        return traces.slice(0, limit);
      } catch (err) {
        const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
        this.logger.error(`Failed to search Tempo via TempoService: ${msg}`);
        return [];
      }
    }

    // Broad time-window search (no perfana-specific attributes)
    const startSeconds = Math.floor(start.getTime() / 1000);
    const endSeconds = Math.floor(endTime.getTime() / 1000);

    const conditions: string[] = [];
    if (service) {
      conditions.push(`resource.service.name="${this.sanitizeServiceName(service)}"`);
    }
    const traceQL = conditions.length > 0 ? `{${conditions.join(' && ')}}` : undefined;

    const baseUrl = instance.tracingApiUrl.replace(/\/$/, '');
    const params = new URLSearchParams({
      start: String(startSeconds),
      end: String(endSeconds),
      limit: String(Math.min(limit * 3, 100)),
    });
    if (traceQL) params.set('q', traceQL);
    const searchUrl = `${baseUrl}/api/search?${params}`;

    this.logger.debug(`Slow traces search: ${searchUrl}`);

    try {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(DOWNSTREAM_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.error(`Tempo search failed ${response.status}: ${text}`);
        return [];
      }

      const data = await response.json() as Record<string, unknown>;
      const traces = this.parseTempoSearchResponse(data);

      traces.sort((a, b) => b.durationMs - a.durationMs);
      return traces.slice(0, limit);
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
      this.logger.error(`Failed to search Tempo for slow traces: ${msg}`);
      return [];
    }
  }

  /**
   * Search Tempo for traces with error status within the test run time window.
   */
  async getErrorTraces(
    testRunId: string,
    service: string | undefined,
    limit: number,
    _userId: string,
    _roles: string[],
    _scenario?: string,
    _transaction?: string,
  ): Promise<TraceSearchResult[]> {
    const testRun = await this.loadTestRunWithSut(testRunId);
    const sut = testRun.systemUnderTest;

    const tracingServices = await this.loadTracingServices(sut.id, testRun.testEnvironment);
    if (tracingServices.length === 0) {
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const instance = tracingServices[0]!.tracingInstance;
    if (!instance?.tracingApiUrl) {
      return [];
    }

    const start = this.requireStartTime(testRun);
    const endTime = testRun.endTime ? new Date(testRun.endTime) : new Date();

    const startSeconds = Math.floor(start.getTime() / 1000);
    const endSeconds = Math.floor(endTime.getTime() / 1000);

    const conditions: string[] = ['status = error'];
    if (service) {
      conditions.push(`resource.service.name="${this.sanitizeServiceName(service)}"`);
    }
    const traceQL = `{${conditions.join(' && ')}}`;

    const baseUrl = instance.tracingApiUrl.replace(/\/$/, '');
    const params = new URLSearchParams({
      q: traceQL,
      start: String(startSeconds),
      end: String(endSeconds),
      limit: String(limit),
    });
    const searchUrl = `${baseUrl}/api/search?${params}`;

    this.logger.debug(`Error traces search: ${searchUrl}`);

    try {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(DOWNSTREAM_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.error(`Tempo error-traces search failed ${response.status}: ${text}`);
        return [];
      }

      const data = await response.json() as Record<string, unknown>;
      return this.parseTempoSearchResponse(data);
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
      this.logger.error(`Failed to search Tempo for error traces: ${msg}`);
      return [];
    }
  }

  /**
   * Fetch full trace detail from Tempo.
   * Uses the existing TempoService which handles OTLP/Jaeger response parsing.
   */
  async getTraceDetail(
    testRunId: string,
    traceId: string,
    _userId: string,
    _roles: string[],
  ): Promise<TraceDetailsResult> {
    this.validateTraceId(traceId);

    const testRun = await this.loadTestRunWithSut(testRunId);
    const sut = testRun.systemUnderTest;

    const tracingServices = await this.loadTracingServices(sut.id, testRun.testEnvironment);
    if (tracingServices.length === 0) {
      throw new NotFoundException(`No tracing services configured for test run ${testRunId}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const instance = tracingServices[0]!.tracingInstance;
    if (!instance) {
      throw new NotFoundException(`Tracing instance has no API URL configured`);
    }

    try {
      const detail = await this.tempoService.getTraceDetails(instance.id, traceId);
      return {
        traceId: detail.traceId,
        spans: detail.spans,
        durationMs: detail.durationMs,
        spanCount: detail.spanCount,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
      throw new BadGatewayException(`Failed to fetch trace from Tempo: ${msg}`);
    }
  }

  /**
   * Fetch a flamegraph from Pyroscope and return it as collapsed-stack text.
   */
  async getFlamegraph(
    testRunId: string,
    service: string,
    detailLevel: string,
    _userId: string,
    _roles: string[],
  ): Promise<string> {
    const testRun = await this.loadTestRunWithSut(testRunId);
    const sut = testRun.systemUnderTest;

    if (!sut.pyroscope_instance_id) {
      throw new NotFoundException(`No Pyroscope instance configured for system under test "${sut.name}"`);
    }

    const pyroInstance = await withRequestEm(this.pyroscopeInstanceRepo).findOne({
      where: { id: sut.pyroscope_instance_id },
    });

    if (!pyroInstance?.backendUrl) {
      throw new NotFoundException(`Pyroscope instance has no backend URL configured`);
    }

    // Find the profiler label for this service from SUT configurations
    const configs = sut.pyroscope_configurations ?? [];
    const matchingConfig = configs.find(c => c.application === service);

    if (!matchingConfig) {
      const available = configs.map(c => c.application).join(', ');
      throw new NotFoundException(
        `No Pyroscope configuration found for service "${service}". Available: ${available || '(none)'}`,
      );
    }

    const start = this.requireStartTime(testRun);
    const fromMs = start.getTime();
    const untilMs = testRun.endTime ? new Date(testRun.endTime).getTime() : Date.now();

    const profile = await this.fetchPyroscopeFlamegraph(
      pyroInstance.backendUrl,
      matchingConfig.application,
      matchingConfig.profiler,
      fromMs,
      untilMs,
    );

    const maxStacks = detailLevel === 'summary' ? 50 : 200;
    const lines = this.parseFlamebearerToCollapsed(profile).slice(0, maxStacks);

    return lines.join('\n');
  }

  /**
   * Return the top N CPU hotspot functions from Pyroscope for a service.
   */
  async getHotspots(
    testRunId: string,
    service: string,
    limit: number,
    _userId: string,
    _roles: string[],
  ): Promise<HotspotEntry[]> {
    const testRun = await this.loadTestRunWithSut(testRunId);
    const sut = testRun.systemUnderTest;

    if (!sut.pyroscope_instance_id) {
      throw new NotFoundException(`No Pyroscope instance configured for system under test "${sut.name}"`);
    }

    const pyroInstance = await withRequestEm(this.pyroscopeInstanceRepo).findOne({
      where: { id: sut.pyroscope_instance_id },
    });

    if (!pyroInstance?.backendUrl) {
      throw new NotFoundException(`Pyroscope instance has no backend URL configured`);
    }

    const configs = sut.pyroscope_configurations ?? [];
    const matchingConfig = configs.find(c => c.application === service) ?? configs[0];

    if (!matchingConfig) {
      throw new NotFoundException(`No Pyroscope configuration found for service "${service}"`);
    }

    const fromMs = testRun.startTime ? new Date(testRun.startTime).getTime() : Date.now() - 3_600_000;
    const untilMs = testRun.endTime ? new Date(testRun.endTime).getTime() : Date.now();

    const profile = await this.fetchPyroscopeFlamegraph(
      pyroInstance.backendUrl,
      matchingConfig.application,
      matchingConfig.profiler,
      fromMs,
      untilMs,
    );

    const samples = this.parseFlamebearerToSamples(profile);
    const totalSamples = Array.from(samples.values()).reduce((a, b) => a + b, 0);

    const hotspots: HotspotEntry[] = Array.from(samples.entries())
      .map(([fn, count]) => ({
        function: fn,
        samples: count,
        percentage: totalSamples > 0 ? (count / totalSamples) * 100 : 0,
      }))
      .sort((a, b) => b.samples - a.samples)
      .slice(0, limit);

    return hotspots;
  }

  /**
   * Return aggregated metric statistics for all panels of a named dashboard
   * for this test run, sourced from ds_metric_statistics.
   */
  async getDashboardSnapshot(
    testRunId: string,
    dashboard: string,
    _userId: string,
    _roles: string[],
  ): Promise<DashboardSnapshotResult> {
    const testRun = await this.loadTestRunWithSut(testRunId);
    const sut = testRun.systemUnderTest;

    // Find the ApplicationDashboard matching by label or name
    const appDashboards = await withRequestEm(this.appDashboardRepo).find({
      where: {
        systemUnderTestId: sut.id,
        testEnvironment: testRun.testEnvironment,
      },
    });

    const matchingDashboard = appDashboards.find(
      ad =>
        ad.dashboardLabel === dashboard ||
        ad.dashboardName === dashboard ||
        ad.dashboardUid === dashboard,
    );

    if (!matchingDashboard) {
      throw new NotFoundException(
        `Dashboard "${dashboard}" not found for test run ${testRunId}`,
      );
    }

    // Load metric statistics for this test run and dashboard
    const statistics = await this.metricStatisticsRepo.find({
      where: {
        test_run_id: testRun.testRunId,
        application_dashboard_id: matchingDashboard.id,
      },
      select: [
        'panel_id',
        'panel_title',
        'metric_name',
        'min_value',
        'max_value',
        'mean',
        'last_value',
      ],
    });

    // Group by panel
    const panelMap = new Map<number, PanelSummary>();

    for (const stat of statistics) {
      const panelId = stat.panel_id;
      const panelTitle = stat.panel_title ?? `Panel ${panelId}`;

      if (!panelMap.has(panelId)) {
        panelMap.set(panelId, { panelId, title: panelTitle, metrics: [] });
      }

      panelMap.get(panelId)!.metrics.push({
        name: stat.metric_name ?? 'unknown',
        min: stat.min_value ?? null,
        max: stat.max_value ?? null,
        avg: stat.mean ?? null,
        last: stat.last_value ?? null,
      });
    }

    return {
      dashboardName: matchingDashboard.dashboardName,
      dashboardLabel: matchingDashboard.dashboardLabel,
      panels: Array.from(panelMap.values()),
    };
  }

  /**
   * Fetch all Dynatrace problems for the test run time window.
   */
  async getDynatraceProblems(
    testRunId: string,
    _userId: string,
    _roles: string[],
  ): Promise<DynatraceProblem[]> {
    const testRun = await this.loadTestRunWithSut(testRunId);
    const sut = testRun.systemUnderTest;

    const dynatraceSources = await withRequestEm(this.metricsSourceRepo).find({
      where: {
        systemUnderTestId: sut.id,
        sourceType: 'dynatrace',
        testEnvironment: testRun.testEnvironment,
      },
    });

    if (dynatraceSources.length === 0) {
      this.logger.debug(`No Dynatrace sources for SUT ${sut.id}`);
      return [];
    }

    const startTime = testRun.startTime ?? new Date(Date.now() - 3_600_000);
    const endTime = testRun.endTime ?? new Date();

    const allProblems: DynatraceProblem[] = [];

    for (const source of dynatraceSources) {
      if (!source.sourceConfigId) continue;

      const config = await withRequestEm(this.dynatraceConfigRepo).findOne({
        where: { id: source.sourceConfigId },
      });

      if (!config) continue;

      try {
        // Validate URL to prevent SSRF
        const urlValidation = validateExternalUrl(config.host);
        if (!urlValidation.isValid) {
          this.logger.warn(`Skipping Dynatrace source ${source.sourceConfigId}: ${urlValidation.error}`);
          continue;
        }

        const baseUrl = config.host.replace(/\/+$/, '');
        const from = startTime.toISOString();
        const to = endTime.toISOString();

        const response = await axios.get(`${baseUrl}/api/v2/problems`, {
          headers: {
            Authorization: `Api-Token ${config.apiToken}`,
            'Content-Type': 'application/json',
          },
          params: { from, to },
          timeout: DYNATRACE_TIMEOUT_MS,
        });

        const problems: DynatraceProblem[] = (response.data?.problems ?? []).map((p: Record<string, unknown>) => ({
          problemId: p.problemId as string,
          title: p.title as string,
          status: p.status as string,
          severityLevel: p.severityLevel as string,
          startTime: new Date(p.startTime as string | number).toISOString(),
          endTime: p.endTime ? new Date(p.endTime as string | number).toISOString() : undefined,
          impactLevel: p.impactLevel as string,
        }));

        allProblems.push(...problems);
      } catch (err) {
        const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
        this.logger.error(`Failed to fetch Dynatrace problems from config ${config.id}: ${msg}`);
        // Continue with other configs instead of failing the whole request
      }
    }

    return allProblems;
  }

  // ─── Tempo response parsers ───────────────────────────────────────────────

  private parseTempoSearchResponse(data: Record<string, unknown>): TraceSearchResult[] {
    const results: TraceSearchResult[] = [];
    const traceList = (data.traces as unknown[]) ?? (data.batches as unknown[]) ?? [];

    for (const trace of traceList) {
      const t = trace as Record<string, unknown>;
      const traceId = (t.traceID ?? t.traceId) as string | undefined;
      if (!traceId) continue;

      let durationMs = 0;
      if (typeof t.durationMs === 'number') {
        durationMs = t.durationMs;
      } else if (typeof t.durationNanos === 'number') {
        durationMs = t.durationNanos / 1_000_000;
      } else if (typeof t.duration === 'number') {
        durationMs = t.duration > 1_000_000_000 ? t.duration / 1_000_000 : t.duration;
      }

      results.push({
        traceId,
        durationMs,
        startTimeUnixNano: String((t.startTimeUnixNano ?? t.startTime ?? '0') as string),
        spanCount: (t.spanCount as number) ?? 0,
        rootServiceName: String((t.rootServiceName ?? t.serviceName ?? '') as string),
        rootTraceName: String((t.rootTraceName ?? t.name ?? '') as string),
      });
    }

    // Sort by durationMs descending (slowest first)
    results.sort((a, b) => b.durationMs - a.durationMs);

    return results;
  }

}
