import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile, ProfileGrafanaDashboard, ProfileBenchmark, GrafanaInstance, GrafanaDashboard, GenericDeepLink } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { OwnedResource } from '@perfana/shared/entities';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';
import { CreateProfileDashboardDto, UpdateProfileDashboardDto } from './dto/profile-dashboard.dto';
import { CreateProfileBenchmarkDto, UpdateProfileBenchmarkDto, ProfileBenchmarkResponse } from './dto/profile-benchmark.dto';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';

export interface ProfileResponse {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  readOnly?: boolean;
  dashboardCount: number;
  sloCount: number;
  deepLinksCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardVariable {
  name: string;
  values: string[];
}

export interface ProfileDashboardResponse {
  id: string;
  profile: string;
  dashboardName: string;
  dashboardUid: string;
  grafanaLabel: string;
  tags?: string[];
  createSeparateDashboardForVariable?: string;
  setHardcodedValueForVariables?: DashboardVariable[];
  matchRegexForVariables?: Record<string, string>;
  readOnly?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Service responsible for managing profiles and their associated dashboards and benchmarks.
 *
 * Authorization:
 * - Methods accept userId and a pre-resolved isAdmin boolean (resolved at the
 *   controller boundary via `withOrgFilter`). The service no longer calls
 *   `authzService.isGlobalAdmin` directly — Phase 3c C33 boundary push.
 * - Currently Profile entity does not have organization_id, so all data is treated as legacy
 * - When organization_id is added to Profile (Phase 4), authorization checks will be enabled
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    @InjectRepository(Profile)
    private profileRepo: Repository<Profile>,
    @InjectRepository(ProfileGrafanaDashboard)
    private profileDashboardRepo: Repository<ProfileGrafanaDashboard>,
    @InjectRepository(ProfileBenchmark)
    private profileBenchmarkRepo: Repository<ProfileBenchmark>,
    @InjectRepository(GrafanaInstance)
    private grafanaInstanceRepo: Repository<GrafanaInstance>,
    @InjectRepository(GrafanaDashboard)
    private grafanaDashboardRepo: Repository<GrafanaDashboard>,
    @InjectRepository(GenericDeepLink)
    private genericDeepLinkRepo: Repository<GenericDeepLink>,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Check if user is org-admin in any of their organizations
   * @throws Error if user is not an org-admin
   */
  private async requireOrgAdmin(userId: string, isAdmin: boolean): Promise<void> {
    // Global admins always have access
    if (isAdmin) {
      return;
    }

    // Check if user is org-admin in any organization
    const isOrgAdmin = await this.authzService.isOrgAdminInAnyOrganization(userId);
    if (!isOrgAdmin) {
      throw new ForbiddenException('Organization admin privileges required to manage profiles');
    }
  }

  /**
   * Find all profiles.
   *
   * @param organizationIds - Pre-resolved by the controller. `null` = global admin
   *   without an explicit org filter (return all). Empty array = non-admin with no
   *   accessible orgs (return nothing). Non-empty array = filter `organization_id IN (...) OR IS NULL`.
   *   The controller collapses the explicit `?organizationId=` query param into a
   *   single-element array so this method does not branch on it.
   */
  async findAll(organizationIds: string[] | null): Promise<ProfileResponse[]> {
    try {
      this.logger.debug(`findAll: organizationIds=${organizationIds === null ? 'null (admin)' : `[${organizationIds.join(',')}]`}`);

      if (organizationIds !== null && organizationIds.length === 0) {
        return [];
      }

      const queryBuilder = withRequestEm(this.profileRepo)
        .createQueryBuilder('profile')
        .orderBy('profile.name', 'ASC');

      if (organizationIds) {
        queryBuilder.where(
          '(profile.organization_id IN (:...orgIds) OR profile.organization_id IS NULL)',
          { orgIds: organizationIds },
        );
      }

      const profiles = await queryBuilder.getMany();

      this.logger.debug(`Found ${profiles.length} profiles`);

      // Get dashboard counts for all profiles
      const dashboardCounts = await withRequestEm(this.profileDashboardRepo)
        .createQueryBuilder('dashboard')
        .select('dashboard.profile', 'profile')
        .addSelect('COUNT(*)', 'count')
        .groupBy('dashboard.profile')
        .getRawMany();

      // Get benchmark (SLO) counts for all profiles
      const benchmarkCounts = await withRequestEm(this.profileBenchmarkRepo)
        .createQueryBuilder('benchmark')
        .select('benchmark.profile_id', 'profile_id')
        .addSelect('COUNT(*)', 'count')
        .groupBy('benchmark.profile_id')
        .getRawMany();

      // Get deep link counts for all profiles
      const deepLinkCounts = await withRequestEm(this.genericDeepLinkRepo)
        .createQueryBuilder('deepLink')
        .select('deepLink.profile', 'profile')
        .addSelect('COUNT(*)', 'count')
        .groupBy('deepLink.profile')
        .getRawMany();

      // Create maps for counts
      const dashboardCountMap = new Map<string, number>();
      dashboardCounts.forEach((item) => {
        dashboardCountMap.set(item.profile, parseInt(item.count, 10));
      });

      const benchmarkCountMap = new Map<string, number>();
      benchmarkCounts.forEach((item) => {
        benchmarkCountMap.set(item.profile_id, parseInt(item.count, 10));
      });

      const deepLinkCountMap = new Map<string, number>();
      deepLinkCounts.forEach((item) => {
        deepLinkCountMap.set(item.profile, parseInt(item.count, 10));
      });

      return profiles.map(profile => ({
        id: profile.id,
        name: profile.name,
        description: profile.description,
        tags: profile.tags,
        readOnly: profile.readOnly,
        dashboardCount: dashboardCountMap.get(profile.name) || 0,
        sloCount: benchmarkCountMap.get(profile.id) || 0,
        deepLinksCount: deepLinkCountMap.get(profile.name) || 0,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      }));
    } catch (error) {
      this.logger.error('Failed to fetch profiles:', error);
      throw error;
    }
  }

