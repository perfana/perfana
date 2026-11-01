import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { ApplicationDashboard, SeriesGroupingRule } from '@perfana/shared/entities';
import { OwnedResource } from '@perfana/shared';
import {
  compileSeriesGroupingRule,
  type SeriesGroupingAggregation,
  type SeriesGroupingPreset,
} from '@perfana/shared/utils';
import { getRequestEm, withRequestEm } from '../../common/db/request-em';
import { AuditService } from '../audit/audit.service';
import type { CreateSeriesGroupingRuleDto, SeriesGroupingCopyTargetDto } from './dto/create-series-grouping-rule.dto';
import type { UpdateSeriesGroupingRuleDto } from './dto/update-series-grouping-rule.dto';
import type {
  SeriesGroupingCopySkipDto,
  SeriesGroupingCreateResultDto,
  SeriesGroupingRuleResponseDto,
} from './dto/series-grouping-rule-response.dto';
import { DUPLICATE_SLOT_MESSAGE, isDuplicateSeriesGroupingSlot } from './duplicate-rule';

/** Perf-test dashboards have stable series names and their own live statistics writer. */
const PERF_TEST_DASHBOARD_UID_PREFIX = 'performance-test-metrics-';

export interface SeriesGroupingRuleQuery {
  systemId: string;
  environment?: string;
  workload?: string;
  applicationDashboardId?: string;
}

/** What makes a rule a rule: everything a recalculation depends on. */
interface RuleFields {
  preset: SeriesGroupingPreset;
  pattern: string | null;
  replacement: string;
  aggregation: SeriesGroupingAggregation;
  trackMemberCount: boolean;
}

/**
 * Series grouping rules (docs/design/2026-11-01-series-grouping-design.md): a per-workload rule
 * that rewrites raw series names on a panel — or every panel of an application dashboard — to
 * group names, so StatisticsPipeline compares a workload's pods as one series across deployments.
 *
 * Authorization is the root CLAUDE.md #48 shape. Every method takes `accessibleOrgIds` as a
 * REQUIRED parameter (`null` = global admin); a rule or dashboard outside it answers 404, never
 * 403, so the id's existence is not confirmed; an empty list answers `[]` early. The rule's
 * organization and team are inherited from its application dashboard, which is authorized
 * BEFORE it is inherited — RLS does not backstop a caller-named organization on create
 * (apps/api/CLAUDE.md).
 *
 * A saved rule changes nothing by itself: it takes effect on the next statistics recalculation
 * of a run (`POST /series-grouping-rules/apply`).
 */
@Injectable()
export class SeriesGroupingService {
  private readonly logger = new Logger(SeriesGroupingService.name);

  constructor(
    @InjectRepository(SeriesGroupingRule)
    private readonly ruleRepo: Repository<SeriesGroupingRule>,
    @InjectRepository(ApplicationDashboard)
    private readonly appDashRepo: Repository<ApplicationDashboard>,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: SeriesGroupingRuleQuery, accessibleOrgIds: string[] | null): Promise<SeriesGroupingRuleResponseDto[]> {
    if (accessibleOrgIds !== null && accessibleOrgIds.length === 0) return [];
    const where: FindOptionsWhere<SeriesGroupingRule> = { systemUnderTestId: query.systemId };
    if (query.environment) where.testEnvironment = query.environment;
    if (query.workload) where.workload = query.workload;
    if (query.applicationDashboardId) where.applicationDashboardId = query.applicationDashboardId;
    if (accessibleOrgIds !== null) where.organizationId = In(accessibleOrgIds);

    const rules = await withRequestEm(this.ruleRepo).find({
      where,
      order: { testEnvironment: 'ASC', workload: 'ASC', applicationDashboardId: 'ASC', panelId: { direction: 'ASC', nulls: 'FIRST' } },
    });
    return rules.map((r) => this.toDto(r));
  }

  async findOne(id: string, accessibleOrgIds: string[] | null): Promise<SeriesGroupingRuleResponseDto> {
    return this.toDto(await this.loadAuthorized(id, accessibleOrgIds));
  }

