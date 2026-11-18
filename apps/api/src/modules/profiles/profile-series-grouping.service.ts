import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OwnedResource, ProfileSeriesGroupingRule } from '@perfana/shared/entities';
import { withRequestEm, withRequestQuery } from '../../common/db/request-em';
import { AuditService } from '../audit/audit.service';
import { normalizeRuleFields } from '../series-grouping/rule-fields';
import type {
  CreateProfileSeriesGroupingRuleDto,
  ProfileSeriesGroupingRuleResponseDto,
  UpdateProfileSeriesGroupingRuleDto,
} from './dto/profile-series-grouping-rule.dto';
import { ProfilesService, forLog } from './profiles.service';
import { deleteOwnedProvisionedRules, propagateToProvisionedRules } from './provisioned-grouping-rules';

export const PROFILE_SERIES_GROUPING_SLOT_INDEX = 'uq_profile_series_grouping_rules_slot';

function isDuplicateProfileSlot(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  return (e.code ?? e.driverError?.code) === '23505'
    && (e.constraint ?? e.driverError?.constraint) === PROFILE_SERIES_GROUPING_SLOT_INDEX;
}

/**
 * Series grouping rules on a profile dashboard (migration 1826).
 *
 * grafana-sync's auto-config provisions each rule into `series_grouping_rules` for every
 * application dashboard built from the profile dashboard, in the workload of each run the profile
 * matches. An edit here is carried to every provisioned row nobody has edited since
 * (`updated_by IS NULL`), a delete removes those rows, and an edited row is left alone in both
 * cases — the profile-SLO rule. Changing a rule changes nothing already analysed: a run reads as
 * stale in its anomaly card and is regrouped on its next recalculation, exactly as for a hand edit.
 *
 * Authorization is the profiles module's: read needs the profile in scope (404 otherwise), write
 * needs org-admin in the profile's organization. A profile rule inherits the profile dashboard's
 * organization and team.
 */
@Injectable()
export class ProfileSeriesGroupingService {
  private readonly logger = new Logger(ProfileSeriesGroupingService.name);

  constructor(
    @InjectRepository(ProfileSeriesGroupingRule)
    private readonly ruleRepo: Repository<ProfileSeriesGroupingRule>,
    private readonly profilesService: ProfilesService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    profileId: string,
    dashboardId: string,
    userId: string,
    accessibleOrgIds: string[] | null,
  ): Promise<ProfileSeriesGroupingRuleResponseDto[]> {
    const { dashboard } = await this.profilesService.requireProfileDashboard(profileId, dashboardId, userId, accessibleOrgIds, false);
    const rules = await withRequestEm(this.ruleRepo).find({
      where: { profileDashboardId: dashboard.id },
      order: { panelId: { direction: 'ASC', nulls: 'FIRST' } },
    });
    return rules.map(toDto);
  }

  async create(
    profileId: string,
    dashboardId: string,
    dto: CreateProfileSeriesGroupingRuleDto,
    userId: string,
    accessibleOrgIds: string[] | null,
  ): Promise<ProfileSeriesGroupingRuleResponseDto> {
    const fields = normalizeRuleFields(dto.preset, dto.pattern ?? null, dto.replacement ?? null, dto.aggregations);
    const { profile, dashboard } = await this.profilesService.requireProfileDashboard(profileId, dashboardId, userId, accessibleOrgIds, true);
    const rule = this.ruleRepo.create({
      profileDashboardId: dashboard.id,
      panelId: dto.panelId ?? null,
      ...fields,
      enabled: dto.enabled ?? true,
      // The organization the org-admin check was made in, not the dashboard row's copy of it.
      organizationId: profile.organizationId,
      teamId: dashboard.teamId,
      createdBy: userId,
      updatedBy: userId,
    });
    let saved: ProfileSeriesGroupingRule;
    try {
      saved = await withRequestEm(this.ruleRepo).save(rule);
    } catch (error) {
      if (isDuplicateProfileSlot(error)) {
        throw new ConflictException('This profile dashboard already has a series grouping rule for that panel. Edit or delete it instead.');
      }
      throw error;
    }
    this.auditService.logCreate(saved as unknown as OwnedResource, { organizationIdOverride: saved.organizationId });
    return toDto(saved);
  }

