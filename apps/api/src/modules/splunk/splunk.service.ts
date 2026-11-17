import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { OwnedResource } from '@perfana/shared';
import {
  buildEntitiesClause,
  expandSplTemplate,
  findForbiddenSplCommand,
  splunkDiscoverSources,
  splunkFieldSummary,
  splunkServerInfo,
  splunkTimechart,
  SplunkConnection,
  SplunkDiscoveredSource,
  SplunkError,
  SplunkRequestOptions,
} from '@perfana/shared/services/splunk/client';
import { SplunkConfig, SplunkEntityMapping, SplunkQuery, SystemUnderTest } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
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
    if (dto.host !== undefined) entity.host = this.checkHost(dto.host);
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
    this.discoveryCache.delete(id);
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
    this.discoveryCache.delete(id);
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
    return this.probe(this.connectionOf(config), await this.requestOptions(config.organizationId, config.useProxy));
  }

  async discoverSources(id: string, userId: string, roles: string[], hours = 24, refresh = false): Promise<SplunkDiscoveredSource[]> {
    const config = await this.loadConfig(id, userId, roles);
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
    await this.requireSameOrgConfig(dto.splunkConfigId, sut, userId, roles);
    this.checkSpl(dto.spl);
    const dashboardLabel = dto.dashboardLabel?.trim() || 'Splunk logs';
    const panelId = dto.panelId ?? (await this.nextPanelId(dto, dashboardLabel));

    const entity = this.queryRepo.create({
      splunkConfigId: dto.splunkConfigId,
      systemUnderTestId: sut.id,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      dashboardLabel,
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
    if (dto.dashboardLabel !== undefined) entity.dashboardLabel = dto.dashboardLabel.trim() || 'Splunk logs';
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
    const sut = await this.loadSut(dto.systemUnderTestId, userId, roles, 'read');
    const config = await this.requireSameOrgConfig(dto.splunkConfigId, sut, userId, roles);
    this.checkSpl(dto.spl);
    const mappings = await this.mappingsInScope(sut.id, dto.testEnvironment, dto.workload, dto.splunkConfigId);
    const filter = expandSplTemplate(dto.spl, mappings);
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
      const [points, fields] = await Promise.all([
        splunkTimechart(conn, { filter, from, to, bucketSeconds, aggregation: dto.aggregation, splitBy: dto.splitBy, maxSeries: dto.maxSeries }, opts),
        // ponytail: field summary only on the plain filter (no pipes), since fieldsummary after a
        // rex/eval would need the whole pipeline; the starter panels' split fields are named anyway.
        filter.includes('|') ? Promise.resolve([]) : splunkFieldSummary(conn, filter, opts),
      ]);
      const totals = new Map<string, number>();
      for (const p of points) totals.set(p.series, (totals.get(p.series) ?? 0) + p.value);
      return {
        search: filter,
        bucketSeconds,
        series: [...totals.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
        points: points.length,
        fields,
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

  private checkSpl(spl: string): void {
    const forbidden = findForbiddenSplCommand(spl);
    if (forbidden) throw new BadRequestException(`The SPL command "${forbidden}" is not allowed in a Perfana query`);
    if (/\|\s*timechart\b/i.test(spl)) {
      throw new BadRequestException('Leave out "| timechart": Perfana adds it with the run window and bucket size');
    }
    if (/\b(earliest|latest)\s*=/i.test(spl)) {
      throw new BadRequestException('Leave out earliest/latest: Perfana sets the time range from the test run');
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
      const hint = err instanceof SplunkError && err.status === undefined
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
      this.logger.warn(`Splunk request failed: ${err.message}`);
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
