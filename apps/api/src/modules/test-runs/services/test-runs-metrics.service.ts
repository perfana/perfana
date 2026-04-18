import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import {
  TestRun as TestRunEntity,
  SystemUnderTest as SystemEntity,
  DsCompareConfig,
  ProvisionedTemplateDsCompareConfig,
  ApplicationDashboard,
} from '../../../entities';
import { CreateMetricClassificationDto, MetricClassificationDto } from '../dto/metric-classification.dto';
import { CreateDsCompareConfigDto, UpdateDsCompareConfigDto, DsCompareConfigDto } from '../dto/ds-compare-config.dto';
import { ResourceNotFoundException, DatabaseException } from '../../../common/exceptions/business.exception';
import { AuthorizationService } from '../../../common/services/authorization.service';

/**
 * Global admin roles that bypass organization filtering
 */
const ADMIN_ROLES = ['perfana-admin', 'super-admin', 'admin'];

@Injectable()
export class TestRunsMetricsService {
  private readonly logger = new Logger(TestRunsMetricsService.name);

  /**
   * Check if a user has global admin role
   */
  private isGlobalAdmin(roles: string[]): boolean {
    return roles.some(role => ADMIN_ROLES.includes(role));
  }

  /**
   * Resolve organization IDs for a user via AuthorizationService.
   * Returns the organizationIds array, or an empty array if resolution fails.
   */
  private async resolveOrganizationIds(userId: string, roles: string[]): Promise<string[]> {
    if (this.isGlobalAdmin(roles)) {
      return []; // Admins bypass org filtering, empty array is fine
    }
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
    private authorizationService: AuthorizationService,
  ) {}

