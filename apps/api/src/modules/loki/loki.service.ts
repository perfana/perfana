import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { OwnedResource } from '@perfana/shared';
import {
  buildMetricExpr,
  buildLogExpr,
  buildStreamSelector,
  grafanaLokiDatasources,
  hostForLog,
  isErrorLevel,
  labelFilter,
  lokiExploreUrl,
  lokiLabels,
  lokiLabelValues,
  lokiPanelPoints,
  lokiTestConnection,
  detectLokiLevelSource,
  levelParserStage,
  LokiConnection,
  LokiError,
  LokiMatcher,
  LokiRequestOptions,
  type LokiLevelSource,
  NO_LABEL_VALUE,
  normalizeLevel,
  parseAggregation,
  selectMappings,
  validateLogqlPipeline,
  validateMatchers,
} from '@perfana/shared/services/loki/client';
import { LOKI_STARTER_PANEL_TITLES } from '@perfana/shared/constants';
import {
  GrafanaInstance,
  LokiConfig,
  LokiQuery,
  LokiStreamMapping,
  MetricsSource,
  SystemUnderTest,
  TestRun,
} from '../../entities';
import { withRequestEm, withRequestQuery } from '../../common/db/request-em';
import { generateDeterministicUuid } from '../../utils/uuid-generator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { Capability } from '../../constants/capabilities.constants';
import { AuditService } from '../audit/audit.service';
import { ProxyResolverService } from '../proxy/proxy-resolver.service';
import { loadControlGroupForRun, loadControlGroupStatistics } from '../metrics/control-group-baseline';
import { CONTROL_GROUP_BASELINE } from '@perfana/shared/types';
import {
  CopyLokiStreamMappingsDto,
  CreateLokiConfigDto,
  CreateLokiQueryDto,
  CreateLokiStreamMappingDto,
  PreviewLokiQueryDto,
  StarterLokiQueriesDto,
  TestLokiConnectionDto,
  UpdateLokiConfigDto,
  UpdateLokiQueryDto,
} from './dto/loki.dto';

const LABELS_TTL_MS = 10 * 60 * 1000;
/** Error lines over all lines from a level panel's mean per level; null with no lines. */
function levelRatio(rows: Array<{ metric_name: string | null; mean: number | null }>): number | null {
  let all = 0;
  let err = 0;
  for (const r of rows) {
    if (r.mean === null || r.metric_name === null) continue;
    all += r.mean;
    if (isErrorLevel(r.metric_name)) err += r.mean;
  }
  return all > 0 ? err / all : null;
}

/** What the Loki card's "vs baseline" figures compare against; see LokiService.resolveBaseline. */
interface LokiBaseline {
  kind: 'control-group' | 'run' | 'previous-runs' | 'none';
  /** The runs whose snapshots patterns and applications are compared with. */
  testRunIds: string[];
  controlGroupId: string | null;
  controlGroupRuns: number;
}

/** How many baseline runs' pattern snapshots decide whether a pattern is new. */
const NEW_PATTERN_BASELINE_RUNS = 5;

/**
 * The starter panels, created per scope by POST /loki/queries/starter. `{level}` and `{service}`
 * are replaced with the connection's level label and the chosen service label, `{parser}` with the
 * stage that extracts the level (` | json`, ` | logfmt`, or nothing).
 */
export const STARTER_PANELS = [
  { panelTitle: LOKI_STARTER_PANEL_TITLES[0], logql: '$entities{parser}', splitBy: '{level}', aggregation: 'count' },
  {
    panelTitle: LOKI_STARTER_PANEL_TITLES[1],
    logql: '$entities{parser} | {level}=~"(?i)(error|err|fatal|critical|crit|panic|emerg|alert|severe)"',
    splitBy: '{service}',
    aggregation: 'count',
  },
  { panelTitle: LOKI_STARTER_PANEL_TITLES[2], logql: '$entities', splitBy: '{service}', aggregation: 'bytes', metricUnit: 'bytes' },
] as const;

export interface ScopeRef {
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
}

const errMsg = (err: unknown): string =>
  err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';

/** The connection test's sentence about the level: found as configured, found elsewhere (and what to set), or nowhere. */
export function describeLevelProbe(configured: { parser: string; label: string }, found: LokiLevelSource | null): string {
  const how = (s: { parser: string; label: string }) => (s.parser === 'none' ? `the label "${s.label}"` : `"| ${s.parser}" with the field "${s.label}"`);
  if (!found) return `No log level found with ${how(configured)}, nor with | json or | logfmt: error rates will read 0 until the lines carry one.`;
  const share = found.coverage < 0.95 ? `, on ${Math.round(found.coverage * 100)}% of lines` : '';
  if (found.parser === configured.parser && found.label === configured.label) return `Levels found with ${how(found)}: ${found.levels.join(', ')}${share}.`;
  return `${how(configured)} carries no level on most of these lines, but ${how(found)} does (${found.levels.join(', ')}${share}): set the level parser to "${found.parser}" and the level label to "${found.label}".`;
}

/**
 * A level panel whose every series is `(none)`: the split label is on none of the run's lines, so
 * the panel cannot tell an error from anything else and its "0 errors" means nothing.
 */
export function levelLabelMissing(series: Array<{ name: string }>): boolean {
  return series.length > 0 && series.every((s) => s.name === NO_LABEL_VALUE);
}

/** `{ totalLines, errorLines }` from a level panel's series totals. */
export function levelTotals(series: Array<{ name: string; total: number | null }>): { total: number; errors: number } | null {
  let total = 0;
  let errors = 0;
  let any = false;
  for (const s of series) {
    if (s.total === null) continue;
    any = true;
    total += s.total;
    if (isErrorLevel(s.name)) errors += s.total;
  }
  return any ? { total, errors } : null;
}

/**
 * The run's error rate from the per-application snapshot, for a workload with no level panel. The
 * baseline is pooled over the applications that have one, which is all of them once the baseline
 * runs were snapshotted with this version.
 */
export function errorRateFromServices(
  services: Array<{ totalLines: number; errorLines: number; baseline: { errorRatePct: number; runs: number } | null }>,
) {
  const total = services.reduce((n, s) => n + s.totalLines, 0);
  if (total === 0) return null;
  const errors = services.reduce((n, s) => n + s.errorLines, 0);
  const withBaseline = services.filter((s) => s.baseline);
  const bTotal = withBaseline.reduce((n, s) => n + s.totalLines, 0);
  // Weight each application's baseline ratio by its lines in this run: the pooled ratio the baseline
  // would show at this run's mix of applications.
  const bErrors = withBaseline.reduce((n, s) => n + (s.baseline!.errorRatePct / 100) * s.totalLines, 0);
  return {
    totalLines: total,
    errorLines: errors,
    errorRatePct: (errors / total) * 100,
    baseline: bTotal > 0 ? { errorRatePct: (bErrors / bTotal) * 100, runs: Math.max(...withBaseline.map((s) => s.baseline!.runs)) } : null,
  };
}

