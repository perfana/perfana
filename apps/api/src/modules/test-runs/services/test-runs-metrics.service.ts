import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import {
  TestRun as TestRunEntity,
  SystemUnderTest as SystemEntity,
  DsCompareConfig,
  ProvisionedTemplateDsCompareConfig,
  ApplicationDashboard,
  DsPanels,
} from '../../../entities';
import { OwnedResource } from '@perfana/shared';
import { CreateMetricClassificationDto, MetricClassificationDto } from '../dto/metric-classification.dto';
import { CreateDsCompareConfigDto, UpdateDsCompareConfigDto, DsCompareConfigDto } from '../dto/ds-compare-config.dto';
import { ResourceNotFoundException, DatabaseException } from '../../../common/exceptions/business.exception';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';
// The marker the Dynatrace host-mapping path stamps on the panel-level config it seeds. That row
// names no author, so the marker plus a null author is the one shape nobody has touched; a UI save
// rewrites it to 'metric'/'panel'. Shared so the writer and this reader cannot drift apart.
import { DYNATRACE_HOST_COMPARE_SOURCE } from '../../../constants/ds-compare-config.constants';
import { validateRegexPattern } from '@perfana/shared/utils';
import { profileMatchesRun } from '@perfana/shared/utils/profile-match';
import { isDeepStrictEqual } from 'util';
import { cloneJson, GoldenPathTemplate, INSERT_BASE, rebuildConfig, selectWinner } from './golden-path-resolver';

const GOLDEN_PATH_ACTOR = 'system:golden-path';
/** What PerformanceTestMetricsPipeline stamps on the default compare configs it seeds. */
const WORKER_ACTOR = 'worker-pipeline';
/** The applier runs inside the completion request, before ADAPT is queued; past this it says so. */
const GOLDEN_PATH_SLOW_MS = 5000;

@Injectable()
export class TestRunsMetricsService {
  private readonly logger = new Logger(TestRunsMetricsService.name);

  /**
   * Resolve organization IDs for a non-admin user via AuthorizationService.
   * Returns the accessible org list, or an empty array if resolution fails.
   * Callers must guard with `isAdmin` before calling — admins skip org filtering entirely.
   */
  private async resolveOrganizationIds(userId: string): Promise<string[]> {
    try {
      return await this.authorizationService.getAccessibleOrganizations(userId);
    } catch (error) {
      this.logger.warn(`Failed to resolve organizations for user ${userId}: ${(error as Error).message}`);
      return [];
    }
  }

  constructor(
    @InjectRepository(TestRunEntity)
    private testRunRepo: Repository<TestRunEntity>,
    @InjectRepository(SystemEntity)
    private systemRepo: Repository<SystemEntity>,
    @InjectRepository(DsCompareConfig)
    private dsCompareConfigRepo: Repository<DsCompareConfig>,
    @InjectRepository(ProvisionedTemplateDsCompareConfig)
    private templateRepo: Repository<ProvisionedTemplateDsCompareConfig>,
    @InjectRepository(ApplicationDashboard)
    private applicationDashboardRepo: Repository<ApplicationDashboard>,
    @InjectRepository(DsPanels)
    private dsPanelsRepo: Repository<DsPanels>,
    private authorizationService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}

