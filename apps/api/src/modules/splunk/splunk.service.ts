import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { OwnedResource } from '@perfana/shared';
import {
  buildEntitiesClause,
  scopeSplFilter,
  buildTimechartSearch,
  validateSplFilter,
  splunkDiscoverSources,
  splunkFieldSummary,
  splunkServerInfo,
  splunkTimechart,
  timechartTimeRange,
  explainEmptyTimechart,
  ExportStats,
  SplunkConnection,
  SplunkDiscoveredSource,
  SplunkError,
  hostForLog,
  SplunkRequestOptions,
} from '@perfana/shared/services/splunk/client';
import { MetricsSource, SplunkConfig, SplunkEntityMapping, SplunkQuery, SystemUnderTest, TestRun } from '../../entities';
import { withRequestEm, withRequestQuery } from '../../common/db/request-em';
import { generateDeterministicUuid } from '../../utils/uuid-generator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { validateExternalUrl } from '../../common/security/url-validator';
import { Capability } from '../../constants/capabilities.constants';
import { AuditService } from '../audit/audit.service';
import { ProxyResolverService } from '../proxy/proxy-resolver.service';
import {
  CopySplunkEntityMappingsDto,
  CreateSplunkConfigDto,
  CreateSplunkEntityMappingDto,
  CreateSplunkQueryDto,
  PreviewSplunkQueryDto,
  TestSplunkConnectionDto,
  UpdateSplunkConfigDto,
  UpdateSplunkQueryDto,
} from './dto/splunk.dto';

const MASK = '[MASKED]';
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

/** The starter panels from the spec, created per scope by POST /splunk/queries/starter. */
export const STARTER_PANELS = [
  { panelTitle: 'Log events by level', spl: '$entities', splitBy: 'log_level' },
  { panelTitle: 'Errors by host', spl: '$entities log_level=ERROR', splitBy: 'host' },
  {
    panelTitle: 'Exceptions by type',
    spl: '$entities "Exception" | rex "(?<exception>[A-Za-z0-9_.]+Exception)"',
    splitBy: 'exception',
  },
] as const;

export type MaskedSplunkConfig = Omit<SplunkConfig, 'apiToken' | 'password'> & { apiToken: string | null; password: string | null };

export interface ScopeRef {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
}

const errMsg = (err: unknown): string =>
  err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';

/**
 * Splunk configs, entity mappings and queries. Spec: docs/reference/Features/Splunk Log Metrics (spec).md.
 *
 * Authorization: configs are org-owned (integration:splunk:* capabilities). Mappings and queries
 * belong to a system under test and inherit its organization; the config they use must belong to
 * that same organization, so one tenant can never point its system at another tenant's Splunk
 * credentials. Every resource outside the caller's organizations is a 404, never a 403.
 */
@Injectable()
export class SplunkService {
  private readonly logger = new Logger(SplunkService.name);
  // ponytail: per-process cache; discovery is cheap to redo and per-config, so no Redis.
  private readonly discoveryCache = new Map<string, { at: number; sources: SplunkDiscoveredSource[] }>();

  constructor(
    @InjectRepository(SplunkConfig) private readonly configRepo: Repository<SplunkConfig>,
    @InjectRepository(SplunkEntityMapping) private readonly mappingRepo: Repository<SplunkEntityMapping>,
    @InjectRepository(SplunkQuery) private readonly queryRepo: Repository<SplunkQuery>,
    @InjectRepository(SystemUnderTest) private readonly sutRepo: Repository<SystemUnderTest>,
    @InjectRepository(MetricsSource) private readonly metricsSourceRepo: Repository<MetricsSource>,
    @InjectRepository(TestRun) private readonly testRunRepo: Repository<TestRun>,
    private readonly dataSource: DataSource,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly proxyResolver: ProxyResolverService,
  ) {}

  // ---------------------------------------------------------------------------
  // Configs
  // ---------------------------------------------------------------------------