/**
 * Loki connections, stream mappings and panels. Spec: docs/reference/Features/Loki Log Metrics (spec).md.
 *
 * Authorization is Splunk's: connections are org-owned (integration:loki:* capabilities) and must
 * sit in the same organization as the Grafana instance they query through; mappings and panels
 * belong to a system and inherit its organization, and the connection they use must be in that
 * same organization, so one tenant can never point its system at another tenant's Grafana
 * credentials. Every resource outside the caller's organizations is a 404, never a 403.
 */
@Injectable()
export class LokiService {
  private readonly logger = new Logger(LokiService.name);
  // ponytail: per-process cache, like Splunk discovery; labels are cheap to re-read.
  private readonly labelCache = new Map<string, { at: number; values: string[] }>();

  constructor(
    @InjectRepository(LokiConfig) private readonly configRepo: Repository<LokiConfig>,
    @InjectRepository(LokiStreamMapping) private readonly mappingRepo: Repository<LokiStreamMapping>,
    @InjectRepository(LokiQuery) private readonly queryRepo: Repository<LokiQuery>,
    @InjectRepository(GrafanaInstance) private readonly grafanaRepo: Repository<GrafanaInstance>,
    @InjectRepository(SystemUnderTest) private readonly sutRepo: Repository<SystemUnderTest>,
    @InjectRepository(MetricsSource) private readonly metricsSourceRepo: Repository<MetricsSource>,
    @InjectRepository(TestRun) private readonly testRunRepo: Repository<TestRun>,
    private readonly dataSource: DataSource,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly proxyResolver: ProxyResolverService,
  ) {}

  // ---------------------------------------------------------------------------
  // Connections
  // ---------------------------------------------------------------------------

  async listConfigs(userId: string, roles: string[]) {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    if (orgIds !== null && orgIds.length === 0) return [];
    const qb = withRequestEm(this.configRepo).createQueryBuilder('c').leftJoinAndSelect('c.grafanaInstance', 'g').orderBy('c.label', 'ASC');
    if (orgIds !== null) qb.where('c.organization_id IN (:...orgIds)', { orgIds });
    return (await qb.getMany()).map((c) => this.present(c));
  }

  async getConfig(id: string, userId: string, roles: string[]) {
    return this.present(await this.loadConfig(id, userId, roles));
  }

  /** Loki datasources on a Grafana instance, for the connection dialog. */
  async listDatasources(grafanaInstanceId: string, userId: string, roles: string[]) {
    const instance = await this.loadGrafanaInstance(grafanaInstanceId, userId, roles);
    await this.requireCapability(userId, roles, instance.organizationId, Capability.IntegrationLokiCreate);
    try {
      return await grafanaLokiDatasources(this.grafanaConnection(instance), await this.requestOptions(instance));
    } catch (err) {
      throw this.toHttp(err);
    }
  }

  async createConfig(dto: CreateLokiConfigDto, userId: string, roles: string[]) {
    const instance = await this.loadGrafanaInstance(dto.grafanaInstanceId, userId, roles);
    // The organization is the Grafana instance's: a connection may only use its own tenant's credentials.
    await this.requireCapability(userId, roles, instance.organizationId, Capability.IntegrationLokiCreate);
    const entity = this.configRepo.create({
      label: dto.label.trim(),
      grafanaInstanceId: instance.id,
      datasourceUid: dto.datasourceUid.trim(),
      datasourceName: dto.datasourceName?.trim() || null,
      levelLabel: dto.levelLabel?.trim() || 'detected_level',
      levelParser: dto.levelParser ?? 'none',
      serviceLabel: dto.serviceLabel?.trim() || 'service_name',
      maxConcurrentQueries: dto.maxConcurrentQueries ?? 2,
      organizationId: instance.organizationId,
      createdBy: userId,
      updatedBy: userId,
    });
    const saved = await this.saveUnique(this.configRepo, entity, 'That Loki datasource is already connected for this Grafana instance');
    this.auditService.logCreate(saved as unknown as OwnedResource, { organizationIdOverride: saved.organizationId });
    saved.grafanaInstance = instance;
    return this.present(saved);
  }

  async updateConfig(id: string, dto: UpdateLokiConfigDto, userId: string, roles: string[]) {
    const entity = await this.loadConfig(id, userId, roles);
    await this.requireCapability(userId, roles, entity.organizationId, Capability.IntegrationLokiUpdate);
    const before = Object.assign(new LokiConfig(), entity);
    if (dto.label !== undefined) entity.label = dto.label.trim();
    if (dto.datasourceUid !== undefined) entity.datasourceUid = dto.datasourceUid.trim();
    if (dto.datasourceName !== undefined) entity.datasourceName = dto.datasourceName?.trim() || null;
    if (dto.levelLabel !== undefined) entity.levelLabel = dto.levelLabel.trim() || 'detected_level';
    if (dto.levelParser !== undefined) entity.levelParser = dto.levelParser;
    if (dto.serviceLabel !== undefined) entity.serviceLabel = dto.serviceLabel.trim() || 'service_name';
    if (dto.maxConcurrentQueries !== undefined) entity.maxConcurrentQueries = dto.maxConcurrentQueries;
    entity.updatedBy = userId;
    const instance = entity.grafanaInstance;
    delete entity.grafanaInstance;
    const saved = await this.saveUnique(this.configRepo, entity, 'That Loki datasource is already connected for this Grafana instance');
    this.clearLabelCache(id);
    this.auditService.logUpdate(before as unknown as OwnedResource, saved as unknown as OwnedResource, { organizationIdOverride: saved.organizationId });
    saved.grafanaInstance = instance;
    return this.present(saved);
  }

  /** Cascades to the connection's mappings and panels (FK ON DELETE CASCADE). */
  async deleteConfig(id: string, userId: string, roles: string[]): Promise<void> {
    const entity = await this.loadConfig(id, userId, roles);
    await this.requireCapability(userId, roles, entity.organizationId, Capability.IntegrationLokiDelete);
    await withRequestEm(this.configRepo).delete({ id });
    this.clearLabelCache(id);
    this.auditService.logDelete(entity as unknown as OwnedResource, { organizationIdOverride: entity.organizationId });
  }

  async testConnection(dto: TestLokiConnectionDto, userId: string, roles: string[]) {
    const instance = await this.loadGrafanaInstance(dto.grafanaInstanceId, userId, roles);
    await this.requireCapability(userId, roles, instance.organizationId, Capability.IntegrationLokiCreate);
    return this.probe({ ...this.grafanaConnection(instance), datasourceUid: dto.datasourceUid }, await this.requestOptions(instance), {
      label: dto.levelLabel?.trim() || 'detected_level', parser: dto.levelParser ?? 'none', serviceLabel: dto.serviceLabel?.trim() || 'service_name',
    });
  }

  async testSavedConnection(id: string, userId: string, roles: string[]) {
    const config = await this.loadConfig(id, userId, roles);
    await this.requireCapability(userId, roles, config.organizationId, Capability.IntegrationLokiUpdate);
    const instance = config.grafanaInstance!;
    return this.probe(this.connectionOf(config, instance), await this.requestOptions(instance), {
      label: config.levelLabel, parser: config.levelParser || 'none', serviceLabel: config.serviceLabel || 'service_name',
    });
  }