  async create(
    dto: CreateSeriesGroupingRuleDto,
    userId: string,
    accessibleOrgIds: string[] | null,
  ): Promise<SeriesGroupingCreateResultDto> {
    const fields = this.ruleFields(dto.preset, dto.pattern ?? null, dto.replacement ?? null, dto.aggregation, dto.trackMemberCount);

    // Authorize the caller-supplied parent BEFORE inheriting its organization.
    const dashboard = await this.loadAuthorizedDashboard(dto.applicationDashboardId, dto.systemUnderTestId, dto.testEnvironment, accessibleOrgIds);
    this.refusePerfTestDashboard(dashboard);

    const panelId = dto.panelId ?? null;
    const rule = this.ruleRepo.create({
      systemUnderTestId: dto.systemUnderTestId,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      applicationDashboardId: dashboard.id,
      panelId,
      ...fields,
      enabled: dto.enabled ?? true,
      origin: dto.origin ?? 'manual',
      organizationId: dashboard.organizationId,
      teamId: dashboard.teamId,
      createdBy: userId,
      updatedBy: userId,
    });

    let saved: SeriesGroupingRule;
    try {
      saved = await withRequestEm(this.ruleRepo).save(rule);
    } catch (error) {
      if (isDuplicateSeriesGroupingSlot(error)) throw new ConflictException(DUPLICATE_SLOT_MESSAGE);
      throw error;
    }
    this.auditService.logCreate(saved as unknown as OwnedResource, { organizationIdOverride: saved.organizationId });

    const copies = await this.createCopies(saved, dashboard, dto.copyTo ?? [], userId, accessibleOrgIds);
    return { rule: this.toDto(saved), copies };
  }

  async update(
    id: string,
    dto: UpdateSeriesGroupingRuleDto,
    userId: string,
    accessibleOrgIds: string[] | null,
  ): Promise<SeriesGroupingRuleResponseDto> {
    const rule = await this.loadAuthorized(id, accessibleOrgIds);
    const before = Object.assign(new SeriesGroupingRule(), rule);

    // `PartialType` + `@IsOptional()` lets `null` through as well as an absent key; nothing here
    // is nullable, so both mean "leave it". The slot fields are not on the DTO and are never read.
    const preset = dto.preset ?? rule.preset;
    const switchingToCustom = preset === 'custom';
    const fields = this.ruleFields(
      preset,
      switchingToCustom ? (dto.pattern ?? rule.pattern) : null,
      switchingToCustom ? (dto.replacement ?? rule.replacement) : null,
      dto.aggregation ?? rule.aggregation,
      dto.trackMemberCount ?? rule.trackMemberCount,
    );
    Object.assign(rule, fields, { enabled: dto.enabled ?? rule.enabled, updatedBy: userId });

    const saved = await withRequestEm(this.ruleRepo).save(rule);
    this.auditService.logUpdate(before as unknown as OwnedResource, saved as unknown as OwnedResource, {
      organizationIdOverride: saved.organizationId,
    });
    return this.toDto(saved);
  }

  async remove(id: string, accessibleOrgIds: string[] | null): Promise<void> {
    const rule = await this.loadAuthorized(id, accessibleOrgIds);
    const snapshot = Object.assign(new SeriesGroupingRule(), rule);
    await withRequestEm(this.ruleRepo).remove(rule);
    this.auditService.logDelete(snapshot as unknown as OwnedResource, { organizationIdOverride: snapshot.organizationId });
  }

  // ------------------------------------------------------------------------------------------

  /**
   * Normalise and validate the rule fields. A built-in preset carries its own regex, so a pattern
   * or replacement sent with one is dropped (`ck_series_grouping_rules_custom_pattern` requires
   * the pattern to be NULL there). A custom pattern must pass the same ReDoS guard the worker
   * applies, or the worker would skip the rule with a warning nobody reads.
   */
  private ruleFields(
    preset: SeriesGroupingPreset,
    pattern: string | null,
    replacement: string | null,
    aggregation: SeriesGroupingAggregation,
    trackMemberCount: boolean,
  ): RuleFields {
    const fields: RuleFields =
      preset === 'custom'
        ? { preset, pattern: pattern || null, replacement: replacement ?? '', aggregation, trackMemberCount }
        : { preset, pattern: null, replacement: '', aggregation, trackMemberCount };
    const compiled = compileSeriesGroupingRule(fields);
    if (!compiled.ok) throw new BadRequestException(compiled.error ?? 'Invalid series grouping rule');
    return fields;
  }

  private async loadAuthorized(id: string, accessibleOrgIds: string[] | null): Promise<SeriesGroupingRule> {
    const rule = await withRequestEm(this.ruleRepo).findOne({ where: { id } });
    if (!rule) throw new NotFoundException(`Series grouping rule ${id} not found`);
    if (accessibleOrgIds !== null && !accessibleOrgIds.includes(rule.organizationId)) {
      this.logger.warn(`Cross-tenant access refused for series grouping rule ${id}`);
      throw new NotFoundException(`Series grouping rule ${id} not found`);
    }
    return rule;
  }