  async listConfigs(userId: string, roles: string[]): Promise<MaskedSplunkConfig[]> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    if (orgIds !== null && orgIds.length === 0) return [];
    const qb = withRequestEm(this.configRepo).createQueryBuilder('c').orderBy('c.label', 'ASC');
    if (orgIds !== null) qb.where('c.organization_id IN (:...orgIds)', { orgIds });
    return (await qb.getMany()).map((c) => this.mask(c));
  }

  async getConfig(id: string, userId: string, roles: string[]): Promise<MaskedSplunkConfig> {
    return this.mask(await this.loadConfig(id, userId, roles));
  }

  async createConfig(dto: CreateSplunkConfigDto, userId: string, roles: string[]): Promise<MaskedSplunkConfig> {
    const organizationId = dto.organizationId ?? (await this.authzService.getAccessibleOrganizations(userId))[0];
    if (!organizationId) throw new ForbiddenException('User has no accessible organization');
    await this.requireCapability(userId, roles, organizationId, Capability.IntegrationSplunkCreate);

    const entity = this.configRepo.create({
      label: dto.label,
      host: this.checkHost(dto.host),
      clientUrl: dto.clientUrl || null,
      apiToken: dto.apiToken?.trim() || null,
      username: dto.username?.trim() || null,
      password: dto.password || null,
      splunkApp: dto.splunkApp ?? 'search',
      verifyTls: dto.verifyTls ?? true,
      useProxy: dto.useProxy ?? false,
      maxConcurrentSearches: dto.maxConcurrentSearches ?? 2,
      organizationId,
      createdBy: userId,
      updatedBy: userId,
    });
    this.requireCredentials(entity);
    const saved = await withRequestEm(this.configRepo).save(entity);
    this.auditService.logCreate(saved as unknown as OwnedResource, { organizationIdOverride: saved.organizationId });
    return this.mask(saved);
  }

  async updateConfig(id: string, dto: UpdateSplunkConfigDto, userId: string, roles: string[]): Promise<MaskedSplunkConfig> {
    const entity = await this.loadConfig(id, userId, roles);
    await this.requireCapability(userId, roles, entity.organizationId, Capability.IntegrationSplunkUpdate);
    const before = Object.assign(new SplunkConfig(), entity);

    if (dto.label !== undefined) entity.label = dto.label;
    if (dto.host !== undefined) {
      const host = this.checkHost(dto.host);
      if (host !== entity.host) {
        // Never send stored credentials to a host they were not entered for.
        const freshToken = !!dto.apiToken && dto.apiToken !== MASK;
        const freshPassword = !!dto.password && dto.password !== MASK;
        if (!freshToken && !freshPassword) {
          throw new BadRequestException('Changing the Splunk URL needs the token (or password) entered again');
        }
        if (!freshToken) entity.apiToken = null;
        if (!freshPassword) entity.password = null;
      }
      entity.host = host;
    }
    // null and '' both clear; an absent key leaves the stored value (Dynatrace client_url rule).
    if (dto.clientUrl !== undefined) entity.clientUrl = dto.clientUrl || null;
    // A masked value echoed back by a GET-then-PATCH client means "unchanged".
    if (dto.apiToken !== undefined && dto.apiToken !== MASK) entity.apiToken = dto.apiToken?.trim() || null;
    if (dto.username !== undefined) entity.username = dto.username?.trim() || null;
    if (dto.password !== undefined && dto.password !== MASK) entity.password = dto.password || null;
    if (dto.splunkApp !== undefined) entity.splunkApp = dto.splunkApp;
    if (dto.verifyTls !== undefined) entity.verifyTls = dto.verifyTls;
    if (dto.useProxy !== undefined) entity.useProxy = dto.useProxy;
    if (dto.maxConcurrentSearches !== undefined) entity.maxConcurrentSearches = dto.maxConcurrentSearches;
    this.requireCredentials(entity);
    entity.updatedBy = userId;

    const saved = await withRequestEm(this.configRepo).save(entity);
    this.clearDiscoveryCache(id);
    this.auditService.logUpdate(before as unknown as OwnedResource, saved as unknown as OwnedResource, {
      organizationIdOverride: saved.organizationId,
    });
    return this.mask(saved);
  }

  /** Cascades to the config's mappings and queries (FK ON DELETE CASCADE). */
  async deleteConfig(id: string, userId: string, roles: string[]): Promise<void> {
    const entity = await this.loadConfig(id, userId, roles);
    await this.requireCapability(userId, roles, entity.organizationId, Capability.IntegrationSplunkDelete);
    await withRequestEm(this.configRepo).delete({ id });
    this.clearDiscoveryCache(id);
    this.auditService.logDelete(entity as unknown as OwnedResource, { organizationIdOverride: entity.organizationId });
  }

  /** Test unsaved settings. The proxy, if asked for, is the target organization's. */
  async testConnection(dto: TestSplunkConnectionDto, userId: string, roles: string[]) {
    const organizationId = dto.organizationId ?? (await this.authzService.getAccessibleOrganizations(userId))[0];
    if (!organizationId) throw new ForbiddenException('User has no accessible organization');
    await this.requireCapability(userId, roles, organizationId, Capability.IntegrationSplunkCreate);
    const conn: SplunkConnection = { host: this.checkHost(dto.host), apiToken: dto.apiToken, username: dto.username, password: dto.password };
    return this.probe(conn, await this.requestOptions(organizationId, dto.useProxy ?? false));
  }

  async testSavedConnection(id: string, userId: string, roles: string[]) {
    const config = await this.loadConfig(id, userId, roles);
    await this.requireCapability(userId, roles, config.organizationId, Capability.IntegrationSplunkUpdate);
    return this.probe(this.connectionOf(config), await this.requestOptions(config.organizationId, config.useProxy));
  }

  /** Entries are keyed `${id}:${hours}`, so a bare delete(id) would match nothing. */
  private clearDiscoveryCache(id: string): void {
    for (const key of this.discoveryCache.keys()) {
      if (key.startsWith(`${id}:`)) this.discoveryCache.delete(key);
    }
  }

  async discoverSources(id: string, userId: string, roles: string[], hours = 24, refresh = false): Promise<SplunkDiscoveredSource[]> {
    const config = await this.loadConfig(id, userId, roles);
    // Lists every index, sourcetype and host the token can see: a configuration action, not a read.
    await this.requireCapability(userId, roles, config.organizationId, Capability.IntegrationSplunkUpdate);
    const key = `${id}:${hours}`;
    const cached = this.discoveryCache.get(key);
    if (!refresh && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.sources;
    try {
      const sources = await splunkDiscoverSources(this.connectionOf(config), hours, await this.requestOptions(config.organizationId, config.useProxy));
      this.discoveryCache.set(key, { at: Date.now(), sources });
      return sources;
    } catch (err) {
      throw this.toHttp(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Entity mappings
  // ---------------------------------------------------------------------------

  /**
   * Mappings for a system. With environment (and workload) given, returns exactly the mappings a
   * run in that scope uses: system-level, plus that environment's, plus that workload's.
   */
  async listMappings(systemUnderTestId: string, userId: string, roles: string[], testEnvironment?: string, workload?: string) {
    await this.loadSut(systemUnderTestId, userId, roles, 'read');
    return this.mappingsInScope(systemUnderTestId, testEnvironment, workload);
  }

  async createMapping(dto: CreateSplunkEntityMappingDto, userId: string, roles: string[]): Promise<SplunkEntityMapping> {
    const sut = await this.loadSut(dto.systemUnderTestId, userId, roles, 'write');
    await this.requireSameOrgConfig(dto.splunkConfigId, sut, userId, roles);
    const scope = this.levelScope(dto.level, dto.testEnvironment, dto.workload);
    if (!dto.sourcetype?.trim() && !dto.hostPattern?.trim() && dto.indexName.trim() === '*') {
      throw new BadRequestException('A mapping of every index with no sourcetype or host would read all of Splunk');
    }

    const entity = this.mappingRepo.create({
      splunkConfigId: dto.splunkConfigId,
      systemUnderTestId: sut.id,
      level: dto.level,
      ...scope,
      indexName: dto.indexName.trim(),
      sourcetype: dto.sourcetype?.trim() || null,
      hostPattern: dto.hostPattern?.trim() || null,
      labels: dto.labels ?? [],
      organizationId: sut.organization_id,
      teamId: sut.team_id,
      createdBy: userId,
      updatedBy: userId,
    });
    const saved = await this.saveUnique(this.mappingRepo, entity, 'This Splunk source is already mapped at that level');
    this.auditService.logCreate(saved as unknown as OwnedResource, { organizationIdOverride: saved.organizationId });
    return saved;
  }

  async deleteMapping(id: string, userId: string, roles: string[]): Promise<void> {
    const mapping = await withRequestEm(this.mappingRepo).findOne({ where: { id } });
    if (!mapping) throw new NotFoundException('Splunk entity mapping not found');
    await this.loadSut(mapping.systemUnderTestId, userId, roles, 'write', 'Splunk entity mapping not found');
    await withRequestEm(this.mappingRepo).delete({ id });
    this.auditService.logDelete(mapping as unknown as OwnedResource, { organizationIdOverride: mapping.organizationId });
  }

  /** Copy mappings to another environment/workload of the SAME system, each keeping its level. */
  async copyMappings(dto: CopySplunkEntityMappingsDto, userId: string, roles: string[]) {
    let copied = 0;
    let skipped = 0;
    for (const id of dto.mappingIds) {
      const source = await withRequestEm(this.mappingRepo).findOne({ where: { id } });
      if (!source) throw new NotFoundException('Splunk entity mapping not found');
      // Authorize before any skip branch, or another tenant's id answers {skipped:1} instead of a 404.
      await this.loadSut(source.systemUnderTestId, userId, roles, 'write', 'Splunk entity mapping not found');
      if (source.level === 'sut') {
        skipped++; // already applies to every environment and workload
        continue;
      }
      const workload = source.level === 'workload' ? dto.targetWorkload ?? source.workload ?? null : null;
      // Probe instead of catching 23505: a unique violation aborts the request's RLS transaction
      // (25P02), and every later statement in this loop would then fail.
      const exists = await withRequestEm(this.mappingRepo).findOne({
        where: {
          systemUnderTestId: source.systemUnderTestId,
          splunkConfigId: source.splunkConfigId,
          testEnvironment: dto.targetEnvironment,
          workload: workload ?? IsNull(),
          indexName: source.indexName,
          sourcetype: source.sourcetype ?? IsNull(),
          hostPattern: source.hostPattern ?? IsNull(),
        },
      });
      if (exists) {
        skipped++;
        continue;
      }
      await this.createMapping(
        {
          splunkConfigId: source.splunkConfigId,
          systemUnderTestId: source.systemUnderTestId,
          level: source.level,
          testEnvironment: dto.targetEnvironment,
          workload,
          indexName: source.indexName,
          sourcetype: source.sourcetype,
          hostPattern: source.hostPattern,
          labels: source.labels,
        },
        userId,
        roles,
      );
      copied++;
    }
    return { copied, skipped };
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async listQueries(scope: ScopeRef, userId: string, roles: string[]): Promise<SplunkQuery[]> {
    await this.loadSut(scope.systemUnderTestId, userId, roles, 'read');
    return withRequestEm(this.queryRepo).find({
      where: { systemUnderTestId: scope.systemUnderTestId, testEnvironment: scope.testEnvironment, workload: scope.workload },
      order: { dashboardLabel: 'ASC', panelId: 'ASC' },
    });
  }

  async createQuery(dto: CreateSplunkQueryDto, userId: string, roles: string[]): Promise<SplunkQuery> {
    const sut = await this.loadSut(dto.systemUnderTestId, userId, roles, 'write');
    const config = await this.requireSameOrgConfig(dto.splunkConfigId, sut, userId, roles);
    this.checkSpl(dto.spl);
    const dashboardLabel = dto.dashboardLabel?.trim() || 'Splunk logs';
    const panelId = dto.panelId ?? (await this.nextPanelId(dto, dashboardLabel));
    const { applicationDashboardId, metricsSourceId } = await this.ensureArtificialDashboard(sut, dto, dashboardLabel, config);

    const entity = this.queryRepo.create({
      splunkConfigId: dto.splunkConfigId,
      systemUnderTestId: sut.id,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      dashboardLabel,
      applicationDashboardId,
      metricsSourceId,
      panelTitle: dto.panelTitle,
      panelId,
      spl: dto.spl,
      splitBy: dto.splitBy || null,
      aggregation: dto.aggregation?.trim() || 'count',
      metricUnit: dto.metricUnit || 'short',
      maxSeries: dto.maxSeries ?? 20,
      enabled: dto.enabled ?? true,
      organizationId: sut.organization_id,
      teamId: sut.team_id,
      createdBy: userId,
      updatedBy: userId,
    });
    const saved = await this.saveUnique(this.queryRepo, entity, `Panel ${panelId} already exists on "${dashboardLabel}" for this workload`);
    this.auditService.logCreate(saved as unknown as OwnedResource, { organizationIdOverride: saved.organizationId });
    return saved;
  }

  /** The spec's three starter panels for a scope; an existing panel title is left alone. */
  async createStarterQueries(scope: ScopeRef & { splunkConfigId: string; levelField?: string }, userId: string, roles: string[]) {
    const existing = await this.listQueries(scope, userId, roles);
    const titles = new Set(existing.map((q) => q.panelTitle));
    const levelField = scope.levelField?.trim() || 'log_level';
    if (!/^[A-Za-z_][\w.]*$/.test(levelField)) throw new BadRequestException(`Invalid field name: ${levelField}`);
    const created: SplunkQuery[] = [];
    for (const p of STARTER_PANELS) {
      if (titles.has(p.panelTitle)) continue;
      created.push(
        await this.createQuery(
          {
            ...scope,
            panelTitle: p.panelTitle,
            spl: p.spl.replace('log_level', levelField),
            splitBy: p.splitBy === 'log_level' ? levelField : p.splitBy,
          },
          userId,
          roles,
        ),
      );
    }
    return created;
  }

  async updateQuery(id: string, dto: UpdateSplunkQueryDto, userId: string, roles: string[]): Promise<SplunkQuery> {
    const entity = await this.loadQuery(id, userId, roles);
    const before = Object.assign(new SplunkQuery(), entity);
    if (dto.spl !== undefined) {
      this.checkSpl(dto.spl);
      entity.spl = dto.spl;
    }
    if (dto.panelTitle !== undefined) entity.panelTitle = dto.panelTitle;
    if (dto.panelId !== undefined) entity.panelId = dto.panelId;
    if (dto.splitBy !== undefined) entity.splitBy = dto.splitBy || null;
    if (dto.aggregation !== undefined) entity.aggregation = dto.aggregation.trim() || 'count';
    if (dto.metricUnit !== undefined) entity.metricUnit = dto.metricUnit || 'short';
    if (dto.maxSeries !== undefined) entity.maxSeries = dto.maxSeries;
    if (dto.enabled !== undefined) entity.enabled = dto.enabled;
    entity.updatedBy = userId;
    const saved = await this.saveUnique(this.queryRepo, entity, `Panel ${entity.panelId} already exists on "${entity.dashboardLabel}" for this workload`);
    this.auditService.logUpdate(before as unknown as OwnedResource, saved as unknown as OwnedResource, {
      organizationIdOverride: saved.organizationId,
    });
    return saved;
  }

  async deleteQuery(id: string, userId: string, roles: string[]): Promise<void> {
    const entity = await this.loadQuery(id, userId, roles);
    await withRequestEm(this.queryRepo).delete({ id });
    this.auditService.logDelete(entity as unknown as OwnedResource, { organizationIdOverride: entity.organizationId });
  }

  /**
   * Run an unsaved query over the last N minutes for a scope: the series it produces, a few
   * totals, and candidate split fields. This is what the editor shows before saving.
   */
  async previewQuery(dto: PreviewSplunkQueryDto, userId: string, roles: string[]) {
    // Write, not read: a preview runs caller-chosen SPL with the organization's token, so it is
    // as privileged as saving the query.
    const sut = await this.loadSut(dto.systemUnderTestId, userId, roles, 'write');
    const config = await this.requireSameOrgConfig(dto.splunkConfigId, sut, userId, roles);
    this.checkSpl(dto.spl);
    const mappings = await this.mappingsInScope(sut.id, dto.testEnvironment, dto.workload, dto.splunkConfigId);
    const filter = scopeSplFilter(dto.spl, mappings);
    if (filter === null) {
      return { search: null, series: [], fields: [], message: 'No Splunk sources are mapped for this scope, so $entities is empty.' };
    }
    const minutes = dto.minutes ?? 60;
    const to = new Date();
    const from = new Date(to.getTime() - minutes * 60_000);
    const bucketSeconds = Math.max(5, Math.ceil((minutes * 60) / 120));
    const conn = this.connectionOf(config);
    const opts = await this.requestOptions(config.organizationId, config.useProxy);
    try {
      let stats: ExportStats | undefined;
      const [points, fields] = await Promise.all([
        splunkTimechart(conn, { filter, from, to, bucketSeconds, aggregation: dto.aggregation, splitBy: dto.splitBy, maxSeries: dto.maxSeries }, {
          ...opts,
          onSearch: (search, st, ms) => {
            stats = st;
            this.logger.debug(
              `Splunk preview search (${ms}ms, ${st.lines} lines, ${st.finalRows} final rows, ${st.previewRows} preview rows${st.usedPreview ? ', used last preview set' : ''}, columns ${st.columns.join(',')}): ${search}`,
            );
          },
        }),
        // Candidate split fields come from the mapped sources themselves, not the user's filter:
        // fields a rex/eval in the filter creates are known to whoever wrote it.
        splunkFieldSummary(conn, buildEntitiesClause(mappings) ?? filter, opts),
      ]);
      const totals = new Map<string, number>();
      for (const p of points) totals.set(p.series, (totals.get(p.series) ?? 0) + p.value);
      return {
        search: filter,
        bucketSeconds,
        series: [...totals.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
        points: points.length,
        fields,
        ...(points.length === 0 ? { message: explainEmptyTimechart(stats, dto.splitBy) ?? undefined } : {}),
      };
    } catch (err) {
      throw this.toHttp(err);
    }
  }

  /** The filter `$entities` expands to for a scope — used by the run page's "Open in Splunk" link. */
  async entitiesFilter(scope: ScopeRef, userId: string, roles: string[]): Promise<{ filter: string | null }> {
    await this.loadSut(scope.systemUnderTestId, userId, roles, 'read');
    const mappings = await this.mappingsInScope(scope.systemUnderTestId, scope.testEnvironment, scope.workload);
    return { filter: buildEntitiesClause(mappings) };
  }

  /**
   * Everything the test run page's Splunk card shows, in one request: the sources in effect for
   * the run, each panel's series with total events and peak bucket (from the statistics the
   * analysis computed, so nothing is asked of Splunk), and "Open in Splunk" links for the run
   * window. `configured` is false when the run's workload has no Splunk panel, so the card hides.
   */
  async runSummary(testRunId: string, userId: string, roles: string[]) {
    const run = await withRequestEm(this.testRunRepo).findOne({ where: { testRunId } });
    if (!run) throw new NotFoundException('Test run not found');
    // The run is reached through its system, the same authority as every other Splunk route.
    await this.loadSut(run.systemUnderTestId, userId, roles, 'read', 'Test run not found');

    const scope = { systemUnderTestId: run.systemUnderTestId, testEnvironment: run.testEnvironment, workload: run.workload };
    const queries = (await withRequestEm(this.queryRepo).find({ where: scope, order: { panelId: 'ASC' } })).filter((q) => q.enabled);
    if (queries.length === 0) return { configured: false as const };

    const mappings = await this.mappingsInScope(scope.systemUnderTestId, scope.testEnvironment, scope.workload);
    const configIds = [...new Set(queries.map((q) => q.splunkConfigId))];
    const configs = await withRequestEm(this.configRepo).find({ where: configIds.map((id) => ({ id })) });
    const configById = new Map(configs.map((c) => [c.id, c]));

    const dashboardIds = [...new Set(queries.map((q) => q.applicationDashboardId).filter((id): id is string => !!id))];
    const stats = dashboardIds.length === 0
      ? []
      : await withRequestQuery(this.dataSource).query<Array<{
          application_dashboard_id: string; panel_id: number; metric_name: string; mean: number | null; max_value: number | null; count: number | null;
        }>>(
          `SELECT application_dashboard_id, panel_id, metric_name, mean, max_value, count
             FROM ds_metric_statistics
            WHERE test_run_id = $1 AND application_dashboard_id = ANY($2::uuid[])`,
          [run.testRunId, dashboardIds],
        );

    const start = run.startTime ? new Date(run.startTime) : null;
    const end = run.endTime ? new Date(run.endTime) : new Date();
    const webLink = (config: SplunkConfig | undefined, search: string): string | null => {
      if (!config || !start) return null;
      const base = (config.clientUrl || config.host).replace(/\/+$/, '');
      // The same window the collector sends as earliest_time/latest_time.
      const { earliestTime, latestTime } = timechartTimeRange({ from: start, to: end });
      const params = new URLSearchParams({ q: search, earliest: earliestTime, latest: latestTime });
      return `${base}/en-US/app/${encodeURIComponent(config.splunkApp || 'search')}/search?${params}`;
    };

    const panels = queries.map((q) => {
      const config = configById.get(q.splunkConfigId);
      const configMappings = mappings.filter((m) => m.splunkConfigId === q.splunkConfigId);
      const filter = scopeSplFilter(q.spl, configMappings, run.testRunId);
      let link: string | null = null;
      if (filter && start) {
        try {
          // The same search the collector ran, as a Splunk Web timechart over the run.
          link = webLink(config, buildTimechartSearch({
            filter, from: start, to: end, bucketSeconds: 60, aggregation: q.aggregation, splitBy: q.splitBy, maxSeries: q.maxSeries,
          }));
        } catch {
          link = null;
        }
      }
      const series = stats
        .filter((st) => st.application_dashboard_id === q.applicationDashboardId && st.panel_id === q.panelId)
        .map((st) => ({
          name: st.metric_name,
          mean: st.mean,
          peak: st.max_value,
          // For a count panel the mean per bucket times the buckets is the events in the window.
          total: q.aggregation === 'count' && st.mean !== null && st.count !== null ? Math.round(st.mean * st.count) : null,
        }))
        .sort((a, b) => (b.total ?? b.mean ?? 0) - (a.total ?? a.mean ?? 0));
      return { panelId: q.panelId, title: q.panelTitle, aggregation: q.aggregation, splitBy: q.splitBy, unit: q.metricUnit, series, link };
    });

    const firstConfig = configById.get(queries[0]!.splunkConfigId);
    const allClause = buildEntitiesClause(mappings.filter((m) => m.splunkConfigId === firstConfig?.id));
    return {
      configured: true as const,
      connection: firstConfig ? { id: firstConfig.id, label: firstConfig.label } : null,
      sources: mappings.map((m) => ({ id: m.id, level: m.level, indexName: m.indexName, sourcetype: m.sourcetype, hostPattern: m.hostPattern, labels: m.labels })),
      openInSplunk: allClause ? webLink(firstConfig, `search ${allClause}`) : null,
      window: start ? { from: start.toISOString(), to: end.toISOString() } : null,
      panels,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async mappingsInScope(systemUnderTestId: string, testEnvironment?: string, workload?: string, splunkConfigId?: string) {
    const qb = withRequestEm(this.mappingRepo)
      .createQueryBuilder('m')
      .where('m.system_under_test_id = :systemUnderTestId', { systemUnderTestId })
      .orderBy('m.index_name', 'ASC');
    if (splunkConfigId) qb.andWhere('m.splunk_config_id = :splunkConfigId', { splunkConfigId });
    if (testEnvironment !== undefined) {
      qb.andWhere(
        `(m.level = 'sut'
          OR (m.level = 'environment' AND m.test_environment = :testEnvironment)
          OR (m.level = 'workload' AND m.test_environment = :testEnvironment AND m.workload = :workload))`,
        { testEnvironment, workload: workload ?? '' },
      );
    }
    return qb.getMany();
  }

  private levelScope(level: string, testEnvironment?: string | null, workload?: string | null) {
    const env = testEnvironment?.trim() || null;
    const wl = workload?.trim() || null;
    if (level === 'sut') return { testEnvironment: null, workload: null };
    if (!env) throw new BadRequestException(`A ${level}-level mapping needs a test environment`);
    if (level === 'environment') return { testEnvironment: env, workload: null };
    if (!wl) throw new BadRequestException('A workload-level mapping needs a workload');
    return { testEnvironment: env, workload: wl };
  }

  private async nextPanelId(scope: ScopeRef, dashboardLabel: string): Promise<number> {
    const row = await withRequestEm(this.queryRepo)
      .createQueryBuilder('q')
      .select('COALESCE(MAX(q.panel_id), 0)', 'max')
      .where('q.system_under_test_id = :s AND q.test_environment = :e AND q.workload = :w AND q.dashboard_label = :d', {
        s: scope.systemUnderTestId,
        e: scope.testEnvironment,
        w: scope.workload,
        d: dashboardLabel,
      })
      .getRawOne<{ max: string | number }>();
    return Number(row?.max ?? 0) + 1;
  }

  /**
   * The rows a Splunk panel's ds_metrics hang off, like a Dynatrace query's: a synthetic
   * grafana_dashboards row (grafana_json NULL — that, never the grafana_id, is what marks it
   * artificial), an application_dashboards row with grafana_instance_id NULL (root CLAUDE.md #41),
   * and a metrics_sources row with source_type 'splunk'.
   *
   * The application dashboard id is deterministic over (system, environment, workload, label), and
   * `ON CONFLICT (id)` is its only dedupe — never pass a random id here (CLAUDE.md, "An artificial
   * Dynatrace dashboard is per-workload"). The Grafana instance the synthetic row needs is taken
   * from the SYSTEM's organization, not the first row of the table (CLAUDE.md #60).
   */
  private async ensureArtificialDashboard(
    sut: SystemUnderTest,
    scope: ScopeRef,
    dashboardLabel: string,
    config: SplunkConfig,
  ): Promise<{ applicationDashboardId: string; metricsSourceId: string }> {
    const em = withRequestQuery(this.dataSource);
    const applicationDashboardId = generateDeterministicUuid(
      `${scope.systemUnderTestId}-${scope.testEnvironment}-${scope.workload}-splunk-${dashboardLabel}`,
    );
    const slug = dashboardLabel.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    // A label with no [a-z0-9] characters would give every such label the uid `splunk-`.
    const dashboardUid = `splunk-${slug || applicationDashboardId.slice(0, 8)}`;

    const existing = await em.query<Array<{ id: string }>>('SELECT id FROM application_dashboards WHERE id = $1', [applicationDashboardId]);
    if (existing.length === 0) {
      const instances = await em.query<Array<{ id: string }>>(
        'SELECT id FROM grafana_instances WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1',
        [sut.organization_id],
      );
      const grafanaInstanceId = instances[0]?.id;
      if (!grafanaInstanceId) {
        // ponytail: grafana_dashboards.grafana_instance_id is NOT NULL, the same limit Dynatrace has.
        // Lifting it means making that column nullable for artificial rows.
        throw new BadRequestException('Add a Grafana connection to this organization first: Splunk panels are stored on a placeholder dashboard that needs one');
      }
      const gd = await em.query<Array<{ id: string }>>(
        'SELECT id FROM grafana_dashboards WHERE uid = $1 AND grafana_instance_id = $2',
        [dashboardUid, grafanaInstanceId],
      );
      let grafanaDashboardId = gd[0]?.id;
      if (!grafanaDashboardId) {
        const inserted = await em.query<Array<{ id: string }>>(
          `INSERT INTO grafana_dashboards (grafana_instance_id, grafana_id, uid, name, panels, organization_id)
           VALUES ($1, $2, $3, $4, '[]', $5) RETURNING id`,
          [grafanaInstanceId, 700000 + Math.floor(Math.random() * 100000), dashboardUid, dashboardLabel, sut.organization_id],
        );
        grafanaDashboardId = inserted[0]!.id;
      }
      await em.query(
        `INSERT INTO application_dashboards (
           id, system_under_test_id, test_environment, grafana_dashboard_id,
           dashboard_name, dashboard_uid, dashboard_label, organization_id, team_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [applicationDashboardId, sut.id, scope.testEnvironment, grafanaDashboardId, dashboardLabel, dashboardUid, dashboardLabel, sut.organization_id, sut.team_id ?? null],
      );
    }

    const conflictPaths = ['systemUnderTestId', 'testEnvironment', 'sourceType', 'externalRef', 'displayName', 'displayLabel'];
    await withRequestEm(this.metricsSourceRepo).upsert(
      {
        systemUnderTestId: sut.id,
        testEnvironment: scope.testEnvironment,
        workload: scope.workload,
        sourceType: 'splunk',
        sourceConfigId: config.id,
        externalRef: config.id,
        displayName: config.label,
        displayLabel: scope.workload,
        organizationId: sut.organization_id,
      },
      { conflictPaths, skipUpdateIfNoValuesChanged: true },
    );
    const source = await withRequestEm(this.metricsSourceRepo).findOneOrFail({
      where: { systemUnderTestId: sut.id, testEnvironment: scope.testEnvironment, sourceType: 'splunk', externalRef: config.id, displayLabel: scope.workload },
    });
    return { applicationDashboardId, metricsSourceId: source.id };
  }

  private checkSpl(spl: string): void {
    if (/\|\s*timechart\b/i.test(spl)) {
      throw new BadRequestException('Leave out "| timechart": Perfana adds it with the run window and bucket size');
    }
    // Time modifiers are refused here, at save and preview, and not at send: see validateSplFilter.
    const problem = validateSplFilter(spl, { timeModifiers: true });
    if (problem) throw new BadRequestException(problem);
    // $entities is what bounds a query to the sources mapped for the system; without it a query
    // could read anything the organization's token can.
    if (!/\$entities\b/.test(spl)) {
      throw new BadRequestException('A Splunk query must use $entities, so it only reads the sources mapped for this system');
    }
  }

  private checkHost(host: string): string {
    const validation = validateExternalUrl(host);
    if (!validation.isValid) throw new BadRequestException(`Invalid Splunk URL: ${validation.error}`);
    const url = validation.url!;
    if (url.port === '8000') {
      throw new BadRequestException('Port 8000 is Splunk Web. Perfana needs the management port, usually 8089.');
    }
    return host.replace(/\/+$/, '');
  }

  private requireCredentials(c: SplunkConfig): void {
    if (!c.apiToken && !(c.username && c.password)) {
      throw new BadRequestException('A Splunk connection needs a token, or a username and password');
    }
  }

  private async probe(conn: SplunkConnection, opts: SplunkRequestOptions) {
    try {
      const info = await splunkServerInfo(conn, opts);
      return { success: true, message: `Connected to ${info.serverName ?? 'Splunk'}${info.version ? ` ${info.version}` : ''}` };
    } catch (err) {
      this.logger.warn(
        `Splunk connection test to ${hostForLog(conn.host)} failed: ${errMsg(err)}${err instanceof SplunkError && err.detail ? ` | cause: ${err.detail}` : ''}`,
      );
      const hint = err instanceof SplunkError && err.status === undefined && /splunkcloud\.com|cloud\.splunk\.com/i.test(conn.host)
        ? ' On Splunk Cloud, port 8089 is opened through a support case and the search-api IP allow list is closed by default.'
        : '';
      return { success: false, message: `${errMsg(err)}${hint}` };
    }
  }

  private connectionOf(c: SplunkConfig): SplunkConnection {
    return { host: c.host, apiToken: c.apiToken, username: c.username, password: c.password, splunkApp: c.splunkApp, label: c.label };
  }

  private async requestOptions(organizationId: string, useProxy: boolean): Promise<SplunkRequestOptions> {
    const agents = await this.proxyResolver.resolve(organizationId, useProxy);
    return agents ? { dispatcher: agents.dispatcher } : {};
  }

  private toHttp(err: unknown): Error {
    if (err instanceof SplunkError) {
      this.logger.warn(`Splunk request failed: ${err.message}${err.detail ? ` | cause: ${err.detail}` : ''}`);
      return new BadRequestException(`Splunk: ${err.message}`);
    }
    return err as Error;
  }

  private mask(c: SplunkConfig): MaskedSplunkConfig {
    return { ...c, apiToken: c.apiToken ? MASK : null, password: c.password ? MASK : null };
  }

  private async loadConfig(id: string, userId: string, roles: string[]): Promise<SplunkConfig> {
    const config = await withRequestEm(this.configRepo).findOne({ where: { id } });
    if (!config) throw new NotFoundException('Splunk connection not found');
    const access = await this.authzService.canAccessResource(userId, roles, {
      organization_id: config.organizationId,
      created_by: '',
    } as OwnedResource);
    if (!access.allowed) throw new NotFoundException('Splunk connection not found');
    return config;
  }

  private async requireSameOrgConfig(configId: string, sut: SystemUnderTest, userId: string, roles: string[]): Promise<SplunkConfig> {
    const config = await this.loadConfig(configId, userId, roles);
    if (config.organizationId !== sut.organization_id) {
      throw new BadRequestException('That Splunk connection belongs to another organization than this system');
    }
    return config;
  }

  private async loadSut(id: string, userId: string, roles: string[], mode: 'read' | 'write', notFound = 'System under test not found') {
    const sut = await withRequestEm(this.sutRepo).findOne({ where: { id, deletion_status: IsNull() } });
    if (!sut) throw new NotFoundException(notFound);
    const resource = sut as unknown as OwnedResource;
    const allowed = mode === 'read'
      ? (await this.authzService.canAccessResource(userId, roles, resource)).allowed
      : (await this.authzService.canModifyResource(userId, roles, resource)).allowed;
    if (!allowed) {
      // A system you can read but not change is a 403; one you cannot see is a 404.
      if (mode === 'write' && (await this.authzService.canAccessResource(userId, roles, resource)).allowed) {
        throw new ForbiddenException('You cannot change this system');
      }
      throw new NotFoundException(notFound);
    }
    return sut;
  }

  private async loadQuery(id: string, userId: string, roles: string[]): Promise<SplunkQuery> {
    const query = await withRequestEm(this.queryRepo).findOne({ where: { id } });
    if (!query) throw new NotFoundException('Splunk query not found');
    await this.loadSut(query.systemUnderTestId, userId, roles, 'write', 'Splunk query not found');
    return query;
  }

  private async requireCapability(userId: string, roles: string[], organizationId: string, capability: string): Promise<void> {
    const caps = await this.authzService.getCapabilities(userId, roles, organizationId);
    if (!caps.includes(capability as (typeof caps)[number])) {
      throw new ForbiddenException('You do not have permission to manage Splunk connections in this organization');
    }
  }

  /** A unique violation is a 409 the user can act on, not a 500. No work follows it, so no SAVEPOINT. */
  // audit-skip: helper; every caller (createMapping, createQuery, updateQuery) audits the saved row itself
  private async saveUnique<T extends object>(repo: Repository<T>, entity: T, conflictMessage: string): Promise<T> {
    try {
      return await withRequestEm(repo).save(entity);
    } catch (err) {
      if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
        throw new ConflictException(conflictMessage);
      }
      throw err;
    }
  }
}