  async classifyMetric(
    testRunId: string,
    createDto: CreateMetricClassificationDto,
    system?: string,
    environment?: string,
    workload?: string,
    userId: string = '',
    isAdmin: boolean = false,
  ): Promise<MetricClassificationDto> {
    try {
      this.logger.log(`Classifying metric for test run: ${testRunId}`);

      const organizationIds = isAdmin ? [] : await this.resolveOrganizationIds(userId);

      // Non-admin users with no organization memberships cannot classify metrics
      if (!isAdmin && organizationIds.length === 0) {
        throw new ResourceNotFoundException('TestRun', testRunId);
      }

      let systemUnderTestId: string;
      let testEnvironment: string;
      let testWorkload: string;

      if (system && environment && workload) {
        // Use provided query parameters with organization filtering
        const systemQuery = withRequestEm(this.systemRepo).createQueryBuilder('sut')
          .leftJoin('sut.team', 'team')
          .where('sut.name = :name', { name: system })
          .select(['sut.id']);

        // Apply organization filter for non-admin users
        if (!isAdmin) {
          systemQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
        }

        const systemUnderTest = await systemQuery.getOne();

        if (!systemUnderTest) {
          throw new ResourceNotFoundException('System under test', system);
        }

        systemUnderTestId = systemUnderTest.id;
        testEnvironment = environment;
        testWorkload = workload;
      } else {
        // Get from test run with organization filtering
        const testRunQuery = withRequestEm(this.testRunRepo).createQueryBuilder('tr')
          .leftJoin('tr.systemUnderTest', 'sut')
          .leftJoin('sut.team', 'team')
          .where('tr.testRunId = :testRunId', { testRunId })
          .select(['tr.systemUnderTestId', 'tr.testEnvironment', 'tr.workload']);

        // Apply organization filter for non-admin users
        if (!isAdmin) {
          testRunQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
        }

        const testRun = await testRunQuery.getOne();

        if (!testRun) {
          throw new ResourceNotFoundException('TestRun', testRunId);
        }

        systemUnderTestId = testRun.systemUnderTestId;
        testEnvironment = testRun.testEnvironment;
        testWorkload = testRun.workload;
      }

      // Helper functions to sanitize values
      const sanitizeUuid = (value: string | undefined | null): string | undefined => {
        if (!value || value === '' || value === 'null' || value === 'undefined') {
          return undefined;
        }
        return value;
      };

      const sanitizeString = (value: string | undefined | null): string | undefined => {
        if (!value || value === '' || value === 'null' || value === 'undefined') {
          return undefined;
        }
        return value;
      };

      // Check if classification already exists
      const existingClassification = await this.templateRepo.findOne({
        where: {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload: testWorkload,
          application_dashboard_id: sanitizeUuid(createDto.applicationDashboardId),
          panel_id: createDto.panelId ? parseInt(createDto.panelId, 10) : undefined,
          metric_name: sanitizeString(createDto.metricName)
        }
      });

      const classificationData = {
        system_under_test_id: systemUnderTestId,
        test_environment: testEnvironment,
        workload: testWorkload,
        application_dashboard_id: sanitizeUuid(createDto.applicationDashboardId),
        dashboard_label: sanitizeString(createDto.dashboardLabel),
        panel_id: createDto.panelId ? parseInt(createDto.panelId, 10) : undefined,
        panel_title: sanitizeString(createDto.panelTitle),
        metric_name: sanitizeString(createDto.metricName),
        metric_classification: createDto.classification,
        higher_is_better: createDto.higherIsBetter,
      };

      let result: ProvisionedTemplateDsCompareConfig;
      if (existingClassification) {
        // Phase 5a: clone the pre-update entity for the audit before-snapshot.
        const before = Object.assign(new ProvisionedTemplateDsCompareConfig(), existingClassification);

        // Update existing classification
        await this.templateRepo.update(
          { id: existingClassification.id },
          classificationData
        );

        const updated = await this.templateRepo.findOne({
          where: { id: existingClassification.id }
        });

        if (!updated) {
          throw new DatabaseException('Failed to retrieve updated metric classification');
        }

        result = updated;

        this.auditService.logUpdate(
          before as unknown as OwnedResource,
          updated as unknown as OwnedResource,
        );

        this.logger.log(`Updated existing metric classification for: ${sanitizeString(createDto.dashboardLabel) || 'no-dashboard'}/${sanitizeString(createDto.panelTitle) || 'no-panel'}/${sanitizeString(createDto.metricName) || 'panel-wide'}`);
      } else {
        // Create new classification
        const newClassification = this.templateRepo.create(classificationData);
        result = await this.templateRepo.save(newClassification);

        this.auditService.logCreate(result as unknown as OwnedResource);

        this.logger.log(`Created new metric classification for: ${sanitizeString(createDto.dashboardLabel) || 'no-dashboard'}/${sanitizeString(createDto.panelTitle) || 'no-panel'}/${sanitizeString(createDto.metricName) || 'panel-wide'}`);
      }

      return result as unknown as MetricClassificationDto;
    } catch (error) {
      this.logger.error(`Failed to classify metric for ${testRunId}:`, error);
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      throw new DatabaseException(`Failed to classify metric: ${(error as Error).message}`);
    }
  }