  /**
   * The rule's dashboard, which must belong to the named system AND environment (application
   * dashboards are per system and environment, shared by its workloads) and to one of the
   * caller's organizations. Every failure is the same 404.
   */
  private async loadAuthorizedDashboard(
    applicationDashboardId: string,
    systemUnderTestId: string,
    testEnvironment: string,
    accessibleOrgIds: string[] | null,
  ): Promise<ApplicationDashboard> {
    const dashboard = await withRequestEm(this.appDashRepo).findOne({ where: { id: applicationDashboardId } });
    const notFound = new NotFoundException(`Application dashboard ${applicationDashboardId} not found`);
    if (!dashboard) throw notFound;
    if (dashboard.systemUnderTestId !== systemUnderTestId || dashboard.testEnvironment !== testEnvironment) throw notFound;
    if (accessibleOrgIds !== null && !accessibleOrgIds.includes(dashboard.organizationId)) {
      this.logger.warn(`Cross-tenant series grouping rule refused for dashboard ${applicationDashboardId}`);
      throw notFound;
    }
    return dashboard;
  }

  private refusePerfTestDashboard(dashboard: ApplicationDashboard): void {
    if ((dashboard.dashboardUid ?? '').startsWith(PERF_TEST_DASHBOARD_UID_PREFIX)) {
      throw new BadRequestException(
        'Performance test dashboards cannot be grouped: their series names are stable across runs.',
      );
    }
  }