  async classifyMetric(
    testRunId: string,
    createDto: CreateMetricClassificationDto,
    system?: string,
    environment?: string,
    workload?: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<MetricClassificationDto> {
    try {
      this.logger.log(`Classifying metric for test run: ${testRunId}`);

      const isAdmin = this.isGlobalAdmin(roles);
      const organizationIds = isAdmin ? [] : await this.resolveOrganizationIds(userId, roles);

      // Non-admin users with no organization memberships cannot classify metrics
      if (!isAdmin && organizationIds.length === 0) {
        throw new ResourceNotFoundException('TestRun', testRunId);
      }

      let systemUnderTestId: string;
      let testEnvironment: string;
      let testWorkload: string;

      if (system && environment && workload) {
        // Use provided query parameters with organization filtering
        const systemQuery = this.systemRepo.createQueryBuilder('sut')
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
        const testRunQuery = this.testRunRepo.createQueryBuilder('tr')
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
        this.logger.log(`Updated existing metric classification for: ${sanitizeString(createDto.dashboardLabel) || 'no-dashboard'}/${sanitizeString(createDto.panelTitle) || 'no-panel'}/${sanitizeString(createDto.metricName) || 'panel-wide'}`);
      } else {
        // Create new classification
        const newClassification = this.templateRepo.create(classificationData);
        result = await this.templateRepo.save(newClassification);
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
    roles: string[] = [],
  ): Promise<DsCompareConfigDto> {
    try {
      const isAdmin = this.isGlobalAdmin(roles);
      const organizationIds = isAdmin ? [] : await this.resolveOrganizationIds(userId, roles);

      // Non-admin users with no organization memberships cannot create/update configs
      if (!isAdmin && organizationIds.length === 0) {
        throw new ResourceNotFoundException('System under test', createDto.systemUnderTestId);
      }

      // Validate that the system under test exists and user has access
      const systemQuery = this.systemRepo.createQueryBuilder('sut')
        .leftJoin('sut.team', 'team')
        .where('sut.id = :id', { id: createDto.systemUnderTestId })
        .select(['sut.id']);

      // Apply organization filter for non-admin users
      if (!isAdmin) {
        systemQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
      }

      const systemUnderTest = await systemQuery.getOne();

      if (!systemUnderTest) {
        throw new ResourceNotFoundException('System under test', createDto.systemUnderTestId);
      }

      // Validate that the application dashboard exists
      const dashboardExists = await this.applicationDashboardRepo.findOne({
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
        roles,
      ).catch(() => null);

      if (existingConfig) {
        // Update existing configuration
        return this.updateDsCompareConfig(existingConfig.id, { configData: createDto.configData }, userId, roles);
      }

      // Create new configuration
      const newConfig = this.dsCompareConfigRepo.create({
        system_under_test_id: createDto.systemUnderTestId,
        test_environment: createDto.testEnvironment,
        workload: createDto.workload,
        application_dashboard_id: createDto.applicationDashboardId,
        panel_id: parseInt(createDto.panelId, 10),
        metric_name: createDto.metricName || undefined,
        config_data: createDto.configData
      });

      const result = await this.dsCompareConfigRepo.save(newConfig);

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
    roles: string[] = [],
  ): Promise<DsCompareConfigDto> {
    try {
      const isAdmin = this.isGlobalAdmin(roles);
      const organizationIds = isAdmin ? [] : await this.resolveOrganizationIds(userId, roles);

      // Non-admin users with no organization memberships cannot access configs
      if (!isAdmin && organizationIds.length === 0) {
        throw new ResourceNotFoundException('DS compare configuration not found');
      }

      // First validate that the system exists and user has access
      const systemQuery = this.systemRepo.createQueryBuilder('sut')
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
    roles: string[] = [],
  ): Promise<DsCompareConfigDto> {
    try {
      const isAdmin = this.isGlobalAdmin(roles);
      const organizationIds = isAdmin ? [] : await this.resolveOrganizationIds(userId, roles);

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
      const systemQuery = this.systemRepo.createQueryBuilder('sut')
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

      await this.dsCompareConfigRepo.update(
        { id },
        // Entity config_data is Record<string, any> from shared package
        { config_data: updateDto.configData as any } as any
      );

      const result = await this.dsCompareConfigRepo.findOne({
        where: { id }
      });

      if (!result) {
        throw new ResourceNotFoundException('DS compare configuration', id);
      }

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
   * Loads all ApplicationDashboard records for the test run's SUT + environment,
   * matches them against golden-path template records (ProvisionedTemplateDsCompareConfig with
   * system_under_test_id IS NULL), and creates per-test-run DsCompareConfig records
   * (if they don't already exist) with the classification and thresholds embedded
   * in config_data.
   *
   * The provisioned_template_ds_compare_configs table only holds templates (no per-test-run rows).
   * The per-test-run data lives in ds_compare_config.config_data.metricClassification.
   */
  async applyGoldenPathClassifications(testRun: {
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
  }): Promise<{ compareConfigsCreated: number }> {
    const { systemUnderTestId, testEnvironment, workload } = testRun;
    let compareConfigsCreated = 0;

    // 1. Load application dashboards for this SUT + environment
    const dashboards = await this.applicationDashboardRepo.find({
      where: { systemUnderTestId, testEnvironment },
    });

    if (dashboards.length === 0) {
      this.logger.debug(`No application dashboards found for SUT ${systemUnderTestId} / ${testEnvironment}`);
      return { compareConfigsCreated };
    }

    // 2. Load all golden-path templates (system_under_test_id IS NULL)
    const goldenPathTemplates = await this.templateRepo.find({
      where: { system_under_test_id: IsNull() },
    });

    if (goldenPathTemplates.length === 0) {
      this.logger.debug('No golden-path metric classification templates found');
      return { compareConfigsCreated };
    }

    // Index templates by dashboard_uid for fast lookup
    const templatesByUid = new Map<string, typeof goldenPathTemplates>();
    for (const template of goldenPathTemplates) {
      if (!template.dashboard_uid) continue;
      const existing = templatesByUid.get(template.dashboard_uid) ?? [];
      existing.push(template);
      templatesByUid.set(template.dashboard_uid, existing);
    }

    // 3. For each dashboard, find matching templates and create DsCompareConfig records
    for (const dashboard of dashboards) {
      if (!dashboard.dashboardUid) continue;
      const matchingTemplates = templatesByUid.get(dashboard.dashboardUid);
      if (!matchingTemplates) continue;

      for (const template of matchingTemplates) {
        const compareConfigWhere: Record<string, string | number | undefined> = {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload,
          application_dashboard_id: dashboard.id,
          panel_id: template.panel_id,
        };
        if (template.metric_name) {
          compareConfigWhere.metric_name = template.metric_name;
        }

        const existingConfig = await this.dsCompareConfigRepo.findOne({
          where: compareConfigWhere,
        });

        if (!existingConfig) {
          // Build config_data matching actual DB schema:
          // { thresholds, metricClassification, defaultValueIfControlGroupMissing }
          const overrides = template.config_overrides ?? {};
          const configData: Record<string, unknown> = {
            thresholds: {
              aggregation: 'mean',
              iqrThreshold: 2,
              absoluteThreshold: overrides.absThreshold ?? null,
              percentageThreshold: 0.15,
            },
            metricClassification: {
              classification: template.metric_classification ?? 'none',
              higherIsBetter: template.higher_is_better ?? null,
            },
            defaultValueIfControlGroupMissing: 0,
          };

          // Apply golden-path overrides
          if (overrides.ignore !== undefined) {
            configData.ignore = overrides.ignore;
          }
          if (overrides.ignoreMeanDiffSmallerThan !== undefined) {
            configData.ignoreMeanDiffSmallerThan = overrides.ignoreMeanDiffSmallerThan;
          }

          const newConfig = this.dsCompareConfigRepo.create({
            system_under_test_id: systemUnderTestId,
            test_environment: testEnvironment,
            workload,
            application_dashboard_id: dashboard.id,
            panel_id: template.panel_id ?? 0,
            metric_name: template.metric_name,
            config_data: configData,
            created_by: 'system:golden-path',
            updated_by: 'system:golden-path',
          });
          await this.dsCompareConfigRepo.save(newConfig);
          compareConfigsCreated++;
        }
      }
    }

    this.logger.log(
      `Golden-path applied for SUT ${systemUnderTestId}/${testEnvironment}/${workload}: ` +
      `${compareConfigsCreated} compare configs created`,
    );

    return { compareConfigsCreated };
  }

  async deleteDsCompareConfig(
    id: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<void> {
    try {
      const isAdmin = this.isGlobalAdmin(roles);
      const organizationIds = isAdmin ? [] : await this.resolveOrganizationIds(userId, roles);

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
      const systemQuery = this.systemRepo.createQueryBuilder('sut')
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