  /** Label names, for the mapping editor. Lists what the token can see: a configuration action. */
  async listLabels(id: string, userId: string, roles: string[], hours = 24, refresh = false): Promise<string[]> {
    const config = await this.loadConfig(id, userId, roles);
    await this.requireCapability(userId, roles, config.organizationId, Capability.IntegrationLokiUpdate);
    return this.cached(`${id}:labels:${hours}`, refresh, async () => {
      const to = new Date();
      return lokiLabels(this.connectionOf(config, config.grafanaInstance!), new Date(to.getTime() - hours * 3600_000), to,
        await this.requestOptions(config.grafanaInstance!));
    });
  }

  /** Values of one label, optionally narrowed by matchers already chosen. */
  async listLabelValues(id: string, label: string, userId: string, roles: string[], hours = 24, matchers?: LokiMatcher[]): Promise<string[]> {
    const config = await this.loadConfig(id, userId, roles);
    await this.requireCapability(userId, roles, config.organizationId, Capability.IntegrationLokiUpdate);
    let selector: string | undefined;
    if (matchers && matchers.length > 0) {
      const problem = validateMatchers(matchers);
      if (problem) throw new BadRequestException(problem);
      selector = buildStreamSelector(matchers);
    }
    return this.cached(`${id}:values:${label}:${hours}:${selector ?? ''}`, false, async () => {
      const to = new Date();
      return lokiLabelValues(this.connectionOf(config, config.grafanaInstance!), label, new Date(to.getTime() - hours * 3600_000), to, selector,
        await this.requestOptions(config.grafanaInstance!));
    });
  }

  // ---------------------------------------------------------------------------
  // Stream mappings
  // ---------------------------------------------------------------------------

  async listMappings(systemUnderTestId: string, userId: string, roles: string[], testEnvironment?: string, workload?: string) {
    await this.loadSut(systemUnderTestId, userId, roles, 'read');
    return this.mappingsInScope(systemUnderTestId, testEnvironment, workload);
  }

  async createMapping(dto: CreateLokiStreamMappingDto, userId: string, roles: string[]): Promise<LokiStreamMapping> {
    const sut = await this.loadSut(dto.systemUnderTestId, userId, roles, 'write');
    await this.requireSameOrgConfig(dto.lokiConfigId, sut, userId, roles);
    const matchers: LokiMatcher[] = dto.matchers.map((m) => ({ label: m.label.trim(), op: m.op, value: m.value }));
    const problem = validateMatchers(matchers);
    if (problem) throw new BadRequestException(problem);
    const scope = this.levelScope(dto.level, dto.testEnvironment, dto.workload);
    const entity = this.mappingRepo.create({
      lokiConfigId: dto.lokiConfigId,
      systemUnderTestId: sut.id,
      level: dto.level,
      ...scope,
      matchers,
      selector: buildStreamSelector(matchers),
      labels: dto.labels ?? [],
      organizationId: sut.organization_id,
      teamId: sut.team_id,
      createdBy: userId,
      updatedBy: userId,
    });
    const saved = await this.saveUnique(this.mappingRepo, entity, 'These streams are already mapped at that level');
    this.auditService.logCreate(saved as unknown as OwnedResource, { organizationIdOverride: saved.organizationId });
    return saved;
  }

  async deleteMapping(id: string, userId: string, roles: string[]): Promise<void> {
    const mapping = await withRequestEm(this.mappingRepo).findOne({ where: { id } });
    if (!mapping) throw new NotFoundException('Loki stream mapping not found');
    await this.loadSut(mapping.systemUnderTestId, userId, roles, 'write', 'Loki stream mapping not found');
    await withRequestEm(this.mappingRepo).delete({ id });
    this.auditService.logDelete(mapping as unknown as OwnedResource, { organizationIdOverride: mapping.organizationId });
  }