  /**
   * Create the same rule for other workloads of the system (design Decision 2). Each copy is its
   * own row (`origin = 'copy'`), so it can diverge later; a slot that already has a rule is never
   * overwritten. Nothing here recalculates: only the caller's own workload is re-evaluated, and
   * the copies' workloads show the stale notice until someone recalculates them.
   */
  private async createCopies(
    source: SeriesGroupingRule,
    sourceDashboard: ApplicationDashboard,
    targets: SeriesGroupingCopyTargetDto[],
    userId: string,
    accessibleOrgIds: string[] | null,
  ): Promise<{ created: SeriesGroupingRuleResponseDto[]; skipped: SeriesGroupingCopySkipDto[] }> {
    const created: SeriesGroupingRuleResponseDto[] = [];
    const skipped: SeriesGroupingCopySkipDto[] = [];
    const seen = new Set<string>();

    for (const target of targets) {
      const key = `${target.testEnvironment}\u0000${target.workload}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const skip = (reason: SeriesGroupingCopySkipDto['reason']) =>
        skipped.push({ testEnvironment: target.testEnvironment, workload: target.workload, reason });

      if (target.testEnvironment === source.testEnvironment && target.workload === source.workload) {
        skip('same-slot');
        continue;
      }
      if (!(await this.isKnownWorkload(source.systemUnderTestId, target.testEnvironment, target.workload))) {
        skip('unknown-workload');
        continue;
      }

      const resolved = await this.resolveCopyDashboard(sourceDashboard, target.testEnvironment);
      if (typeof resolved === 'string') {
        skip(resolved);
        continue;
      }
      if (accessibleOrgIds !== null && !accessibleOrgIds.includes(resolved.organizationId)) {
        skip('not-writable');
        continue;
      }

      const slot: FindOptionsWhere<SeriesGroupingRule> = {
        systemUnderTestId: source.systemUnderTestId,
        testEnvironment: target.testEnvironment,
        workload: target.workload,
        applicationDashboardId: resolved.id,
        panelId: source.panelId === null ? IsNull() : source.panelId,
      };
      if (await withRequestEm(this.ruleRepo).findOne({ where: slot })) {
        skip('exists');
        continue;
      }

      const copy = this.ruleRepo.create({
        systemUnderTestId: source.systemUnderTestId,
        testEnvironment: target.testEnvironment,
        workload: target.workload,
        applicationDashboardId: resolved.id,
        panelId: source.panelId,
        preset: source.preset,
        pattern: source.pattern,
        replacement: source.replacement,
        aggregation: source.aggregation,
        trackMemberCount: source.trackMemberCount,
        enabled: source.enabled,
        origin: 'copy',
        organizationId: resolved.organizationId,
        teamId: resolved.teamId,
        createdBy: userId,
        updatedBy: userId,
      });
      const saved = await this.saveSkippingDuplicateSlot(copy);
      if (!saved) {
        skip('exists');
        continue;
      }
      created.push(this.toDto(saved));
    }
    return { created, skipped };
  }

  /**
   * The same Grafana dashboard in another environment of the system. Within one environment it
   * IS the source dashboard. Across environments it is matched on `dashboard_uid` AND
   * `grafana_instance_id`, because a uid is unique only within one Grafana instance (root
   * CLAUDE.md, "`grafana_dashboards` is a mixed table", trap 3), and two rows are asked for so an
   * ambiguous match is refused rather than picked (apps/api/CLAUDE.md, "The first-row class").
   */
  private async resolveCopyDashboard(
    source: ApplicationDashboard,
    testEnvironment: string,
  ): Promise<ApplicationDashboard | 'no-dashboard' | 'ambiguous-dashboard'> {
    if (testEnvironment === source.testEnvironment) return source;
    if (!source.dashboardUid) return 'no-dashboard';
    const matches = await withRequestEm(this.appDashRepo).find({
      where: {
        systemUnderTestId: source.systemUnderTestId,
        testEnvironment,
        dashboardUid: source.dashboardUid,
        grafanaInstanceId: source.grafanaInstanceId ?? IsNull(),
      },
      take: 2,
    });
    if (matches.length === 0) return 'no-dashboard';
    if (matches.length > 1) return 'ambiguous-dashboard';
    return matches[0]!;
  }

  /** Configured on the system, or run at least once. */
  private async isKnownWorkload(systemUnderTestId: string, testEnvironment: string, workload: string): Promise<boolean> {
    const rows: Array<{ known?: boolean }> = await withRequestEm(this.ruleRepo).query(
      `SELECT EXISTS (
                SELECT 1
                FROM system_under_test_workloads w
                JOIN system_under_test_test_environments e ON e.id = w.system_under_test_test_environment_id
                WHERE e.system_under_test_id = $1 AND e.name = $2 AND w.name = $3
              )
              OR EXISTS (
                SELECT 1 FROM test_runs
                WHERE system_under_test_id = $1 AND test_environment = $2 AND workload = $3
              ) AS known`,
      [systemUnderTestId, testEnvironment, workload],
    );
    return rows?.[0]?.known === true;
  }

  /**
   * A copy that loses a race for its slot is an "exists", not a failure. Inside the request's RLS
   * transaction a 23505 aborts the transaction (25P02) and every later statement fails with it,
   * so the insert runs under a SAVEPOINT — legal only inside a transaction, hence the
   * `getRequestEm()` gate (apps/api/CLAUDE.md, "Two SLOs on one panel"). Audited here, on success
   * only, so the audit trail never records a copy that lost its race.
   */
  private async saveSkippingDuplicateSlot(rule: SeriesGroupingRule): Promise<SeriesGroupingRule | null> {
    const em = getRequestEm();
    try {
      if (em) await em.query('SAVEPOINT copy_series_grouping_rule');
      const saved = await withRequestEm(this.ruleRepo).save(rule);
      if (em) await em.query('RELEASE SAVEPOINT copy_series_grouping_rule');
      this.auditService.logCreate(saved as unknown as OwnedResource, { organizationIdOverride: saved.organizationId });
      return saved;
    } catch (error) {
      if (em) await em.query('ROLLBACK TO SAVEPOINT copy_series_grouping_rule').catch(() => undefined);
      if (isDuplicateSeriesGroupingSlot(error)) {
        this.logger.warn(`Skipped series grouping copy to ${rule.testEnvironment}/${rule.workload}: slot already has a rule`);
        return null;
      }
      throw error;
    }
  }

  private toDto(rule: SeriesGroupingRule): SeriesGroupingRuleResponseDto {
    return {
      id: rule.id,
      systemUnderTestId: rule.systemUnderTestId,
      testEnvironment: rule.testEnvironment,
      workload: rule.workload,
      applicationDashboardId: rule.applicationDashboardId,
      panelId: rule.panelId ?? null,
      preset: rule.preset,
      pattern: rule.pattern ?? null,
      replacement: rule.replacement ?? '',
      aggregation: rule.aggregation,
      trackMemberCount: rule.trackMemberCount,
      enabled: rule.enabled,
      origin: rule.origin,
      createdBy: rule.createdBy,
      updatedBy: rule.updatedBy,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }
}