  /**
   * Find a single profile by ID
   *
   * @param id - The profile ID
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Note: Profile entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async findOne(id: string, userId: string, isAdmin: boolean): Promise<ProfileResponse | null> {
    try {
      this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      const profile = await withRequestEm(this.profileRepo).findOne({
        where: { id },
      });

      if (!profile) {
        return null;
      }

      // NOTE: Access permission check will be added here when Profile entity has organization_id
      // For now, all profiles are accessible (treated as legacy data)

      // Get dashboard count for this profile
      const dashboardCount = await withRequestEm(this.profileDashboardRepo).count({
        where: { profile: profile.name },
      });

      // Get benchmark (SLO) count for this profile
      const sloCount = await withRequestEm(this.profileBenchmarkRepo).count({
        where: { profile_id: profile.id },
      });

      // Get deep link count for this profile
      const deepLinksCount = await withRequestEm(this.genericDeepLinkRepo).count({
        where: { profile: profile.name },
      });

      return {
        id: profile.id,
        name: profile.name,
        description: profile.description,
        tags: profile.tags,
        readOnly: profile.readOnly,
        dashboardCount,
        sloCount,
        deepLinksCount,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to fetch profile ${id}:`, error);
      return null;
    }
  }

  /**
   * Find all dashboards for a profile
   *
   * @param id - The profile ID
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Note: Profile entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async findDashboardsByProfileId(id: string, userId: string, isAdmin: boolean): Promise<ProfileDashboardResponse[]> {
    try {
      this.logger.debug(`findDashboardsByProfileId: id=${id}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // First, get the profile to get its name
      const profile = await withRequestEm(this.profileRepo).findOne({
        where: { id },
      });

      if (!profile) {
        this.logger.warn(`Profile ${id} not found`);
        return [];
      }

      // NOTE: Access permission check will be added here when Profile entity has organization_id
      // For now, all profiles are accessible (treated as legacy data)

      this.logger.debug(`Fetching dashboards for profile: ${profile.name}`);

      // Get all dashboards for this profile
      const dashboards = await withRequestEm(this.profileDashboardRepo).find({
        where: { profile: profile.name },
        order: {
          dashboardName: 'ASC',
        },
      });

      this.logger.debug(`Found ${dashboards.length} dashboards for profile ${profile.name}`);

      // Get all unique Grafana labels and dashboard UIDs
      const grafanaLabels = [...new Set(dashboards.map(d => d.grafanaLabel))];
      const dashboardUids = [...new Set(dashboards.map(d => d.dashboardUid))];

      // Fetch Grafana instances for these labels
      const grafanaInstances = await withRequestEm(this.grafanaInstanceRepo).find({
        where: grafanaLabels.map(label => ({ label })),
      });

      // Create a map of label to instance ID
      const instanceIdMap = new Map<string, string>();
      grafanaInstances.forEach(instance => {
        instanceIdMap.set(instance.label, instance.id);
      });

      // Fetch actual Grafana dashboards to get tags
      // We need to match by both UID and Grafana instance ID
      // Skip query if there are no dashboard UIDs (empty IN clause causes SQL error)
      let grafanaDashboards: GrafanaDashboard[] = [];
      if (dashboardUids.length > 0) {
        grafanaDashboards = await withRequestEm(this.grafanaDashboardRepo)
          .createQueryBuilder('dashboard')
          .where('dashboard.uid IN (:...uids)', { uids: dashboardUids })
          .getMany();
      }

      // Create a map of (instanceId, uid) -> dashboard for tags lookup
      const dashboardTagsMap = new Map<string, string[]>();
      grafanaDashboards.forEach(gd => {
        const key = `${gd.grafanaInstanceId}:${gd.uid}`;
        dashboardTagsMap.set(key, gd.tags || []);
      });

      // Map dashboards to response format
      return dashboards.map(dashboard => {
        const instanceId = instanceIdMap.get(dashboard.grafanaLabel);
        const tagsKey = instanceId ? `${instanceId}:${dashboard.dashboardUid}` : '';
        const tags = tagsKey ? dashboardTagsMap.get(tagsKey) : undefined;

        return {
          id: dashboard.id,
          profile: dashboard.profile,
          dashboardName: dashboard.dashboardName,
          dashboardUid: dashboard.dashboardUid,
          grafanaLabel: dashboard.grafanaLabel,
          tags: tags || [],
          createSeparateDashboardForVariable: dashboard.createSeparateDashboardForVariable,
          setHardcodedValueForVariables: dashboard.setHardcodedValueForVariables ?? undefined,
          matchRegexForVariables: dashboard.matchRegexForVariables ?? undefined,
          readOnly: dashboard.readOnly,
          createdAt: dashboard.createdAt.toISOString(),
          updatedAt: dashboard.updatedAt.toISOString(),
        };
      });
    } catch (error) {
      this.logger.error(`Failed to fetch dashboards for profile ${id}:`, error);
      throw error;
    }
  }

  /**
   * Create a new dashboard association for a profile
   *
   * @param profileId - The profile ID
   * @param createDto - The dashboard creation DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Note: Profile entity does not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async createDashboard(
    profileId: string,
    createDto: CreateProfileDashboardDto,
    userId: string,
    isAdmin: boolean,
  ): Promise<ProfileDashboardResponse> {
    try {
      this.logger.debug(`createDashboard: profileId=${profileId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, isAdmin);

      // Get the profile to retrieve its name
      const profile = await withRequestEm(this.profileRepo).findOne({
        where: { id: profileId },
      });

      if (!profile) {
        throw new NotFoundException(`Profile ${profileId} not found`);
      }

      // NOTE: Permission check will be added here when Profile entity has organization_id
      // For now, all profiles are modifiable (treated as legacy data)

      // Validate that the Grafana dashboard exists
      const grafanaInstance = await withRequestEm(this.grafanaInstanceRepo).findOne({
        where: { label: createDto.grafanaLabel },
      });

      if (!grafanaInstance) {
        throw new BadRequestException(`Grafana instance with label '${createDto.grafanaLabel}' not found`);
      }

      const grafanaDashboard = await withRequestEm(this.grafanaDashboardRepo).findOne({
        where: {
          uid: createDto.dashboardUid,
          grafanaInstanceId: grafanaInstance.id,
        },
      });

      if (!grafanaDashboard) {
        throw new BadRequestException(
          `Dashboard with UID '${createDto.dashboardUid}' not found in Grafana instance '${createDto.grafanaLabel}'`
        );
      }

      // Create the new dashboard association — inherit org/team from parent profile
      // (ProfileGrafanaDashboard.organization_id is NOT NULL).
      const dashboard = this.profileDashboardRepo.create({
        profile: profile.name,
        dashboardName: grafanaDashboard.name,
        dashboardUid: createDto.dashboardUid,
        grafanaLabel: createDto.grafanaLabel,
        createSeparateDashboardForVariable: createDto.createSeparateDashboardForVariable,
        setHardcodedValueForVariables: createDto.setHardcodedValueForVariables,
        matchRegexForVariables: createDto.matchRegexForVariables,
        readOnly: createDto.readOnly || false,
        organizationId: profile.organizationId,
        teamId: profile.teamId,
      });

      const savedDashboard = await withRequestEm(this.profileDashboardRepo).save(dashboard);

      // Phase 5a — ProfileGrafanaDashboard.organization_id is mapped via
      // camelCase property `organizationId`, so AuditService.dispatch cannot
      // read it off ref directly — pass organizationIdOverride.
      this.auditService.logCreate(savedDashboard as unknown as OwnedResource, {
        organizationIdOverride: savedDashboard.organizationId,
      });

      this.logger.debug(`Created dashboard association ${savedDashboard.id} for profile ${profile.name}`);

      return {
        id: savedDashboard.id,
        profile: savedDashboard.profile,
        dashboardName: savedDashboard.dashboardName,
        dashboardUid: savedDashboard.dashboardUid,
        grafanaLabel: savedDashboard.grafanaLabel,
        tags: grafanaDashboard.tags || [],
        createSeparateDashboardForVariable: savedDashboard.createSeparateDashboardForVariable,
        setHardcodedValueForVariables: savedDashboard.setHardcodedValueForVariables ?? undefined,
        matchRegexForVariables: savedDashboard.matchRegexForVariables ?? undefined,
        readOnly: savedDashboard.readOnly,
        createdAt: savedDashboard.createdAt.toISOString(),
        updatedAt: savedDashboard.updatedAt.toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to create dashboard for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Update a dashboard association for a profile
   *
   * @param profileId - The profile ID
   * @param dashboardId - The dashboard ID
   * @param updateDto - The dashboard update DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Note: Profile entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async updateDashboard(
    profileId: string,
    dashboardId: string,
    updateDto: UpdateProfileDashboardDto,
    userId: string,
    isAdmin: boolean,
  ): Promise<ProfileDashboardResponse> {
    try {
      this.logger.debug(`updateDashboard: profileId=${profileId}, dashboardId=${dashboardId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, isAdmin);

      // Get the profile to retrieve its name
      const profile = await withRequestEm(this.profileRepo).findOne({
        where: { id: profileId },
      });

      if (!profile) {
        throw new NotFoundException(`Profile ${profileId} not found`);
      }

      // NOTE: Permission check will be added here when Profile entity has organization_id
      // For now, all profiles are modifiable (treated as legacy data)

      // Get the existing dashboard association
      const dashboard = await withRequestEm(this.profileDashboardRepo).findOne({
        where: { id: dashboardId, profile: profile.name },
      });

      if (!dashboard) {
        throw new NotFoundException(
          `Dashboard ${dashboardId} not found for profile ${profile.name}`
        );
      }

      // Phase 5a — clone the pre-mutation state for the audit diff. Reuses the
      // entity prototype so AuditService.dispatch resolves auditableFields.
      const dashboardBefore = Object.assign(new ProfileGrafanaDashboard(), dashboard);

      // Validate dashboard UID and Grafana instance if they're being updated
      if (updateDto.dashboardUid || updateDto.grafanaLabel) {
        const grafanaLabel = updateDto.grafanaLabel || dashboard.grafanaLabel;
        const dashboardUid = updateDto.dashboardUid || dashboard.dashboardUid;

        const grafanaInstance = await withRequestEm(this.grafanaInstanceRepo).findOne({
          where: { label: grafanaLabel },
        });

        if (!grafanaInstance) {
          throw new BadRequestException(`Grafana instance with label '${grafanaLabel}' not found`);
        }

        const grafanaDashboard = await withRequestEm(this.grafanaDashboardRepo).findOne({
          where: {
            uid: dashboardUid,
            grafanaInstanceId: grafanaInstance.id,
          },
        });

        if (!grafanaDashboard) {
          throw new BadRequestException(
            `Dashboard with UID '${dashboardUid}' not found in Grafana instance '${grafanaLabel}'`
          );
        }

        // Update dashboard name if dashboard UID changed
        if (updateDto.dashboardUid) {
          dashboard.dashboardName = grafanaDashboard.name;
        }
      }

      // Update the dashboard properties
      if (updateDto.dashboardUid !== undefined) {
        dashboard.dashboardUid = updateDto.dashboardUid;
      }
      if (updateDto.grafanaLabel !== undefined) {
        dashboard.grafanaLabel = updateDto.grafanaLabel;
      }
      if (updateDto.createSeparateDashboardForVariable !== undefined) {
        dashboard.createSeparateDashboardForVariable = updateDto.createSeparateDashboardForVariable;
      }
      if (updateDto.setHardcodedValueForVariables !== undefined) {
        // Convert empty arrays to null for proper deletion
        // TypeORM's update() method ignores undefined values, so we use null to clear the column
        const newValue =
          Array.isArray(updateDto.setHardcodedValueForVariables) && updateDto.setHardcodedValueForVariables.length === 0
            ? null
            : updateDto.setHardcodedValueForVariables;

        this.logger.debug(
          `Updating setHardcodedValueForVariables: ${JSON.stringify(dashboard.setHardcodedValueForVariables)} -> ${JSON.stringify(newValue)}`
        );
        dashboard.setHardcodedValueForVariables = newValue as DashboardVariable[] | null;
      }
      if (updateDto.matchRegexForVariables !== undefined) {
        // Convert empty objects to null for proper deletion
        // TypeORM's update() method ignores undefined values, so we use null to clear the column
        const newValue =
          updateDto.matchRegexForVariables && typeof updateDto.matchRegexForVariables === 'object' && Object.keys(updateDto.matchRegexForVariables).length === 0
            ? null
            : updateDto.matchRegexForVariables;

        this.logger.debug(
          `Updating matchRegexForVariables: ${JSON.stringify(dashboard.matchRegexForVariables)} -> ${JSON.stringify(newValue)}`
        );
        dashboard.matchRegexForVariables = newValue as Record<string, string> | null;
      }
      if (updateDto.readOnly !== undefined) {
        dashboard.readOnly = updateDto.readOnly;
      }

      // Force TypeORM to detect changes by using update() for JSONB fields
      // save() doesn't always detect JSONB column changes properly
      const updateData = {
        dashboardUid: dashboard.dashboardUid,
        dashboardName: dashboard.dashboardName,
        grafanaLabel: dashboard.grafanaLabel,
        createSeparateDashboardForVariable: dashboard.createSeparateDashboardForVariable,
        setHardcodedValueForVariables: dashboard.setHardcodedValueForVariables,
        matchRegexForVariables: dashboard.matchRegexForVariables,
        readOnly: dashboard.readOnly,
      };

      this.logger.debug(`[Service] About to update dashboard ${dashboard.id} with data: ${JSON.stringify(updateData, null, 2)}`);

      await withRequestEm(this.profileDashboardRepo).update(dashboard.id, updateData);

      // Fetch the saved dashboard to return
      const savedDashboard = await withRequestEm(this.profileDashboardRepo).findOne({
        where: { id: dashboard.id },
      });

      if (!savedDashboard) {
        throw new NotFoundException(`Dashboard ${dashboardId} not found after update`);
      }

      this.auditService.logUpdate(
        dashboardBefore as unknown as OwnedResource,
        savedDashboard as unknown as OwnedResource,
        { organizationIdOverride: savedDashboard.organizationId },
      );

      this.logger.debug(`[Service] Updated dashboard association ${savedDashboard.id} for profile ${profile.name}`);
      this.logger.debug(`[Service] Dashboard after update - matchRegexForVariables: ${JSON.stringify(savedDashboard.matchRegexForVariables)}`);
      this.logger.debug(`[Service] Dashboard after update - setHardcodedValueForVariables: ${JSON.stringify(savedDashboard.setHardcodedValueForVariables)}`);

      // Fetch the Grafana dashboard for tags
      const grafanaInstance = await withRequestEm(this.grafanaInstanceRepo).findOne({
        where: { label: savedDashboard.grafanaLabel },
      });

      const grafanaDashboard = grafanaInstance
        ? await withRequestEm(this.grafanaDashboardRepo).findOne({
            where: {
              uid: savedDashboard.dashboardUid,
              grafanaInstanceId: grafanaInstance.id,
            },
          })
        : null;

      return {
        id: savedDashboard.id,
        profile: savedDashboard.profile,
        dashboardName: savedDashboard.dashboardName,
        dashboardUid: savedDashboard.dashboardUid,
        grafanaLabel: savedDashboard.grafanaLabel,
        tags: grafanaDashboard?.tags || [],
        createSeparateDashboardForVariable: savedDashboard.createSeparateDashboardForVariable,
        setHardcodedValueForVariables: savedDashboard.setHardcodedValueForVariables ?? undefined,
        matchRegexForVariables: savedDashboard.matchRegexForVariables ?? undefined,
        readOnly: savedDashboard.readOnly,
        createdAt: savedDashboard.createdAt.toISOString(),
        updatedAt: savedDashboard.updatedAt.toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to update dashboard ${dashboardId} for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a dashboard association from a profile
   *
   * @param profileId - The profile ID
   * @param dashboardId - The dashboard ID
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Note: Profile entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async deleteDashboard(profileId: string, dashboardId: string, userId: string, isAdmin: boolean): Promise<void> {
    try {
      this.logger.debug(`deleteDashboard: profileId=${profileId}, dashboardId=${dashboardId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, isAdmin);

      // Get the profile to retrieve its name
      const profile = await withRequestEm(this.profileRepo).findOne({
        where: { id: profileId },
      });

      if (!profile) {
        throw new NotFoundException(`Profile ${profileId} not found`);
      }

      // NOTE: Delete permission check will be added here when Profile entity has organization_id
      // For now, all profiles are deletable (treated as legacy data)

      // Get the dashboard association
      const dashboard = await withRequestEm(this.profileDashboardRepo).findOne({
        where: { id: dashboardId, profile: profile.name },
      });

      if (!dashboard) {
        throw new NotFoundException(
          `Dashboard ${dashboardId} not found for profile ${profile.name}`
        );
      }

      // Phase 5a — log DELETE before mutation so the audit row captures the
      // pre-delete state. organizationIdOverride bridges the camelCase property
      // / snake_case column gap.
      this.auditService.logDelete(dashboard as unknown as OwnedResource, {
        organizationIdOverride: dashboard.organizationId,
      });

      // Delete the dashboard association
      await withRequestEm(this.profileDashboardRepo).remove(dashboard);

      this.logger.debug(`Deleted dashboard association ${dashboardId} from profile ${profile.name}`);
    } catch (error) {
      this.logger.error(`Failed to delete dashboard ${dashboardId} for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Find all benchmarks for a profile
   *
   * @param profileId - The profile ID
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Note: Profile entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async findBenchmarksByProfileId(profileId: string, userId: string, isAdmin: boolean): Promise<ProfileBenchmarkResponse[]> {
    try {
      this.logger.debug(`findBenchmarksByProfileId: profileId=${profileId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Get the profile to validate it exists
      const profile = await withRequestEm(this.profileRepo).findOne({
        where: { id: profileId },
      });

      if (!profile) {
        this.logger.warn(`Profile ${profileId} not found`);
        return [];
      }

      // NOTE: Access permission check will be added here when Profile entity has organization_id
      // For now, all profiles are accessible (treated as legacy data)

      this.logger.debug(`Fetching benchmarks for profile: ${profile.name}`);

      // Get all benchmarks for this profile
      const benchmarks = await withRequestEm(this.profileBenchmarkRepo).find({
        where: { profile_id: profileId },
        order: {
          createdAt: 'DESC',
        },
      });

      this.logger.debug(`Found ${benchmarks.length} benchmarks for profile ${profile.name}`);

      // Map benchmarks to response format
      return benchmarks.map(benchmark => ({
        id: benchmark.id,
        profileId: benchmark.profile_id,
        profileDashboardId: benchmark.profile_dashboard_id,
        workloadPattern: benchmark.workload_pattern,
        source: benchmark.source,
        grafanaInstance: benchmark.grafana_instance,
        dashboardUid: benchmark.dashboard_uid,
        panelId: benchmark.panel_id,
        panelTitle: benchmark.panel_title,
        panelType: benchmark.panel_type,
        panelDescription: benchmark.panel_description,
        evaluateType: benchmark.evaluate_type,
        metricUnit: benchmark.metric_unit,
        requirementOperator: benchmark.requirement_operator,
        requirementValue: benchmark.requirement_value !== null && benchmark.requirement_value !== undefined ? Number(benchmark.requirement_value) : undefined,
        excludeRampUpTime: benchmark.exclude_ramp_up_time,
        averageAll: benchmark.average_all,
        matchPattern: benchmark.match_pattern,
        validateWithDefaultIfNoData: benchmark.validate_with_default_if_no_data,
        validateWithDefaultIfNoDataValue: benchmark.validate_with_default_if_no_data_value !== null && benchmark.validate_with_default_if_no_data_value !== undefined ? Number(benchmark.validate_with_default_if_no_data_value) : undefined,
        tags: benchmark.tags,
        metadata: benchmark.metadata,
        readOnly: benchmark.read_only,
        createdAt: benchmark.createdAt.toISOString(),
        updatedAt: benchmark.updatedAt.toISOString(),
      }));
    } catch (error) {
      this.logger.error(`Failed to fetch benchmarks for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new benchmark for a profile
   *
   * @param profileId - The profile ID
   * @param createDto - The benchmark creation DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Note: Profile entity does not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async createBenchmark(
    profileId: string,
    createDto: CreateProfileBenchmarkDto,
    userId: string,
    isAdmin: boolean,
  ): Promise<ProfileBenchmarkResponse> {
    try {
      this.logger.debug(`createBenchmark: profileId=${profileId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, isAdmin);

      // Get the profile to validate it exists
      const profile = await withRequestEm(this.profileRepo).findOne({
        where: { id: profileId },
      });

      if (!profile) {
        throw new NotFoundException(`Profile ${profileId} not found`);
      }

      // NOTE: Permission check will be added here when Profile entity has organization_id
      // For now, all profiles are modifiable (treated as legacy data)

      // Validate that the profile dashboard exists
      const profileDashboard = await withRequestEm(this.profileDashboardRepo).findOne({
        where: { id: createDto.profileDashboardId },
      });

      if (!profileDashboard) {
        throw new BadRequestException(
          `Profile dashboard with ID '${createDto.profileDashboardId}' not found`
        );
      }

      // Verify that the profile dashboard belongs to this profile
      if (profileDashboard.profile !== profile.name) {
        throw new BadRequestException(
          `Profile dashboard '${createDto.profileDashboardId}' does not belong to profile '${profile.name}'`
        );
      }

      // Create the new benchmark — inherit org/team from parent profile
      // (ProfileBenchmark.organization_id is NOT NULL).
      const benchmark = this.profileBenchmarkRepo.create({
        profile_id: profileId,
        profile_dashboard_id: createDto.profileDashboardId,
        workload_pattern: createDto.workloadPattern || '.*',
        source: createDto.source || 'grafana',
        grafana_instance: createDto.grafanaInstance,
        dashboard_uid: createDto.dashboardUid,
        panel_id: createDto.panelId,
        panel_title: createDto.panelTitle,
        panel_type: createDto.panelType,
        panel_description: createDto.panelDescription,
        evaluate_type: createDto.evaluateType,
        metric_unit: createDto.metricUnit,
        requirement_operator: createDto.requirementOperator,
        requirement_value: createDto.requirementValue,
        exclude_ramp_up_time: createDto.excludeRampUpTime ?? true,
        average_all: createDto.averageAll ?? false,
        match_pattern: createDto.matchPattern,
        validate_with_default_if_no_data: createDto.validateWithDefaultIfNoData ?? false,
        validate_with_default_if_no_data_value: createDto.validateWithDefaultIfNoDataValue,
        tags: createDto.tags || [],
        metadata: createDto.metadata || {},
        read_only: createDto.readOnly || false,
        organizationId: profile.organizationId,
        teamId: profile.teamId,
      });

      const savedBenchmark = await withRequestEm(this.profileBenchmarkRepo).save(benchmark);

      // Phase 5a — ProfileBenchmark.organization_id is mapped via camelCase
      // property `organizationId` (the snake_case columns above are the entity's
      // own property naming, not TypeORM's `name:` mapping), so dispatch
      // cannot read it off ref directly — pass organizationIdOverride.
      this.auditService.logCreate(savedBenchmark as unknown as OwnedResource, {
        organizationIdOverride: savedBenchmark.organizationId,
      });

      this.logger.debug(`Created benchmark ${savedBenchmark.id} for profile ${profile.name}`);

      return {
        id: savedBenchmark.id,
        profileId: savedBenchmark.profile_id,
        profileDashboardId: savedBenchmark.profile_dashboard_id,
        workloadPattern: savedBenchmark.workload_pattern,
        source: savedBenchmark.source,
        grafanaInstance: savedBenchmark.grafana_instance,
        dashboardUid: savedBenchmark.dashboard_uid,
        panelId: savedBenchmark.panel_id,
        panelTitle: savedBenchmark.panel_title,
        panelType: savedBenchmark.panel_type,
        panelDescription: savedBenchmark.panel_description,
        evaluateType: savedBenchmark.evaluate_type,
        metricUnit: savedBenchmark.metric_unit,
        requirementOperator: savedBenchmark.requirement_operator,
        requirementValue: savedBenchmark.requirement_value !== null && savedBenchmark.requirement_value !== undefined ? Number(savedBenchmark.requirement_value) : undefined,
        excludeRampUpTime: savedBenchmark.exclude_ramp_up_time,
        averageAll: savedBenchmark.average_all,
        matchPattern: savedBenchmark.match_pattern,
        validateWithDefaultIfNoData: savedBenchmark.validate_with_default_if_no_data,
        validateWithDefaultIfNoDataValue: savedBenchmark.validate_with_default_if_no_data_value !== null && savedBenchmark.validate_with_default_if_no_data_value !== undefined ? Number(savedBenchmark.validate_with_default_if_no_data_value) : undefined,
        tags: savedBenchmark.tags,
        metadata: savedBenchmark.metadata,
        readOnly: savedBenchmark.read_only,
        createdAt: savedBenchmark.createdAt.toISOString(),
        updatedAt: savedBenchmark.updatedAt.toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to create benchmark for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Update a benchmark for a profile
   *
   * @param profileId - The profile ID
   * @param benchmarkId - The benchmark ID
   * @param updateDto - The benchmark update DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Note: Profile entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async updateBenchmark(
    profileId: string,
    benchmarkId: string,
    updateDto: UpdateProfileBenchmarkDto,
    userId: string,
    isAdmin: boolean,
  ): Promise<ProfileBenchmarkResponse> {
    try {
      this.logger.debug(`updateBenchmark: profileId=${profileId}, benchmarkId=${benchmarkId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, isAdmin);

      // Get the profile to validate it exists
      const profile = await withRequestEm(this.profileRepo).findOne({
        where: { id: profileId },
      });

      if (!profile) {
        throw new NotFoundException(`Profile ${profileId} not found`);
      }

      // NOTE: Permission check will be added here when Profile entity has organization_id
      // For now, all profiles are modifiable (treated as legacy data)

      // Get the existing benchmark
      const benchmark = await withRequestEm(this.profileBenchmarkRepo).findOne({
        where: { id: benchmarkId, profile_id: profileId },
      });

      if (!benchmark) {
        throw new NotFoundException(
          `Benchmark ${benchmarkId} not found for profile ${profile.name}`
        );
      }

      // Phase 5a — clone the pre-mutation state for the audit diff.
      const benchmarkBefore = Object.assign(new ProfileBenchmark(), benchmark);

      // Validate profile dashboard if it's being updated
      if (updateDto.profileDashboardId) {
        const profileDashboard = await withRequestEm(this.profileDashboardRepo).findOne({
          where: { id: updateDto.profileDashboardId },
        });

        if (!profileDashboard) {
          throw new BadRequestException(
            `Profile dashboard with ID '${updateDto.profileDashboardId}' not found`
          );
        }

        // Verify that the profile dashboard belongs to this profile
        if (profileDashboard.profile !== profile.name) {
          throw new BadRequestException(
            `Profile dashboard '${updateDto.profileDashboardId}' does not belong to profile '${profile.name}'`
          );
        }
      }

      // Update the benchmark properties
      if (updateDto.profileDashboardId !== undefined) {
        benchmark.profile_dashboard_id = updateDto.profileDashboardId;
      }
      if (updateDto.workloadPattern !== undefined) {
        benchmark.workload_pattern = updateDto.workloadPattern;
      }
      if (updateDto.source !== undefined) {
        benchmark.source = updateDto.source;
      }
      if (updateDto.grafanaInstance !== undefined) {
        benchmark.grafana_instance = updateDto.grafanaInstance;
      }
      if (updateDto.dashboardUid !== undefined) {
        benchmark.dashboard_uid = updateDto.dashboardUid;
      }
      if (updateDto.panelId !== undefined) {
        benchmark.panel_id = updateDto.panelId;
      }
      if (updateDto.panelTitle !== undefined) {
        benchmark.panel_title = updateDto.panelTitle;
      }
      if (updateDto.panelType !== undefined) {
        benchmark.panel_type = updateDto.panelType;
      }
      if (updateDto.panelDescription !== undefined) {
        benchmark.panel_description = updateDto.panelDescription;
      }
      if (updateDto.evaluateType !== undefined) {
        benchmark.evaluate_type = updateDto.evaluateType;
      }
      if (updateDto.metricUnit !== undefined) {
        benchmark.metric_unit = updateDto.metricUnit;
      }
      if (updateDto.requirementOperator !== undefined) {
        benchmark.requirement_operator = updateDto.requirementOperator;
      }
      if (updateDto.requirementValue !== undefined) {
        benchmark.requirement_value = updateDto.requirementValue;
      }
      if (updateDto.excludeRampUpTime !== undefined) {
        benchmark.exclude_ramp_up_time = updateDto.excludeRampUpTime;
      }
      if (updateDto.averageAll !== undefined) {
        benchmark.average_all = updateDto.averageAll;
      }
      if (updateDto.matchPattern !== undefined) {
        benchmark.match_pattern = updateDto.matchPattern;
      }
      if (updateDto.validateWithDefaultIfNoData !== undefined) {
        benchmark.validate_with_default_if_no_data = updateDto.validateWithDefaultIfNoData;
      }
      if (updateDto.validateWithDefaultIfNoDataValue !== undefined) {
        benchmark.validate_with_default_if_no_data_value = updateDto.validateWithDefaultIfNoDataValue;
      }
      if (updateDto.tags !== undefined) {
        benchmark.tags = updateDto.tags;
      }
      if (updateDto.metadata !== undefined) {
        benchmark.metadata = updateDto.metadata;
      }
      if (updateDto.readOnly !== undefined) {
        benchmark.read_only = updateDto.readOnly;
      }

      this.logger.debug(`Updating benchmark ${benchmark.id} for profile ${profile.name}`);

      const savedBenchmark = await withRequestEm(this.profileBenchmarkRepo).save(benchmark);

      this.auditService.logUpdate(
        benchmarkBefore as unknown as OwnedResource,
        savedBenchmark as unknown as OwnedResource,
        { organizationIdOverride: savedBenchmark.organizationId },
      );

      this.logger.debug(`Updated benchmark ${savedBenchmark.id} for profile ${profile.name}`);

      return {
        id: savedBenchmark.id,
        profileId: savedBenchmark.profile_id,
        profileDashboardId: savedBenchmark.profile_dashboard_id,
        workloadPattern: savedBenchmark.workload_pattern,
        source: savedBenchmark.source,
        grafanaInstance: savedBenchmark.grafana_instance,
        dashboardUid: savedBenchmark.dashboard_uid,
        panelId: savedBenchmark.panel_id,
        panelTitle: savedBenchmark.panel_title,
        panelType: savedBenchmark.panel_type,
        panelDescription: savedBenchmark.panel_description,
        evaluateType: savedBenchmark.evaluate_type,
        metricUnit: savedBenchmark.metric_unit,
        requirementOperator: savedBenchmark.requirement_operator,
        requirementValue: savedBenchmark.requirement_value !== null && savedBenchmark.requirement_value !== undefined ? Number(savedBenchmark.requirement_value) : undefined,
        excludeRampUpTime: savedBenchmark.exclude_ramp_up_time,
        averageAll: savedBenchmark.average_all,
        matchPattern: savedBenchmark.match_pattern,
        validateWithDefaultIfNoData: savedBenchmark.validate_with_default_if_no_data,
        validateWithDefaultIfNoDataValue: savedBenchmark.validate_with_default_if_no_data_value !== null && savedBenchmark.validate_with_default_if_no_data_value !== undefined ? Number(savedBenchmark.validate_with_default_if_no_data_value) : undefined,
        tags: savedBenchmark.tags,
        metadata: savedBenchmark.metadata,
        readOnly: savedBenchmark.read_only,
        createdAt: savedBenchmark.createdAt.toISOString(),
        updatedAt: savedBenchmark.updatedAt.toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to update benchmark ${benchmarkId} for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a benchmark from a profile
   *
   * @param profileId - The profile ID
   * @param benchmarkId - The benchmark ID
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved at controller boundary)
   *
   * Note: Profile entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async deleteBenchmark(profileId: string, benchmarkId: string, userId: string, isAdmin: boolean): Promise<void> {
    try {
      this.logger.debug(`deleteBenchmark: profileId=${profileId}, benchmarkId=${benchmarkId}, userId=${userId}, isGlobalAdmin=${isAdmin}`);

      // Check if user is org-admin in any organization
      await this.requireOrgAdmin(userId, isAdmin);

      // Get the profile to validate it exists
      const profile = await withRequestEm(this.profileRepo).findOne({
        where: { id: profileId },
      });

      if (!profile) {
        throw new NotFoundException(`Profile ${profileId} not found`);
      }

      // NOTE: Delete permission check will be added here when Profile entity has organization_id
      // For now, all profiles are deletable (treated as legacy data)

      // Get the benchmark
      const benchmark = await withRequestEm(this.profileBenchmarkRepo).findOne({
        where: { id: benchmarkId, profile_id: profileId },
      });

      if (!benchmark) {
        throw new NotFoundException(
          `Benchmark ${benchmarkId} not found for profile ${profile.name}`
        );
      }

      // Phase 5a — log DELETE before mutation so the audit row captures the
      // pre-delete state.
      this.auditService.logDelete(benchmark as unknown as OwnedResource, {
        organizationIdOverride: benchmark.organizationId,
      });

      // Delete the benchmark
      await withRequestEm(this.profileBenchmarkRepo).remove(benchmark);

      this.logger.debug(`Deleted benchmark ${benchmarkId} from profile ${profile.name}`);
    } catch (error) {
      this.logger.error(`Failed to delete benchmark ${benchmarkId} for profile ${profileId}:`, error);
      throw error;
    }
  }

  // ─── Profile CRUD ───────────────────────────────────────────────────

  async createProfile(dto: CreateProfileDto, userId: string, isAdmin: boolean): Promise<ProfileResponse> {
    await this.requireOrgAdmin(userId, isAdmin);

    // Check uniqueness
    const existing = await withRequestEm(this.profileRepo).findOne({ where: { name: dto.name } });
    if (existing) {
      throw new BadRequestException(`Profile with name '${dto.name}' already exists`);
    }

    // Profile.organization_id is NOT NULL — default to the caller's first
    // accessible org (UI does not currently expose org selection).
    const orgs = await this.authzService.getAccessibleOrganizations(userId);
    const organizationId = orgs?.[0];
    if (!organizationId) {
      throw new ForbiddenException('No accessible organization found for user');
    }

    const profile = this.profileRepo.create({
      name: dto.name,
      description: dto.description,
      tags: dto.tags,
      readOnly: dto.readOnly ?? false,
      createdBy: userId,
      updatedBy: userId,
      organizationId,
    });

    const saved = await withRequestEm(this.profileRepo).save(profile);

    // Phase 5a — Profile.organization_id is mapped via camelCase property
    // `organizationId`, so dispatch needs the override to org-scope the row.
    this.auditService.logCreate(saved as unknown as OwnedResource, {
      organizationIdOverride: saved.organizationId,
    });

    this.logger.log(`Profile '${saved.name}' created by ${userId}`);

    return {
      id: saved.id,
      name: saved.name,
      description: saved.description,
      tags: saved.tags,
      readOnly: saved.readOnly,
      dashboardCount: 0,
      sloCount: 0,
      deepLinksCount: 0,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async updateProfile(id: string, dto: UpdateProfileDto, userId: string, isAdmin: boolean): Promise<ProfileResponse> {
    await this.requireOrgAdmin(userId, isAdmin);

    const profile = await withRequestEm(this.profileRepo).findOne({ where: { id } });
    if (!profile) {
      throw new NotFoundException(`Profile not found: ${id}`);
    }

    if (profile.readOnly) {
      throw new BadRequestException('Cannot update a read-only profile');
    }

    // If renaming, check uniqueness
    if (dto.name && dto.name !== profile.name) {
      const existing = await withRequestEm(this.profileRepo).findOne({ where: { name: dto.name } });
      if (existing) {
        throw new BadRequestException(`Profile with name '${dto.name}' already exists`);
      }
    }

    // Phase 5a — clone the pre-mutation state for the audit diff.
    const profileBefore = Object.assign(new Profile(), profile);

    if (dto.name !== undefined) profile.name = dto.name;
    if (dto.description !== undefined) profile.description = dto.description;
    if (dto.tags !== undefined) profile.tags = dto.tags;
    if (dto.readOnly !== undefined) profile.readOnly = dto.readOnly;
    profile.updatedBy = userId;

    const saved = await withRequestEm(this.profileRepo).save(profile);

    this.auditService.logUpdate(
      profileBefore as unknown as OwnedResource,
      saved as unknown as OwnedResource,
      { organizationIdOverride: saved.organizationId },
    );

    this.logger.log(`Profile '${saved.name}' updated by ${userId}`);

    // Re-fetch counts
    const full = await this.findOne(id, userId, isAdmin);
    return full!;
  }

  async deleteProfile(id: string, userId: string, isAdmin: boolean): Promise<void> {
    await this.requireOrgAdmin(userId, isAdmin);

    const profile = await withRequestEm(this.profileRepo).findOne({ where: { id } });
    if (!profile) {
      throw new NotFoundException(`Profile not found: ${id}`);
    }

    if (profile.readOnly) {
      throw new BadRequestException('Cannot delete a read-only profile');
    }

    // Phase 5a — log DELETE before mutation so the audit row captures the
    // pre-delete state. Cascaded child rows (ProfileGrafanaDashboard,
    // ProfileBenchmark) are intentionally not individually audited — they
    // are implied by the Profile-DELETE row.
    this.auditService.logDelete(profile as unknown as OwnedResource, {
      organizationIdOverride: profile.organizationId,
    });

    await withRequestEm(this.profileRepo).remove(profile);
    this.logger.log(`Profile '${profile.name}' deleted by ${userId}`);
  }
}