  /** Copy mappings to another environment/workload of the SAME system, each keeping its level. */
  async copyMappings(dto: CopyLokiStreamMappingsDto, userId: string, roles: string[]) {
    let copied = 0;
    let skipped = 0;
    for (const id of dto.mappingIds) {
      const source = await withRequestEm(this.mappingRepo).findOne({ where: { id } });
      if (!source) throw new NotFoundException('Loki stream mapping not found');
      // Authorize before any skip branch, or another tenant's id answers {skipped:1} instead of a 404.
      await this.loadSut(source.systemUnderTestId, userId, roles, 'write', 'Loki stream mapping not found');
      if (source.level === 'sut') {
        skipped++;
        continue;
      }
      const workload = source.level === 'workload' ? dto.targetWorkload ?? source.workload ?? null : null;
      // Probe instead of catching 23505: a unique violation aborts the request's RLS transaction.
      const exists = await withRequestEm(this.mappingRepo).findOne({
        where: {
          systemUnderTestId: source.systemUnderTestId,
          lokiConfigId: source.lokiConfigId,
          testEnvironment: dto.targetEnvironment,
          workload: workload ?? IsNull(),
          selector: source.selector,
        },
      });
      if (exists) {
        skipped++;
        continue;
      }
      await this.createMapping(
        {
          lokiConfigId: source.lokiConfigId,
          systemUnderTestId: source.systemUnderTestId,
          level: source.level,
          testEnvironment: dto.targetEnvironment,
          workload,
          matchers: source.matchers,
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
  // Panels
  // ---------------------------------------------------------------------------

  /** Panel titles a profile's "Loki — all panels" SLO can target: the starter panels plus every title in use. */
  async listPanelTitles(userId: string, roles: string[]): Promise<Array<{ panelTitle: string; metricUnit: string }>> {
    const byTitle = new Map<string, string>(STARTER_PANELS.map((p) => [p.panelTitle, 'metricUnit' in p ? p.metricUnit : 'short']));
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    if (orgIds === null || orgIds.length > 0) {
      const qb = withRequestEm(this.queryRepo)
        .createQueryBuilder('q')
        .select('DISTINCT ON (q.panel_title) q.panel_title', 'panelTitle')
        .addSelect('q.metric_unit', 'metricUnit')
        .orderBy('q.panel_title', 'ASC')
        .addOrderBy('q.updated_at', 'DESC');
      if (orgIds !== null) qb.where('q.organization_id IN (:...orgIds)', { orgIds });
      for (const row of await qb.getRawMany<{ panelTitle: string; metricUnit: string }>()) byTitle.set(row.panelTitle, row.metricUnit);
    }
    return [...byTitle.entries()].map(([panelTitle, metricUnit]) => ({ panelTitle, metricUnit })).sort((a, b) => a.panelTitle.localeCompare(b.panelTitle));
  }

  async listQueries(scope: ScopeRef, userId: string, roles: string[]): Promise<LokiQuery[]> {
    await this.loadSut(scope.systemUnderTestId, userId, roles, 'read');
    return withRequestEm(this.queryRepo).find({
      where: { systemUnderTestId: scope.systemUnderTestId, testEnvironment: scope.testEnvironment, workload: scope.workload },
      order: { dashboardLabel: 'ASC', panelId: 'ASC' },
    });
  }

  async createQuery(dto: CreateLokiQueryDto, userId: string, roles: string[]): Promise<LokiQuery> {
    const sut = await this.loadSut(dto.systemUnderTestId, userId, roles, 'write');
    const config = await this.requireSameOrgConfig(dto.lokiConfigId, sut, userId, roles);
    this.checkQuery(dto.logql, dto.aggregation);
    const dashboardLabel = dto.dashboardLabel?.trim() || 'Loki logs';
    const panelId = dto.panelId ?? (await this.nextPanelId(dto, dashboardLabel));
    const { applicationDashboardId, metricsSourceId } = await this.ensureArtificialDashboard(sut, dto, dashboardLabel, config);
    const entity = this.queryRepo.create({
      lokiConfigId: dto.lokiConfigId,
      systemUnderTestId: sut.id,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      dashboardLabel,
      applicationDashboardId,
      metricsSourceId,
      panelTitle: dto.panelTitle,
      panelId,
      logql: dto.logql,
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

  /** The starter panels for a scope; an existing panel title is left alone. */
  async createStarterQueries(scope: StarterLokiQueriesDto, userId: string, roles: string[]) {
    const existing = await this.listQueries(scope, userId, roles);
    const sut = await this.loadSut(scope.systemUnderTestId, userId, roles, 'write');
    const config = await this.requireSameOrgConfig(scope.lokiConfigId, sut, userId, roles);
    const titles = new Set(existing.map((q) => q.panelTitle));
    const service = scope.serviceLabel?.trim() || config.serviceLabel || 'service_name';
    const fill = (s: string) => s.replace(/\{parser\}/g, levelParserStage(config.levelParser)).replace(/\{level\}/g, config.levelLabel).replace(/\{service\}/g, service);
    const created: LokiQuery[] = [];
    for (const p of STARTER_PANELS) {
      if (titles.has(p.panelTitle)) continue;
      created.push(await this.createQuery({
        lokiConfigId: scope.lokiConfigId,
        systemUnderTestId: scope.systemUnderTestId,
        testEnvironment: scope.testEnvironment,
        workload: scope.workload,
        panelTitle: p.panelTitle,
        logql: fill(p.logql),
        splitBy: fill(p.splitBy),
        aggregation: p.aggregation,
        metricUnit: 'metricUnit' in p ? p.metricUnit : 'short',
      }, userId, roles));
    }
    return created;
  }

  async updateQuery(id: string, dto: UpdateLokiQueryDto, userId: string, roles: string[]): Promise<LokiQuery> {
    const entity = await this.loadQuery(id, userId, roles);
    const before = Object.assign(new LokiQuery(), entity);
    this.checkQuery(dto.logql ?? entity.logql, dto.aggregation ?? entity.aggregation);
    if (dto.logql !== undefined) entity.logql = dto.logql;
    if (dto.panelTitle !== undefined) entity.panelTitle = dto.panelTitle;
    if (dto.panelId !== undefined) entity.panelId = dto.panelId;
    if (dto.splitBy !== undefined) entity.splitBy = dto.splitBy || null;
    if (dto.aggregation !== undefined) entity.aggregation = dto.aggregation.trim() || 'count';
    if (dto.metricUnit !== undefined) entity.metricUnit = dto.metricUnit || 'short';
    if (dto.maxSeries !== undefined) entity.maxSeries = dto.maxSeries;
    if (dto.enabled !== undefined) entity.enabled = dto.enabled;
    entity.updatedBy = userId;
    const saved = await this.saveUnique(this.queryRepo, entity, `Panel ${entity.panelId} already exists on "${entity.dashboardLabel}" for this workload`);
    this.auditService.logUpdate(before as unknown as OwnedResource, saved as unknown as OwnedResource, { organizationIdOverride: saved.organizationId });
    return saved;
  }

  async deleteQuery(id: string, userId: string, roles: string[]): Promise<void> {
    const entity = await this.loadQuery(id, userId, roles);
    await withRequestEm(this.queryRepo).delete({ id });
    this.auditService.logDelete(entity as unknown as OwnedResource, { organizationIdOverride: entity.organizationId });
  }

  /** Run an unsaved panel over the last N minutes: series, totals, the LogQL sent, and label names to split on. */
  async previewQuery(dto: PreviewLokiQueryDto, userId: string, roles: string[]) {
    // Write, not read: a preview runs caller-chosen LogQL with the organization's Grafana credentials.
    const sut = await this.loadSut(dto.systemUnderTestId, userId, roles, 'write');
    const config = await this.requireSameOrgConfig(dto.lokiConfigId, sut, userId, roles);
    this.checkQuery(dto.logql, dto.aggregation);
    const mappings = await this.mappingsInScope(sut.id, dto.testEnvironment, dto.workload, dto.lokiConfigId);
    if (selectMappings(dto.logql, mappings).length === 0) {
      return { exprs: [], series: [], labels: [], message: 'No Loki streams are mapped for this scope (or none carries that $entities tag), so there is nothing to query.' };
    }
    const minutes = dto.minutes ?? 60;
    const to = new Date();
    const from = new Date(to.getTime() - minutes * 60_000);
    const bucketSeconds = Math.max(5, Math.ceil((minutes * 60) / 120));
    const instance = config.grafanaInstance!;
    const conn = this.connectionOf(config, instance);
    const opts = await this.requestOptions(instance);
    try {
      const [result, labels] = await Promise.all([
        lokiPanelPoints(conn, { logql: dto.logql, aggregation: dto.aggregation, splitBy: dto.splitBy, maxSeries: dto.maxSeries, panelTitle: 'value' },
          mappings, from, to, bucketSeconds, undefined, {
            ...opts,
            onQuery: (expr, info) => this.logger.debug(`Loki preview query (${info.ms}ms, ${info.frames} frames): ${expr}`),
          }),
        lokiLabels(conn, from, to, opts).catch(() => [] as string[]),
      ]);
      const totals = new Map<string, number>();
      for (const p of result.points) totals.set(p.series, (totals.get(p.series) ?? 0) + p.value);
      const nonZero = result.points.some((p) => p.value !== 0);
      return {
        exprs: result.exprs,
        bucketSeconds,
        series: [...totals.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
        points: result.points.length,
        seriesBeforeCap: result.seriesBeforeCap,
        labels,
        ...(!nonZero
          ? { message: dto.splitBy && totals.size === 1 && totals.has('(none)')
              ? `No line in the window carries the label "${dto.splitBy}". Pick one of the labels listed below, or add a parser stage (| json, | logfmt) that extracts it.`
              : 'Loki returned no lines for this query in the window.' }
          : {}),
      };
    } catch (err) {
      throw this.toHttp(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Test run summary
  // ---------------------------------------------------------------------------

  /**
   * Everything the test run page's Loki card shows, in one request, none of it asked of Loki:
   * the streams in effect for the run, each panel's series totals (from the analysis'
   * statistics), the error rate against the control group's, and the pattern and error-line
   * snapshots the worker took at analysis. `configured` is false when the workload has no
   * enabled Loki panel, so the card hides.
   */
  async runSummary(testRunId: string, userId: string, roles: string[], baselineParam?: string) {
    const run = await withRequestEm(this.testRunRepo).findOne({ where: { testRunId } });
    if (!run) throw new NotFoundException('Test run not found');
    await this.loadSut(run.systemUnderTestId, userId, roles, 'read', 'Test run not found');

    const scope = { systemUnderTestId: run.systemUnderTestId, testEnvironment: run.testEnvironment, workload: run.workload };
    const queries = (await withRequestEm(this.queryRepo).find({ where: scope, order: { panelId: 'ASC' } })).filter((q) => q.enabled);
    if (queries.length === 0) return { configured: false as const };

    const mappings = await this.mappingsInScope(scope.systemUnderTestId, scope.testEnvironment, scope.workload);
    const configIds = [...new Set(queries.map((q) => q.lokiConfigId))];
    const configs = await withRequestEm(this.configRepo).find({ where: configIds.map((id) => ({ id })), relations: { grafanaInstance: true } });
    const configById = new Map(configs.map((c) => [c.id, c]));
    const q = withRequestQuery(this.dataSource);

    const dashboardIds = [...new Set(queries.map((x) => x.applicationDashboardId).filter((id): id is string => !!id))];
    type StatRow = { application_dashboard_id: string; panel_id: number; metric_name: string; mean: number | null; max_value: number | null; count: number | null };
    const stats: StatRow[] = dashboardIds.length === 0 ? [] : await q.query(
      `SELECT application_dashboard_id, panel_id, metric_name, mean, max_value, count
         FROM ds_metric_statistics
        WHERE test_run_id = $1 AND application_dashboard_id = ANY($2::uuid[])`,
      [run.testRunId, dashboardIds],
    );

    const start = run.startTime ? new Date(run.startTime) : null;
    const end = run.endTime ? new Date(run.endTime) : new Date();
    const explore = (config: LokiConfig | undefined, expr: string): string | null => {
      const g = config?.grafanaInstance;
      if (!config || !g || !start) return null;
      return lokiExploreUrl(g.client_url, g.orgId, config.datasourceUid, expr, start, end);
    };
    const bucketSeconds = 60;

    const panels = queries.map((query) => {
      const config = configById.get(query.lokiConfigId);
      const selected = selectMappings(query.logql, mappings.filter((m) => m.lokiConfigId === query.lokiConfigId));
      let link: string | null = null;
      if (selected[0]) {
        try {
          link = explore(config, buildMetricExpr(selected[0], {
            logql: query.logql, aggregation: query.aggregation, splitBy: query.splitBy, bucketSeconds, testRunId: run.testRunId,
          }));
        } catch {
          link = null;
        }
      }
      const additive = (() => { try { return parseAggregation(query.aggregation).combine === 'sum'; } catch { return false; } })();
      const series = stats
        .filter((st) => st.application_dashboard_id === query.applicationDashboardId && st.panel_id === query.panelId)
        .map((st) => ({
          name: st.metric_name,
          mean: st.mean,
          peak: st.max_value,
          // A count/bytes/sum panel's mean per bucket times its buckets is the window's total.
          total: additive && st.mean !== null && st.count !== null ? Math.round(st.mean * st.count) : null,
        }))
        .sort((a, b) => (b.total ?? b.mean ?? 0) - (a.total ?? a.mean ?? 0));
      return {
        panelId: query.panelId,
        applicationDashboardId: query.applicationDashboardId ?? null,
        metricsSourceId: query.metricsSourceId ?? null,
        dashboardLabel: query.dashboardLabel,
        title: query.panelTitle,
        aggregation: query.aggregation,
        splitBy: query.splitBy,
        unit: query.metricUnit,
        isLevelPanel: !!config && query.splitBy === config.levelLabel && /^count$/i.test(query.aggregation.trim()),
        series,
        link,
      };
    });

    const baseline = await this.resolveBaseline(run, start, baselineParam);
    const insights = await this.runInsights(run.testRunId, configById, start, end, mappings, baseline.testRunIds);
    // A level panel with nothing but `(none)` means the level label is on none of the lines. The
    // per-application snapshot grouped on the same label, so it holds no errors either: show no
    // error rate rather than a 0% that reads as "clean".
    const levelPanel = panels.find((p) => p.isLevelPanel && p.series.length > 0);
    const levelMissing = !!levelPanel && levelLabelMissing(levelPanel.series);
    // The level panel's ratio when there is one; otherwise the per-application snapshot's.
    const errorRate = levelMissing ? null : (await this.errorRate(run.testRunId, panels, baseline)) ?? errorRateFromServices(insights.services);
    const firstConfig = configById.get(queries[0]!.lokiConfigId);

    return {
      configured: true as const,
      connection: firstConfig
        ? {
          id: firstConfig.id, label: firstConfig.label, levelLabel: firstConfig.levelLabel,
          levelParser: firstConfig.levelParser || 'none', serviceLabel: firstConfig.serviceLabel || 'service_name',
        }
        : null,
      levelLabelMissing: levelMissing,
      // What every "vs baseline" figure on the card was compared against, so the card can say so.
      baseline: { kind: baseline.kind, testRunIds: baseline.testRunIds },
      sources: mappings.map((m) => ({
        id: m.id, level: m.level, selector: m.selector, labels: m.labels,
        exploreUrl: explore(configById.get(m.lokiConfigId), m.selector),
      })),
      window: start ? { from: start.toISOString(), to: end.toISOString() } : null,
      errorRate,
      panels: panels.map(({ applicationDashboardId: _a, metricsSourceId: _m, ...p }) => p),
      ...insights,
    };
  }

  /**
   * The runs every "vs baseline" figure on the card compares against.
   *
   * - `control-group` (the picker's default when the run has one): the run's ADAPT control group.
   *   The error rate uses its pooled statistics; patterns and applications use its newest
   *   NEW_PATTERN_BASELINE_RUNS runs, since a snapshot read per run.
   * - a test run id: that one run, which must be a run of the same workload (the picker lists them).
   * - absent: the control group, else the workload's NEW_PATTERN_BASELINE_RUNS previous completed runs.
   */
  private async resolveBaseline(run: TestRun, start: Date | null, param?: string): Promise<LokiBaseline> {
    const q = withRequestQuery(this.dataSource);
    if (param && param !== CONTROL_GROUP_BASELINE) {
      const pinned = param === run.testRunId ? null : await withRequestEm(this.testRunRepo).findOne({
        where: { testRunId: param, systemUnderTestId: run.systemUnderTestId, testEnvironment: run.testEnvironment, workload: run.workload },
      });
      // Same answer for a run that does not exist, one in another workload and one the caller cannot see.
      if (!pinned) throw new NotFoundException('Baseline run not found in this workload');
      return { kind: 'run', testRunIds: [pinned.testRunId], controlGroupId: null, controlGroupRuns: 0 };
    }
    let group: Awaited<ReturnType<typeof loadControlGroupForRun>> = null;
    try {
      group = await loadControlGroupForRun(q, run.testRunId);
    } catch (err) {
      this.logger.warn(`Loki baseline: control group for ${run.testRunId} unavailable: ${errMsg(err)}`);
    }
    if (group) {
      return {
        kind: 'control-group',
        testRunIds: group.testRuns.filter((id) => id !== run.testRunId).slice(-NEW_PATTERN_BASELINE_RUNS),
        controlGroupId: group.id,
        controlGroupRuns: group.nTestRuns,
      };
    }
    if (param === CONTROL_GROUP_BASELINE || !start) return { kind: 'none', testRunIds: [], controlGroupId: null, controlGroupRuns: 0 };
    const prev = await q.query(
      `SELECT test_run_id FROM test_runs
        WHERE system_under_test_id = $1 AND test_environment = $2 AND workload = $3
          AND completed = true AND test_run_id <> $4 AND start_time < $5
        ORDER BY start_time DESC LIMIT $6`,
      [run.systemUnderTestId, run.testEnvironment, run.workload, run.testRunId, start, NEW_PATTERN_BASELINE_RUNS],
    ) as Array<{ test_run_id: string }>;
    const ids = prev.map((r) => r.test_run_id);
    return { kind: ids.length > 0 ? 'previous-runs' : 'none', testRunIds: ids, controlGroupId: null, controlGroupRuns: 0 };
  }

  /**
   * Error lines and their share of all lines, from the level panel (split by the connection's level
   * label, aggregation count), against the same ratio in the run's control group. A ratio, so it is
   * comparable across runs with different bucket sizes, which raw counts per bucket are not.
   */
  private async errorRate(
    testRunId: string,
    panels: Array<{ isLevelPanel: boolean; panelId: number; applicationDashboardId: string | null; metricsSourceId: string | null; series: Array<{ name: string; total: number | null; mean: number | null }> }>,
    source: LokiBaseline,
  ) {
    const levelPanel = panels.find((p) => p.isLevelPanel && p.series.length > 0);
    if (!levelPanel || levelLabelMissing(levelPanel.series)) return null;
    const totals = levelTotals(levelPanel.series);
    if (!totals) return null;
    const pct = totals.total > 0 ? (totals.errors / totals.total) * 100 : 0;
    let baseline: { errorRatePct: number; runs: number } | null = null;
    try {
      // The run is authorized by the caller, and a pinned baseline run by resolveBaseline;
      // ds_control_groups has no RLS of its own.
      const q = withRequestQuery(this.dataSource);
      const dashboardId = levelPanel.applicationDashboardId;
      let rows: Array<{ metric_name: string | null; mean: number | null }> = [];
      let runs = 0;
      if (dashboardId && source.kind === 'control-group' && source.controlGroupId) {
        rows = await loadControlGroupStatistics(q, source.controlGroupId, { applicationDashboardId: dashboardId, panelId: levelPanel.panelId });
        runs = source.controlGroupRuns;
      } else if (dashboardId && source.testRunIds.length > 0) {
        // A pinned run, or the previous runs: each run's own error ratio from its level panel, then
        // averaged over the runs. Pooling the per-bucket means instead would weigh a run with longer
        // buckets (larger means) more.
        const raw = await q.query(
          `SELECT test_run_id, metric_name, mean FROM ds_metric_statistics
            WHERE test_run_id = ANY($1::varchar[]) AND application_dashboard_id = $2 AND panel_id = $3`,
          [source.testRunIds, dashboardId, levelPanel.panelId],
        ) as Array<{ test_run_id: string; metric_name: string | null; mean: number | null }>;
        const ratios = [...new Set(raw.map((r) => r.test_run_id))]
          .map((id) => levelRatio(raw.filter((r) => r.test_run_id === id)))
          .filter((x): x is number => x !== null);
        if (ratios.length > 0) baseline = { errorRatePct: (ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100, runs: ratios.length };
      }
      // The control group's statistics are already pooled into one mean per level.
      if (!baseline && rows.length > 0) {
        const ratio = levelRatio(rows);
        if (ratio !== null) baseline = { errorRatePct: ratio * 100, runs };
      }
    } catch (err) {
      this.logger.warn(`Loki baseline error rate for ${testRunId} unavailable: ${errMsg(err)}`);
    }
    return { totalLines: totals.total, errorLines: totals.errors, errorRatePct: pct, baseline };
  }

  /**
   * The pattern, sample-line and per-application snapshots. Each pattern is marked new against the
   * baseline runs' snapshots of the same scope (all streams, or that application); each application
   * gets its error rate and the same ratio pooled over the baseline runs.
   */
  private async runInsights(
    testRunId: string,
    configById: Map<string, LokiConfig>,
    start: Date | null,
    end: Date,
    mappings: LokiStreamMapping[],
    baselineRuns: string[],
  ) {
    const q = withRequestQuery(this.dataSource);
    const present = await q.query(
      `SELECT to_regclass('public.loki_run_patterns') IS NOT NULL AS patterns, to_regclass('public.loki_run_services') IS NOT NULL AS services`,
    ) as Array<{ patterns: boolean; services: boolean }>;
    if (!present[0]?.patterns) return { patterns: [], patternsSource: null, newPatterns: null, baselineRunCount: 0, samples: [], services: [] };
    // Before migration 1839 there is no service column: every row is an all-streams row.
    const perService = !!present[0]?.services;
    const serviceCol = perService ? 'service' : 'NULL::varchar AS service';

    type PatternRow = { loki_config_id: string | null; pattern: string; pattern_key: string; level: string | null; count: string; first_seen: Date | null; last_seen: Date | null; source: string; service: string | null };
    const patternRows = await q.query(
      `SELECT loki_config_id, pattern, pattern_key, level, count::bigint AS count, first_seen, last_seen, source, ${serviceCol}
         FROM loki_run_patterns WHERE test_run_id = $1 ORDER BY count DESC LIMIT 1000`,
      [testRunId],
    ) as PatternRow[];
    const sampleRows = await q.query(
      `SELECT loki_config_id, "time", level, line, labels, ${serviceCol} FROM loki_run_samples WHERE test_run_id = $1 ORDER BY "time" DESC LIMIT 1000`,
      [testRunId],
    ) as Array<{ loki_config_id: string | null; time: Date; level: string | null; line: string; labels: Record<string, string>; service: string | null }>;
    type ServiceRow = { service: string; total: string; errors: string; warns: string; loki_config_id: string | null };
    const serviceRows = perService
      ? await q.query(
          `SELECT service, SUM(total_lines)::bigint AS total, SUM(error_lines)::bigint AS errors, SUM(warn_lines)::bigint AS warns,
                  MIN(loki_config_id::text) AS loki_config_id
             FROM loki_run_services WHERE test_run_id = $1 GROUP BY service`,
          [testRunId],
        ) as ServiceRow[]
      : [];

    // Known pattern keys per scope ('' = all streams). A scope with no baseline snapshot at all
    // cannot be judged: "new" is null for it, never claimed without evidence. Per-application scopes
    // are judged once any baseline run has per-application rows; an application missing from all of
    // them is itself new, so all its patterns are.
    const known = new Map<string, Set<string>>();
    let baselineHasServices = false;
    const baselineServices = new Map<string, { total: number; errors: number; runs: Set<string> }>();
    if (baselineRuns.length > 0) {
      const rows = await q.query(
        `SELECT DISTINCT ${perService ? "COALESCE(service, '')" : "''"} AS scope, pattern_key FROM loki_run_patterns WHERE test_run_id = ANY($1::varchar[])`,
        [baselineRuns],
      ) as Array<{ scope: string; pattern_key: string }>;
      for (const r of rows) {
        if (r.scope) baselineHasServices = true;
        const set = known.get(r.scope) ?? new Set<string>();
        set.add(r.pattern_key);
        known.set(r.scope, set);
      }
      if (perService) {
        const svc = await q.query(
          `SELECT test_run_id, service, total_lines::bigint AS total, error_lines::bigint AS errors
             FROM loki_run_services WHERE test_run_id = ANY($1::varchar[])`,
          [baselineRuns],
        ) as Array<{ test_run_id: string; service: string; total: string; errors: string }>;
        for (const r of svc) {
          baselineHasServices = true;
          const b = baselineServices.get(r.service) ?? { total: 0, errors: 0, runs: new Set<string>() };
          b.total += Number(r.total);
          b.errors += Number(r.errors);
          b.runs.add(r.test_run_id);
          baselineServices.set(r.service, b);
        }
      }
    }
    const isNewIn = (scope: string, key: string): boolean | null => {
      if (scope === '') return known.has('') ? !known.get('')!.has(key) : null;
      if (!baselineHasServices) return null;
      return !(known.get(scope)?.has(key) ?? false);
    };

    const serviceLabelOf = (configId: string | null): string =>
      (configId ? configById.get(configId)?.serviceLabel : undefined) || 'service_name';
    const explore = (configId: string | null, service: string | null, pipeline: string): string | null => {
      const config = configId ? configById.get(configId) : undefined;
      const g = config?.grafanaInstance;
      const mapping = mappings.find((m) => m.lokiConfigId === configId);
      if (!config || !g || !start || !mapping) return null;
      try {
        const only = service ? `${labelFilter(serviceLabelOf(configId), service)} ` : '';
        return lokiExploreUrl(g.client_url, g.orgId, config.datasourceUid, buildLogExpr(mapping, `${only}${pipeline}`.trim()), start, end);
      } catch {
        return null;
      }
    };

    const patterns = patternRows.map((r) => ({
      pattern: r.pattern,
      level: normalizeLevel(r.level),
      count: Number(r.count),
      firstSeen: r.first_seen ? new Date(r.first_seen).toISOString() : null,
      lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null,
      source: r.source,
      service: r.service ?? null,
      isNew: isNewIn(r.service ?? '', r.pattern_key),
      // `|>` is Loki's pattern match filter (Loki 3.1+); on older Loki Explore shows the parse error.
      exploreUrl: explore(r.loki_config_id, r.service ?? null, `|> ${JSON.stringify(r.pattern)}`),
    }));
    const overall = patterns.filter((p) => p.service === null);
    const newOf = (scope: string | null) => {
      const ps = patterns.filter((p) => p.service === scope);
      return ps.some((p) => p.isNew === null) || (scope === null ? !known.has('') : !baselineHasServices) ? null : ps.filter((p) => p.isNew).length;
    };

    const services = serviceRows
      .map((r) => {
        const total = Number(r.total);
        const errors = Number(r.errors);
        const b = baselineServices.get(r.service);
        return {
          service: r.service,
          totalLines: total,
          errorLines: errors,
          warnLines: Number(r.warns),
          errorRatePct: total > 0 ? (errors / total) * 100 : 0,
          baseline: b && b.total > 0 ? { errorRatePct: (b.errors / b.total) * 100, runs: b.runs.size } : null,
          /** Absent from every baseline run's snapshot; null when the baseline has no per-application snapshot. */
          isNew: baselineHasServices ? !b : null,
          newPatterns: newOf(r.service),
          exploreUrl: explore(r.loki_config_id, r.service === '(none)' ? null : r.service, ''),
        };
      })
      .sort((a, b) => b.errorLines - a.errorLines || b.totalLines - a.totalLines || a.service.localeCompare(b.service));

    return {
      patterns,
      patternsSource: (overall[0] ?? patternRows[0])?.source ?? null,
      newPatterns: newOf(null),
      baselineRunCount: known.size === 0 && baselineServices.size === 0 ? 0 : baselineRuns.length,
      samples: sampleRows.map((r) => ({
        time: new Date(r.time).toISOString(),
        level: normalizeLevel(r.level),
        line: r.line,
        labels: r.labels ?? {},
        service: r.service ?? null,
      })),
      services,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async mappingsInScope(systemUnderTestId: string, testEnvironment?: string, workload?: string, lokiConfigId?: string) {
    const qb = withRequestEm(this.mappingRepo)
      .createQueryBuilder('m')
      .where('m.system_under_test_id = :systemUnderTestId', { systemUnderTestId })
      .orderBy('m.selector', 'ASC');
    if (lokiConfigId) qb.andWhere('m.loki_config_id = :lokiConfigId', { lokiConfigId });
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
        s: scope.systemUnderTestId, e: scope.testEnvironment, w: scope.workload, d: dashboardLabel,
      })
      .getRawOne<{ max: string | number }>();
    return Number(row?.max ?? 0) + 1;
  }

  /**
   * The rows a Loki panel's ds_metrics hang off, exactly as Splunk's (see SplunkService): a
   * synthetic grafana_dashboards row with grafana_json NULL, an application_dashboards row with
   * grafana_instance_id NULL and a deterministic id over (system, environment, workload, label),
   * and a metrics_sources row with source_type 'loki'. The synthetic row hangs off the Grafana
   * instance the connection queries through, which is in the system's organization by construction.
   */
  private async ensureArtificialDashboard(
    sut: SystemUnderTest,
    scope: ScopeRef,
    dashboardLabel: string,
    config: LokiConfig,
  ): Promise<{ applicationDashboardId: string; metricsSourceId: string }> {
    const em = withRequestQuery(this.dataSource);
    const applicationDashboardId = generateDeterministicUuid(
      `${scope.systemUnderTestId}-${scope.testEnvironment}-${scope.workload}-loki-${dashboardLabel}`,
    );
    const slug = dashboardLabel.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const dashboardUid = `loki-${slug || applicationDashboardId.slice(0, 8)}`;

    const existing = await em.query<Array<{ id: string }>>('SELECT id FROM application_dashboards WHERE id = $1', [applicationDashboardId]);
    if (existing.length === 0) {
      const grafanaInstanceId = config.grafanaInstanceId;
      const gd = await em.query<Array<{ id: string }>>(
        'SELECT id FROM grafana_dashboards WHERE uid = $1 AND grafana_instance_id = $2',
        [dashboardUid, grafanaInstanceId],
      );
      let grafanaDashboardId = gd[0]?.id;
      if (!grafanaDashboardId) {
        const inserted = await em.query<Array<{ id: string }>>(
          `INSERT INTO grafana_dashboards (grafana_instance_id, grafana_id, uid, name, panels, organization_id)
           VALUES ($1, $2, $3, $4, '[]', $5) RETURNING id`,
          [grafanaInstanceId, 600000 + Math.floor(Math.random() * 100000), dashboardUid, dashboardLabel, sut.organization_id],
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
        sourceType: 'loki',
        sourceConfigId: config.id,
        externalRef: config.id,
        displayName: config.label,
        displayLabel: scope.workload,
        organizationId: sut.organization_id,
      },
      { conflictPaths, skipUpdateIfNoValuesChanged: true },
    );
    const source = await withRequestEm(this.metricsSourceRepo).findOneOrFail({
      where: { systemUnderTestId: sut.id, testEnvironment: scope.testEnvironment, sourceType: 'loki', externalRef: config.id, displayLabel: scope.workload },
    });
    return { applicationDashboardId, metricsSourceId: source.id };
  }

  private checkQuery(logql: string, aggregation?: string | null): void {
    const problem = validateLogqlPipeline(logql);
    if (problem) throw new BadRequestException(problem);
    try {
      parseAggregation(aggregation);
    } catch (err) {
      throw new BadRequestException(errMsg(err));
    }
  }

  /**
   * Lists the labels, then checks where the lines keep their level (`detectLokiLevelSource`) over
   * streams picked by the service label, or the first label Loki reports. `level` is what was found;
   * the message says whether the configured parser and label find levels, and if not, which would.
   */
  private async probe(conn: LokiConnection, opts: LokiRequestOptions, configured: { label: string; parser: string; serviceLabel: string }) {
    let labels: string[];
    try {
      ({ labels } = await lokiTestConnection(conn, opts));
    } catch (err) {
      this.logger.warn(`Loki connection test via ${hostForLog(conn.baseUrl)} failed: ${errMsg(err)}${err instanceof LokiError && err.detail ? ` | cause: ${err.detail}` : ''}`);
      return { success: false, message: errMsg(err) };
    }
    if (labels.length === 0) {
      return { success: true, message: 'Connected, but Loki reported no labels in the last hour. Check the datasource uid and that logs are flowing.', labels, level: null };
    }
    const selectorLabel = labels.includes(configured.serviceLabel) ? configured.serviceLabel : labels[0]!;
    const level = await detectLokiLevelSource(conn, `{${selectorLabel}=~".+"}`, configured, opts);
    const connected = `Connected. Loki has ${labels.length} label${labels.length === 1 ? '' : 's'} in the last hour: ${labels.slice(0, 8).join(', ')}${labels.length > 8 ? ', …' : ''}.`;
    return { success: true, message: `${connected} ${describeLevelProbe(configured, level)}`, labels, level };
  }

  private grafanaConnection(g: GrafanaInstance): Omit<LokiConnection, 'datasourceUid'> {
    return { baseUrl: g.server_url || g.client_url, grafanaOrgId: g.orgId, apiKey: g.apiKey, username: g.username, password: g.password, label: g.label };
  }

  private connectionOf(c: LokiConfig, g: GrafanaInstance): LokiConnection {
    return { ...this.grafanaConnection(g), datasourceUid: c.datasourceUid, label: `${g.label} / ${c.label}` };
  }

  private async requestOptions(g: GrafanaInstance): Promise<LokiRequestOptions> {
    const agents = await this.proxyResolver.resolve(g.organizationId, !!g.useProxy);
    return agents ? { dispatcher: agents.dispatcher } : {};
  }

  private async cached(key: string, refresh: boolean, load: () => Promise<string[]>): Promise<string[]> {
    const hit = this.labelCache.get(key);
    if (!refresh && hit && Date.now() - hit.at < LABELS_TTL_MS) return hit.values;
    try {
      const values = await load();
      this.labelCache.set(key, { at: Date.now(), values });
      return values;
    } catch (err) {
      throw this.toHttp(err);
    }
  }

  private clearLabelCache(id: string): void {
    for (const key of this.labelCache.keys()) if (key.startsWith(`${id}:`)) this.labelCache.delete(key);
  }

  private toHttp(err: unknown): Error {
    if (err instanceof LokiError) {
      this.logger.warn(`Loki request failed: ${err.message}${err.detail ? ` | cause: ${err.detail}` : ''}`);
      return new BadRequestException(`Loki: ${err.message}`);
    }
    return err as Error;
  }

  private present(c: LokiConfig) {
    const g = c.grafanaInstance;
    return {
      id: c.id,
      label: c.label,
      grafanaInstanceId: c.grafanaInstanceId,
      grafanaInstanceLabel: g?.label ?? null,
      grafanaClientUrl: g?.client_url ?? null,
      datasourceUid: c.datasourceUid,
      datasourceName: c.datasourceName ?? null,
      levelLabel: c.levelLabel,
      levelParser: c.levelParser || 'none',
      serviceLabel: c.serviceLabel || 'service_name',
      maxConcurrentQueries: c.maxConcurrentQueries,
      organizationId: c.organizationId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private async loadGrafanaInstance(id: string, userId: string, roles: string[]): Promise<GrafanaInstance> {
    const instance = await withRequestEm(this.grafanaRepo).findOne({ where: { id } });
    if (!instance) throw new NotFoundException('Grafana instance not found');
    const access = await this.authzService.canAccessResource(userId, roles, { organization_id: instance.organizationId, created_by: '' } as OwnedResource);
    if (!access.allowed) throw new NotFoundException('Grafana instance not found');
    return instance;
  }

  private async loadConfig(id: string, userId: string, roles: string[]): Promise<LokiConfig> {
    const config = await withRequestEm(this.configRepo).findOne({ where: { id }, relations: { grafanaInstance: true } });
    if (!config || !config.grafanaInstance) throw new NotFoundException('Loki connection not found');
    const access = await this.authzService.canAccessResource(userId, roles, { organization_id: config.organizationId, created_by: '' } as OwnedResource);
    if (!access.allowed) throw new NotFoundException('Loki connection not found');
    return config;
  }

  private async requireSameOrgConfig(configId: string, sut: SystemUnderTest, userId: string, roles: string[]): Promise<LokiConfig> {
    const config = await this.loadConfig(configId, userId, roles);
    if (config.organizationId !== sut.organization_id) {
      throw new BadRequestException('That Loki connection belongs to another organization than this system');
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
      if (mode === 'write' && (await this.authzService.canAccessResource(userId, roles, resource)).allowed) {
        throw new ForbiddenException('You cannot change this system');
      }
      throw new NotFoundException(notFound);
    }
    return sut;
  }

  private async loadQuery(id: string, userId: string, roles: string[]): Promise<LokiQuery> {
    const query = await withRequestEm(this.queryRepo).findOne({ where: { id } });
    if (!query) throw new NotFoundException('Loki panel not found');
    await this.loadSut(query.systemUnderTestId, userId, roles, 'write', 'Loki panel not found');
    return query;
  }

  private async requireCapability(userId: string, roles: string[], organizationId: string, capability: string): Promise<void> {
    const caps = await this.authzService.getCapabilities(userId, roles, organizationId);
    if (!caps.includes(capability as (typeof caps)[number])) {
      throw new ForbiddenException('You do not have permission to manage Loki connections in this organization');
    }
  }

  /** A unique violation is a 409 the user can act on, not a 500. No work follows it, so no SAVEPOINT. */
  // audit-skip: helper; every caller audits the saved row itself
  private async saveUnique<T extends object>(repo: Repository<T>, entity: T, conflictMessage: string): Promise<T> {
    try {
      return await withRequestEm(repo).save(entity);
    } catch (err) {
      if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') throw new ConflictException(conflictMessage);
      throw err;
    }
  }
}