  async createOrUpdateDsCompareConfig(
    createDto: CreateDsCompareConfigDto,
    userId: string = '',
    isAdmin: boolean = false,
  ): Promise<DsCompareConfigDto> {
    try {
      const organizationIds = isAdmin ? [] : await this.resolveOrganizationIds(userId);

      // Non-admin users with no organization memberships cannot create/update configs
      if (!isAdmin && organizationIds.length === 0) {
        throw new ResourceNotFoundException('System under test', createDto.systemUnderTestId);
      }

      // Validate that the system under test exists and user has access
      const systemQuery = withRequestEm(this.systemRepo).createQueryBuilder('sut')
        .leftJoin('sut.team', 'team')
        .where('sut.id = :id', { id: createDto.systemUnderTestId })
        .select(['sut.id', 'sut.organization_id', 'sut.team_id']);

      // Apply organization filter for non-admin users
      if (!isAdmin) {
        systemQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
      }

      const systemUnderTest = await systemQuery.getOne();

      if (!systemUnderTest) {
        throw new ResourceNotFoundException('System under test', createDto.systemUnderTestId);
      }

      // Validate that the application dashboard exists
      const dashboardExists = await withRequestEm(this.applicationDashboardRepo).findOne({
        where: { id: createDto.applicationDashboardId },
        select: ['id']
      });

      if (!dashboardExists) {
        throw new DatabaseException(
          `Application dashboard with ID ${createDto.applicationDashboardId} not found. ` +
          `This may indicate stale anomaly detection data. Please regenerate the anomaly detection results.`
        );
      }

      // Check if configuration already exists
      const existingConfig = await this.getDsCompareConfig(
        createDto.systemUnderTestId,
        createDto.testEnvironment,
        createDto.workload,
        createDto.applicationDashboardId,
        createDto.panelId,
        createDto.metricName,
        userId,
        isAdmin,
      ).catch(() => null);

      // getDsCompareConfig falls back from a series to its panel row when the series has no row of
      // its own. An upsert must hit the exact row: updating the panel row for a metric-scope save
      // rewrote the whole panel and, stamped as a hand edit, detached it from its template for good.
      const isExactRow = existingConfig != null && (existingConfig.metricName ?? null) === (createDto.metricName || null);
      if (existingConfig && isExactRow) {
        // Update existing configuration
        return this.updateDsCompareConfig(existingConfig.id, { configData: createDto.configData }, userId, isAdmin);
      }

      // Create new configuration
      const newConfig = this.dsCompareConfigRepo.create({
        system_under_test_id: createDto.systemUnderTestId,
        test_environment: createDto.testEnvironment,
        workload: createDto.workload,
        application_dashboard_id: createDto.applicationDashboardId,
        panel_id: parseInt(createDto.panelId, 10),
        metric_name: createDto.metricName || undefined,
        config_data: createDto.configData,
        // Inherit ownership from the parent system — organization_id is NOT NULL on
        // ds_compare_config, and a NULL would make the row invisible under RLS anyway.
        organization_id: systemUnderTest.organization_id,
        team_id: systemUnderTest.team_id,
        // Stamped like an update: a row with no author reads as machine-seeded to the golden path
        // when its config carries the Dynatrace host marker, and would be merged over.
        created_by: userId || 'user',
        updated_by: userId || 'user',
      });

      const result = await this.dsCompareConfigRepo.save(newConfig);

      // Phase 5a: DsCompareConfig uses snake_case `organization_id` directly,
      // so no override needed — AuditService.dispatch reads it off the ref.
      this.auditService.logCreate(result as unknown as OwnedResource);

      this.logger.log(`Created ds-compare config for ${createDto.systemUnderTestId}/${createDto.testEnvironment}/${createDto.workload}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      return {
        id: result.id,
        systemUnderTestId: result.system_under_test_id,
        testEnvironment: result.test_environment,
        workload: result.workload,
        applicationDashboardId: result.application_dashboard_id,
        panelId: result.panel_id.toString(),
        metricName: result.metric_name,
        configData: result.config_data,
        createdAt: result.created_at.toISOString(),
        updatedAt: result.updated_at.toISOString(),
        configSource: result.metric_name ? 'metric-specific' : 'panel-level'
      };
    } catch (error) {
      this.logger.error('Failed to create/update ds-compare configuration:', error);
      if (error instanceof DatabaseException) {
        throw error;
      }
      throw new DatabaseException(`Failed to create/update ds-compare configuration: ${(error as Error).message}`);
    }
  }

  async getDsCompareConfig(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    applicationDashboardId: string,
    panelId: string,
    metricName?: string,
    userId: string = '',
    isAdmin: boolean = false,
  ): Promise<DsCompareConfigDto> {
    try {
      const organizationIds = isAdmin ? [] : await this.resolveOrganizationIds(userId);

      // Non-admin users with no organization memberships cannot access configs
      if (!isAdmin && organizationIds.length === 0) {
        throw new ResourceNotFoundException('DS compare configuration not found');
      }

      // First validate that the system exists and user has access
      const systemQuery = withRequestEm(this.systemRepo).createQueryBuilder('sut')
        .leftJoin('sut.team', 'team')
        .where('sut.id = :id', { id: systemUnderTestId })
        .select(['sut.id']);

      // Apply organization filter for non-admin users
      if (!isAdmin) {
        systemQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
      }

      const systemUnderTest = await systemQuery.getOne();

      if (!systemUnderTest) {
        throw new ResourceNotFoundException('DS compare configuration not found');
      }

      let result: DsCompareConfig | null = null;

      if (metricName) {
        // Look for metric-specific configuration first
        result = await this.dsCompareConfigRepo.findOne({
          where: {
            system_under_test_id: systemUnderTestId,
            test_environment: testEnvironment,
            workload,
            application_dashboard_id: applicationDashboardId,
            panel_id: parseInt(panelId, 10),
            metric_name: metricName
          },
          order: { created_at: 'DESC' }
        });
      }

      if (!result) {
        // Look for panel-level configuration (metric_name IS NULL)
        result = await this.dsCompareConfigRepo.findOne({
          where: {
            system_under_test_id: systemUnderTestId,
            test_environment: testEnvironment,
            workload,
            application_dashboard_id: applicationDashboardId,
            panel_id: parseInt(panelId, 10),
            metric_name: IsNull()
          },
          order: { created_at: 'DESC' }
        });
      }

      if (!result) {
        throw new ResourceNotFoundException('DS compare configuration not found');
      }

      return {
        id: result.id,
        systemUnderTestId: result.system_under_test_id,
        testEnvironment: result.test_environment,
        workload: result.workload,
        applicationDashboardId: result.application_dashboard_id,
        panelId: result.panel_id.toString(),
        metricName: result.metric_name,
        configData: result.config_data,
        createdAt: result.created_at.toISOString(),
        updatedAt: result.updated_at.toISOString(),
        configSource: result.metric_name ? 'metric-specific' : 'panel-level'
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error('Failed to get ds-compare configuration:', error);
      throw new DatabaseException(`Failed to get ds-compare configuration: ${(error as Error).message}`);
    }
  }

  async updateDsCompareConfig(
    id: string,
    updateDto: UpdateDsCompareConfigDto,
    userId: string = '',
    isAdmin: boolean = false,
  ): Promise<DsCompareConfigDto> {
    try {
      const organizationIds = isAdmin ? [] : await this.resolveOrganizationIds(userId);

      // Non-admin users with no organization memberships cannot update configs
      if (!isAdmin && organizationIds.length === 0) {
        throw new ResourceNotFoundException('DS compare configuration', id);
      }

      // First find the config to get the system_under_test_id
      const existingConfig = await this.dsCompareConfigRepo.findOne({
        where: { id }
      });

      if (!existingConfig) {
        throw new ResourceNotFoundException('DS compare configuration', id);
      }

      // Validate that the user has access to the system
      const systemQuery = withRequestEm(this.systemRepo).createQueryBuilder('sut')
        .leftJoin('sut.team', 'team')
        .where('sut.id = :id', { id: existingConfig.system_under_test_id })
        .select(['sut.id']);

      // Apply organization filter for non-admin users
      if (!isAdmin) {
        systemQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
      }

      const systemUnderTest = await systemQuery.getOne();

      if (!systemUnderTest) {
        throw new ResourceNotFoundException('DS compare configuration', id);
      }

      // Phase 5a: clone the pre-update entity for the audit before-snapshot.
      const beforeUpdate = Object.assign(new DsCompareConfig(), existingConfig);

      await this.dsCompareConfigRepo.update(
        { id },
        // Entity config_data is Record<string, any> from shared package. updated_by is what
        // applyGoldenPathClassifications reads to tell a user edit from a worker-seeded default.
        { config_data: updateDto.configData, updated_by: userId || 'user' } as unknown as Parameters<typeof this.dsCompareConfigRepo.update>[1]
      );

      const result = await this.dsCompareConfigRepo.findOne({
        where: { id }
      });

      if (!result) {
        throw new ResourceNotFoundException('DS compare configuration', id);
      }

      this.auditService.logUpdate(
        beforeUpdate as unknown as OwnedResource,
        result as unknown as OwnedResource,
      );

      this.logger.log(`Updated ds-compare config ${id}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      return {
        id: result.id,
        systemUnderTestId: result.system_under_test_id,
        testEnvironment: result.test_environment,
        workload: result.workload,
        applicationDashboardId: result.application_dashboard_id,
        panelId: result.panel_id.toString(),
        metricName: result.metric_name,
        configData: result.config_data,
        createdAt: result.created_at.toISOString(),
        updatedAt: result.updated_at.toISOString(),
        configSource: result.metric_name ? 'metric-specific' : 'panel-level'
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error('Failed to update ds-compare configuration:', error);
      throw new DatabaseException(`Failed to update ds-compare configuration: ${(error as Error).message}`);
    }
  }

  /**
   * Apply golden-path metric classifications for a completed test run.
   *
   * Matches the SUT + environment's application dashboards against the compare-config templates
   * (`provisioned_template_ds_compare_configs` rows with `system_under_test_id IS NULL`) and keeps
   * the workload's `ds_compare_config` rows in step with them. A template names its dashboards by
   * exact `dashboard_uid`, by regex when `regex = true`, or all of them when `dashboard_uid IS NULL`,
   * and its panel by `panel_id` or, when that is NULL, by `panel_title`, resolved per dashboard
   * against the panels `ds_panels` recorded for the SUT's recent completed runs. An organization
   * template only reaches dashboards of its own organization. A profile template only reaches them
   * when the completing run's tags match its profile and the profile is in the dashboard's
   * organization (`profileMatchesRun`, which fails closed); its organization is read from the profile
   * now, never from the copy on the template row.
   *
   * Every row a template could reach goes to one winner (`selectWinner`). What happens next depends
   * on who last wrote the row:
   *
   * - no row: inserted from `INSERT_BASE` plus the winner's fields;
   * - machine-seeded and untouched (`worker-pipeline`, or a null author with the Dynatrace host
   *   marker): its current config becomes its `template_base` and the winner is merged in;
   * - template-owned (`system:golden-path`): rebuilt from `template_base` plus the CURRENT winner,
   *   or the base alone when nothing matches any more. That is what makes a template edited in git
   *   reach workloads it already seeded. One written before migration 1822 has no base and is
   *   adopted only when its winner would not change it, since it may hold a pre-v0.2.95.42 hand edit;
   * - anything else is a hand edit, and is never touched.
   *
   * Only a difference is written, so the stale trigger on `config_data` fires exactly when a row's
   * effective configuration changed; `template_id` and `template_base` sit outside it. Every write
   * is conditional on the author the snapshot saw, so a save racing this loop wins.
   */
  async applyGoldenPathClassifications(testRun: {
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    /** The completing run's tags: they choose which profile templates apply. None means none do. */
    tags?: readonly string[] | null;
  }): Promise<{ compareConfigsCreated: number }> {
    const started = Date.now();
    const { systemUnderTestId, testEnvironment, workload } = testRun;
    const runTags = testRun.tags ?? [];
    const counts = {
      created: 0, merged: 0, rebuilt: 0, rewrote: 0, raced: 0, collided: 0, legacyDiffers: 0, removed: 0, staleUnmarked: 0,
    };
    // Set after the first stale-marking failure in this pass. The UPDATE has no lock_timeout, so under
    // lock contention each attempt can wait out the pool's statement timeout; skipping the rest bounds
    // the completion request to one such wait, as before the marking was made non-fatal.
    let staleMarkingFailed = false;
    const guarded = new Map<string, number>();
    const ties = new Set<string>();
    const profileTies = new Set<string>();

    // 1. Load application dashboards for this SUT + environment
    const dashboards = await withRequestEm(this.applicationDashboardRepo).find({
      where: { systemUnderTestId, testEnvironment },
    });

    if (dashboards.length === 0) {
      this.logger.debug(`No application dashboards found for SUT ${systemUnderTestId} / ${testEnvironment}`);
      return { compareConfigsCreated: 0 };
    }

    // 2. All templates. No early return when there are none: rows a removed template seeded still
    // have to go back to their base.
    const templates: GoldenPathTemplate[] = [];
    // A template skipped for a bad pattern still owns its rows: leaving them alone beats reverting
    // every one of them because of a typo, and the next good file puts it back in force.
    const skippedTemplateIds = new Set<string>();
    const uidPatterns = new Map<string, RegExp>();
    const titlePatterns = new Map<string, RegExp>();
    // The ReDoS check runs here as well as in the parser: a pattern stored before v0.2.97.54 was
    // never checked, the parser cannot replace it (the pattern is part of the template's key), and
    // it runs against Grafana-edited uids and titles inside every completion request. A bad pattern
    // skips this template only; provisioning and completion carry on.
    const compile = (templateId: string, field: 'dashboard_uid' | 'panel_title', pattern: string): RegExp | null => {
      try {
        const check = validateRegexPattern(pattern, { maxLength: 255 });
        if (!check.safe) throw new Error(check.error);
        return new RegExp(pattern);
      } catch (err) {
        this.logger.warn(`Skipping golden-path template ${templateId}: invalid ${field} regex "${pattern}": ${(err as Error).message}`);
        skippedTemplateIds.add(templateId);
        return null;
      }
    };
    const storedTemplates = await this.templateRepo.find({ where: { system_under_test_id: IsNull() } });
    // Profile templates take their profile's name (precedence step 4), tags and organization from the
    // profile itself: a profile moved to another organization moves its templates with it.
    const profileIds = [...new Set(storedTemplates.map((t) => t.profile_id).filter((id): id is string => !!id))];
    const profiles = new Map<string, { name: string; tags: string[] | null; organizationId: string | null }>();
    if (profileIds.length > 0) {
      const rows: Array<{ id: string; name: string; tags: string[] | null; organization_id: string | null }> =
        await this.templateRepo.query(
          `SELECT id, name, tags, organization_id FROM profiles WHERE id = ANY($1::uuid[])`,
          [profileIds],
        );
      for (const r of rows) profiles.set(r.id, { name: r.name, tags: r.tags, organizationId: r.organization_id });
    }
    for (const stored of storedTemplates) {
      let template = stored as GoldenPathTemplate;
      if (stored.profile_id) {
        const profile = profiles.get(stored.profile_id);
        // Deleted between the two reads (the FK cascades): its templates are going too.
        if (!profile) continue;
        template = { ...template, organization_id: profile.organizationId, profile_name: profile.name };
      }
      if (template.panel_id == null) {
        if (!template.panel_title) {
          this.logger.warn(`Skipping golden-path template ${template.id}: neither panel_id nor panel_title set`);
          skippedTemplateIds.add(template.id);
          continue;
        }
        if (template.regex) {
          const pattern = compile(template.id, 'panel_title', template.panel_title);
          if (!pattern) continue;
          titlePatterns.set(template.id, pattern);
        }
      }
      if (template.dashboard_uid && template.regex) {
        const pattern = compile(template.id, 'dashboard_uid', template.dashboard_uid);
        if (!pattern) continue;
        uidPatterns.set(template.id, pattern);
      }
      templates.push(template);
    }
    // Which profiles the run matches, per organization (dashboards carry theirs, NOT NULL).
    const matchedProfiles = new Map<string, Set<string>>();
    const profilesMatching = (organizationId: string): Set<string> => {
      let ids = matchedProfiles.get(organizationId);
      if (!ids) {
        ids = new Set(
          [...profiles]
            .filter(([, p]) => profileMatchesRun(p, { tags: runTags, organizationId }))
            .map(([id]) => id),
        );
        matchedProfiles.set(organizationId, ids);
      }
      return ids;
    };

    const titleTemplateIds = new Set(templates.filter((t) => t.panel_id == null).map((t) => t.id));

    // Title templates need each dashboard's panel list. `ds_panels` is per run, so read the SUT's
    // most recent completed runs (index-bounded) rather than the whole table; a dashboard whose
    // panels have never been collected resolves nothing this run and is picked up on the next.
    const panelsByDashboard = new Map<string, Array<{ id: number; title: string }>>();
    if (templates.some((t) => t.panel_id == null)) {
      const rows: Array<{ dashboard_id: string; panel_id: number; panel_title: string }> = await this.dsPanelsRepo.query(
        `SELECT DISTINCT p.application_dashboard_id AS dashboard_id, p.panel_id, p.panel_title
           FROM ds_panels p
          WHERE p.application_dashboard_id = ANY($1::uuid[])
            AND p.panel_id IS NOT NULL AND p.panel_title IS NOT NULL
            AND p.test_run_id IN (
              SELECT test_run_id FROM test_runs
               WHERE system_under_test_id = $2 AND test_environment = $3 AND completed = true
               ORDER BY end_time DESC NULLS LAST LIMIT 10)`,
        [dashboards.map((d) => d.id), systemUnderTestId, testEnvironment],
      );
      for (const r of rows) {
        const list = panelsByDashboard.get(r.dashboard_id) ?? [];
        list.push({ id: r.panel_id, title: r.panel_title });
        panelsByDashboard.set(r.dashboard_id, list);
      }
    }

    // 3. The workload's rows, in one lookup. Keyed `${dashboard}|${panel}|${metric ?? ''}`: a row is
    // reachable only by a template with the SAME metric_name (NULL to NULL), so a panel template
    // never claims a per-series row such as series grouping's `api (sum)`, which is unclassified on
    // purpose, and a single per-series tweak never blocks the panel's own template.
    const existingConfigs = await this.dsCompareConfigRepo.find({
      where: { system_under_test_id: systemUnderTestId, test_environment: testEnvironment, workload },
      select: [
        'id', 'application_dashboard_id', 'panel_id', 'metric_name', 'config_data', 'created_by', 'updated_by', 'template_id',
        'template_base',
      ],
    });
    const rowKey = (dashboardId: string, panelId: number, metricName?: string | null) =>
      `${dashboardId}|${panelId}|${metricName ?? ''}`;
    const configsByKey = new Map(existingConfigs.map((c) => [rowKey(c.application_dashboard_id, c.panel_id, c.metric_name), c]));
    // Rows a machine seeded and nobody has touched since: PerformanceTestMetricsPipeline writes a
    // default panel-level config for every perf-test panel during the run (so BEFORE this runs), and
    // the Dynatrace host mapping writes one per host panel with no author at all. Without this they
    // would read as hand edits and every template on those dashboards would be skipped forever.
    const machineSeeded = (c: DsCompareConfig) =>
      c.updated_by === WORKER_ACTOR ||
      (!c.updated_by && (c.config_data as Record<string, unknown> | null)?.source === DYNATRACE_HOST_COMPARE_SOURCE);
    type ConfigPatch = Partial<Pick<DsCompareConfig, 'config_data' | 'updated_by' | 'template_id' | 'template_base'>>;
    // Every write is computed from the snapshot read above and conditional on the author it saw, so
    // a hand edit saved while this loop runs (a user save stamps its own author) is never overwritten
    // or re-owned; the row is simply skipped this time. Returns false when that happened.
    const updateRow = async (row: DsCompareConfig, patch: ConfigPatch) => {
      // Phase 5a: NOT audited, like the inserts below.
      // eslint-disable-next-line audit-mutation-must-log
      const result = await this.dsCompareConfigRepo.update(
        { id: row.id, updated_by: row.updated_by ?? IsNull() },
        patch as unknown as Parameters<typeof this.dsCompareConfigRepo.update>[1],
      );
      if (result?.affected === 0) {
        counts.raced++;
        return false;
      }
      return true;
    };

    // 4. Per dashboard: pick each row's winner, then insert, merge or rebuild.
    for (const dashboard of dashboards) {
      const uid = dashboard.dashboardUid;
      if (!uid) continue;
      const panels = panelsByDashboard.get(dashboard.id) ?? [];
      const onDashboard = templates.filter(
        (t) =>
          (t.profile_id
            ? profilesMatching(dashboard.organizationId).has(t.profile_id)
            : !t.organization_id || t.organization_id === dashboard.organizationId) &&
          (!t.dashboard_uid || (t.regex ? uidPatterns.get(t.id)!.test(uid) : t.dashboard_uid === uid)),
      );

      const candidates = new Map<string, { panelId: number; metricName: string | null; list: GoldenPathTemplate[] }>();
      for (const template of onDashboard) {
        const panelIds =
          template.panel_id != null
            ? [template.panel_id]
            : panels
                .filter((p) => (template.regex ? titlePatterns.get(template.id)!.test(p.title) : p.title === template.panel_title))
                .map((p) => p.id);
        for (const panelId of new Set(panelIds)) {
          const key = rowKey(dashboard.id, panelId, template.metric_name);
          const entry = candidates.get(key) ?? { panelId, metricName: template.metric_name ?? null, list: [] };
          entry.list.push(template);
          candidates.set(key, entry);
        }
      }
      const winners = new Map<string, GoldenPathTemplate>();
      for (const [key, { list }] of candidates) {
        const { winner, tiedWith } = selectWinner(list);
        if (tiedWith) {
          if (winner!.profile_name && tiedWith.profile_name && winner!.profile_name !== tiedWith.profile_name) {
            profileTies.add(`"${winner!.profile_name}" over "${tiedWith.profile_name}"`);
          } else {
            ties.add(`${winner!.id} over ${tiedWith.id}`);
          }
        }
        winners.set(key, winner!);
      }

      // a) Rows no template has owned yet.
      for (const [key, { panelId, metricName }] of candidates) {
        const winner = winners.get(key)!;
        const row = configsByKey.get(key);
        if (!row) {
          const newConfig = this.dsCompareConfigRepo.create({
            system_under_test_id: systemUnderTestId,
            test_environment: testEnvironment,
            workload,
            application_dashboard_id: dashboard.id,
            panel_id: panelId,
            metric_name: metricName ?? undefined,
            config_data: rebuildConfig(INSERT_BASE, winner),
            template_base: cloneJson(INSERT_BASE) as Record<string, unknown>,
            template_id: winner.id,
            // Inherit ownership from the dashboard (organization_id NOT NULL on both).
            organization_id: dashboard.organizationId,
            team_id: dashboard.teamId,
            created_by: GOLDEN_PATH_ACTOR,
            updated_by: GOLDEN_PATH_ACTOR,
          });
          // Phase 5a (PR13): NOT audited. applyGoldenPathClassifications is a
          // worker-driven system action triggered on test-run completion (the
          // hard-coded `created_by: 'system:golden-path'` flags it). Auditing
          // it would generate a per-metric audit row on every test-run
          // ingestion at zero compliance value — bucket-2 pattern from the
          // PR8 deferral notes.
          try {
            // eslint-disable-next-line audit-mutation-must-log
            await this.dsCompareConfigRepo.save(newConfig);
            counts.created++;
          } catch (err) {
            // Another writer got there first: a live tick's seed, or an overlapping completion of the
            // same workload. Its row is picked up on the next completion; the rest of this run carries
            // on instead of leaving every later dashboard unapplied. (These writes are not on the
            // request's transaction, so a failed INSERT aborts nothing else.)
            if ((err as { code?: string } | null)?.code !== '23505') throw err;
            counts.collided++;
          }
        } else if (machineSeeded(row)) {
          // Merged once; the stamp makes it template-owned from here on.
          const base = row.config_data ?? {};
          const data = rebuildConfig(base, winner);
          const changed = !isDeepStrictEqual(data, row.config_data);
          const patch: ConfigPatch = { updated_by: GOLDEN_PATH_ACTOR, template_base: base, template_id: winner.id };
          if (changed) patch.config_data = data;
          if (await updateRow(row, patch)) {
            counts.merged++;
            if (changed) counts.rewrote++;
          }
        }
      }

      // b) Template-owned rows: rebuilt from their base plus whichever template wins them now.
      for (const row of existingConfigs) {
        if (row.application_dashboard_id !== dashboard.id || row.updated_by !== GOLDEN_PATH_ACTOR) continue;
        if (row.template_id && skippedTemplateIds.has(row.template_id)) continue;
        const winner = winners.get(rowKey(row.application_dashboard_id, row.panel_id, row.metric_name));
        // Collection-gap guard: a row a TITLE template owns whose panel is missing from the recent
        // panel list cannot be told apart from one the title stopped matching, so it is left alone
        // rather than flap. A row an id template owns is decidable without the list: perf-test
        // dashboards never get ds_panels rows at all, and guarding them would freeze them for good.
        // A row with no template_id yet (written before migration 1822) is decidable when a template
        // wins it now, and otherwise waits while a title template of its own metric reaches this
        // dashboard.
        const titleOwned = row.template_id
          ? titleTemplateIds.has(row.template_id)
          : !winner && onDashboard.some((t) => t.panel_id == null && (t.metric_name ?? null) === (row.metric_name ?? null));
        if (titleOwned && !panels.some((p) => p.id === row.panel_id)) {
          guarded.set(uid, (guarded.get(uid) ?? 0) + 1);
          continue;
        }
        if (row.template_base == null) {
          // Written before migration 1822, with no base. Before v0.2.95.42 a hand edit did not change
          // updated_by, so such a row can hold a user's edit under the golden-path stamp, and its
          // current config is the only base there is. It is adopted only when the winner would not
          // change it; otherwise it is left alone, exactly as it was before this version.
          const current = row.config_data ?? {};
          if (!isDeepStrictEqual(rebuildConfig(current, winner), row.config_data)) {
            counts.legacyDiffers++;
            continue;
          }
          await updateRow(row, { template_base: current, template_id: winner?.id ?? null });
          continue;
        }
        if (!winner && row.created_by === GOLDEN_PATH_ACTOR && isDeepStrictEqual(row.template_base, cloneJson(INSERT_BASE))) {
          // The applier inserted this row for a template that no longer wins it: a deleted template,
          // or a profile template on a run whose tags do not match. Rebuilding it from INSERT_BASE
          // would leave a row the panel never had (mean, `none`) where ADAPT otherwise uses its own
          // default (median, unclassified), so untagged runs would silently switch aggregation after
          // a single tagged one. Delete it instead, conditional on the author the snapshot saw, and
          // mark its results stale by hand: a delete fires no `trigger_mark_stale_on_config_update`.
          // eslint-disable-next-line audit-mutation-must-log
          const removed = await this.dsCompareConfigRepo.delete({ id: row.id, updated_by: row.updated_by ?? IsNull() });
          if (removed?.affected === 0) {
            counts.raced++;
            continue;
          }
          counts.removed++;
          // Advisory: nothing reads `is_stale` into a verdict, so a failure here is logged and the rest
          // of the workload's dashboards are still applied (the delete above has already committed).
          // After one failure the remaining rows of this pass are not marked (see staleMarkingFailed).
          const target =
            `SUT ${systemUnderTestId}/${testEnvironment}/${workload}, dashboard ${row.application_dashboard_id}, ` +
            `panel ${row.panel_id}${row.metric_name ? `, metric "${row.metric_name.replace(/[\r\n]/g, '')}"` : ''}`;
          if (staleMarkingFailed) {
            counts.staleUnmarked++;
            this.logger.error(`Golden-path: results not marked stale after removing the compare config for ${target} (skipped after an earlier failure)`);
            continue;
          }
          try {
            await this.dsCompareConfigRepo.query(
            `UPDATE ds_adapt_results
                SET is_stale = true, stale_reason = 'Configuration removed', stale_at = NOW()
              WHERE EXISTS (SELECT 1 FROM test_runs tr
                             WHERE tr.test_run_id = ds_adapt_results.test_run_id
                               AND tr.system_under_test_id = $1 AND tr.test_environment = $2 AND tr.workload = $3)
                AND application_dashboard_id = $4
                AND panel_id = $5
                AND ($6::text IS NULL OR metric_name = $6)
                AND is_stale = false`,
              [systemUnderTestId, testEnvironment, workload, row.application_dashboard_id, row.panel_id, row.metric_name ?? null],
            );
          } catch (err) {
            staleMarkingFailed = true;
            counts.staleUnmarked++;
            this.logger.error(
              `Golden-path: could not mark results stale after removing the compare config for ${target}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          continue;
        }
        const data = rebuildConfig(row.template_base, winner);
        const patch: ConfigPatch = {};
        if (!isDeepStrictEqual(data, row.config_data)) patch.config_data = data;
        if ((winner?.id ?? null) !== (row.template_id ?? null)) patch.template_id = winner?.id ?? null;
        if (Object.keys(patch).length === 0) continue;
        if ((await updateRow(row, patch)) && patch.config_data) {
          counts.rebuilt++;
          counts.rewrote++;
        }
      }
    }

    const compareConfigsCreated = counts.created + counts.merged;
    const ms = Date.now() - started;
    const details = [
      ...(guarded.size > 0
        ? [`left alone for a collection gap: ${[...guarded].map(([uid, n]) => `${uid} (${n})`).join(', ')}`]
        : []),
      ...(profileTies.size > 0 ? [`decided by profile name: ${[...profileTies].join(', ')}`] : []),
      ...(ties.size > 0 ? [`decided by template id: ${[...ties].join(', ')}`] : []),
      ...(counts.legacyDiffers > 0
        ? [`${counts.legacyDiffers} pre-v0.2.97.54 row(s) left alone because their template would change them (possibly a hand edit)`]
        : []),
      ...(counts.removed > 0
        ? [`${counts.removed} applier-inserted row(s) removed: no template wins them now, so ADAPT's default applies`]
        : []),
      ...(counts.staleUnmarked > 0 ? [`${counts.staleUnmarked} removal(s) whose ADAPT results were not marked stale (see errors above)`] : []),
      ...(counts.raced > 0 ? [`${counts.raced} row(s) skipped: edited while this ran`] : []),
      ...(counts.collided > 0 ? [`${counts.collided} insert(s) skipped: row created concurrently`] : []),
    ];
    const summary =
      `Golden-path applied for SUT ${systemUnderTestId}/${testEnvironment}/${workload}: ` +
      `${compareConfigsCreated} compare configs created (${counts.created} inserted, ${counts.merged} merged), ` +
      `${counts.rebuilt} rebuilt, rewrote=${counts.rewrote} in ${ms}ms` +
      (details.length > 0 ? `; ${details.join('; ')}` : '');
    if (ms > GOLDEN_PATH_SLOW_MS) this.logger.warn(`${summary} (slow: this runs inside the completion request)`);
    else this.logger.log(summary);

    return { compareConfigsCreated };
  }

  async deleteDsCompareConfig(
    id: string,
    userId: string = '',
    isAdmin: boolean = false,
  ): Promise<void> {
    try {
      const organizationIds = isAdmin ? [] : await this.resolveOrganizationIds(userId);

      // Non-admin users with no organization memberships cannot delete configs
      if (!isAdmin && organizationIds.length === 0) {
        throw new ResourceNotFoundException('DS compare configuration', id);
      }

      // First find the config to get the system_under_test_id
      const existingConfig = await this.dsCompareConfigRepo.findOne({
        where: { id }
      });

      if (!existingConfig) {
        throw new ResourceNotFoundException('DS compare configuration', id);
      }

      // Validate that the user has access to the system
      const systemQuery = withRequestEm(this.systemRepo).createQueryBuilder('sut')
        .leftJoin('sut.team', 'team')
        .where('sut.id = :id', { id: existingConfig.system_under_test_id })
        .select(['sut.id']);

      // Apply organization filter for non-admin users
      if (!isAdmin) {
        systemQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
      }

      const systemUnderTest = await systemQuery.getOne();

      if (!systemUnderTest) {
        throw new ResourceNotFoundException('DS compare configuration', id);
      }

      // Phase 5a: log DELETE before the row is removed so the diff captures
      // the pre-delete state.
      this.auditService.logDelete(existingConfig as unknown as OwnedResource);

      const result = await this.dsCompareConfigRepo.delete({ id });

      if (result.affected === 0) {
        throw new ResourceNotFoundException('DS compare configuration', id);
      }

      this.logger.log(`Deleted ds-compare config ${id}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete ds-compare configuration:', error);
      throw new DatabaseException(`Failed to delete ds-compare configuration: ${(error as Error).message}`);
    }
  }
}