  async update(
    profileId: string,
    dashboardId: string,
    ruleId: string,
    dto: UpdateProfileSeriesGroupingRuleDto,
    userId: string,
    accessibleOrgIds: string[] | null,
  ): Promise<ProfileSeriesGroupingRuleResponseDto> {
    const { profile, dashboard } = await this.profilesService.requireProfileDashboard(profileId, dashboardId, userId, accessibleOrgIds, true);
    const rule = await this.loadRule(ruleId, dashboard.id);
    const before = Object.assign(new ProfileSeriesGroupingRule(), rule);

    // `null` and an absent key both mean "leave it", as in SeriesGroupingService.update.
    const preset = dto.preset ?? rule.preset;
    const custom = preset === 'custom';
    const fields = normalizeRuleFields(
      preset,
      custom ? (dto.pattern ?? rule.pattern) : null,
      custom ? (dto.replacement ?? rule.replacement) : null,
      dto.aggregations ?? rule.aggregations,
    );
    Object.assign(rule, fields, { enabled: dto.enabled ?? rule.enabled, updatedBy: userId });
    const saved = await withRequestEm(this.ruleRepo).save(rule);
    this.auditService.logUpdate(before as unknown as OwnedResource, saved as unknown as OwnedResource, {
      organizationIdOverride: saved.organizationId,
    });

    const followed = await propagateToProvisionedRules(withRequestQuery(this.dataSource), saved.id, profile.organizationId, {
      ...fields,
      enabled: saved.enabled,
    });
    if (followed > 0) this.logger.log(`Profile series grouping rule ${saved.id}: updated ${followed} provisioned rule(s)`);
    return toDto(saved);
  }

  async remove(
    profileId: string,
    dashboardId: string,
    ruleId: string,
    userId: string,
    accessibleOrgIds: string[] | null,
  ): Promise<void> {
    const { profile, dashboard } = await this.profilesService.requireProfileDashboard(profileId, dashboardId, userId, accessibleOrgIds, true);
    const rule = await this.loadRule(ruleId, dashboard.id);
    this.auditService.logDelete(rule as unknown as OwnedResource, { organizationIdOverride: rule.organizationId });
    const removedId = rule.id; // TypeORM's remove() clears the entity's id
    // The rule first, then its copies by id: see deleteOwnedProvisionedRules for the race this orders.
    await withRequestEm(this.ruleRepo).remove(rule);
    const removed = await deleteOwnedProvisionedRules(withRequestQuery(this.dataSource), profile.organizationId, [removedId]);
    if (removed > 0) this.logger.log(`Profile series grouping rule ${removedId}: deleted ${removed} provisioned rule(s)`);
  }

  /** A rule of THIS profile dashboard only, so another dashboard's rule id is a 404. */
  private async loadRule(ruleId: string, profileDashboardId: string): Promise<ProfileSeriesGroupingRule> {
    const rule = await withRequestEm(this.ruleRepo).findOne({ where: { id: ruleId, profileDashboardId } });
    if (!rule) throw new NotFoundException(`Series grouping rule ${forLog(ruleId)} not found on this profile dashboard`);
    return rule;
  }
}

function toDto(rule: ProfileSeriesGroupingRule): ProfileSeriesGroupingRuleResponseDto {
  return {
    id: rule.id,
    profileDashboardId: rule.profileDashboardId,
    panelId: rule.panelId ?? null,
    preset: rule.preset,
    pattern: rule.pattern ?? null,
    replacement: rule.replacement ?? '',
    aggregations: rule.aggregations,
    enabled: rule.enabled,
    createdBy: rule.createdBy,
    updatedBy: rule.updatedBy,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}
