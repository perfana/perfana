import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets, DeepPartial } from 'typeorm';
import { CompareFilterPreset, ApplicationDashboard, TestRun as TestRunEntity } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { OwnedResource } from '@perfana/shared';
import { CreateComparePresetDto } from './dto/create-compare-preset.dto';
import { UpdateComparePresetDto } from './dto/update-compare-preset.dto';
import { ComparePresetResponseDto } from './dto/compare-preset-response.dto';
import { PresetType, CompareSeriesConfig } from './dto/create-compare-preset.dto';
import { ResourceNotFoundException } from '../../common/exceptions/business.exception';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ComparePresetsService {
  private readonly logger = new Logger(ComparePresetsService.name);

  constructor(
    @InjectRepository(CompareFilterPreset)
    private comparePresetRepo: Repository<CompareFilterPreset>,
    @InjectRepository(TestRunEntity)
    private testRunRepo: Repository<TestRunEntity>,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Validate that the user has access to a test run via organization membership.
   * `orgIds === null` is the global-admin sentinel from `withOrgFilter` (bypass).
   * `orgIds.length === 0` means a non-admin with no memberships (no access).
   */
  private async validateTestRunAccess(
    testRunId: string,
    orgIds: string[] | null,
  ): Promise<boolean> {
    if (orgIds === null) {
      return true;
    }

    if (orgIds.length === 0) {
      return false;
    }

    // Check if the test run belongs to one of the user's organizations
    const query = `
      SELECT 1
      FROM test_runs tr
      INNER JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
      WHERE tr.test_run_id = $1
        AND sut.organization_id = ANY($2::uuid[])
      LIMIT 1
    `;

    const result = await withRequestEm(this.testRunRepo).query(query, [testRunId, orgIds]);
    return result && result.length > 0;
  }

  async create(
    createComparePresetDto: CreateComparePresetDto,
    userId: string,
    roles: string[] = [],
  ): Promise<ComparePresetResponseDto> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    this.logger.log(`Creating compare preset: ${createComparePresetDto.name}${orgIds === null ? ' (admin)' : ''}`);

    try {
      // Validate access to referenced test runs for non-admin users
      if (orgIds !== null) {
        // Check baseline test run access
        if (createComparePresetDto.baseline_test_run_id) {
          const hasAccess = await this.validateTestRunAccess(
            createComparePresetDto.baseline_test_run_id,
            orgIds,
          );
          if (!hasAccess) {
            throw new ResourceNotFoundException('TestRun', createComparePresetDto.baseline_test_run_id);
          }
        }

        // Check created-for test run access
        if (createComparePresetDto.created_for_test_run_id) {
          const hasAccess = await this.validateTestRunAccess(
            createComparePresetDto.created_for_test_run_id,
            orgIds,
          );
          if (!hasAccess) {
            throw new ResourceNotFoundException('TestRun', createComparePresetDto.created_for_test_run_id);
          }
        }
      }

      // CompareFilterPreset.organization_id is NOT NULL. Inherit org/team from
      // the parent test run's SUT when one is referenced; otherwise default to
      // the caller's first accessible org (legacy presets without test-run scope).
      const parentTestRunId =
        createComparePresetDto.created_for_test_run_id ||
        createComparePresetDto.baseline_test_run_id;
      let organizationId: string;
      let teamId: string | undefined;
      if (parentTestRunId) {
        const parentTestRun = await withRequestEm(this.testRunRepo).findOne({
          where: { testRunId: parentTestRunId },
          relations: ['systemUnderTest'],
        });
        if (!parentTestRun?.systemUnderTest) {
          throw new ResourceNotFoundException('TestRun', parentTestRunId);
        }
        organizationId = parentTestRun.systemUnderTest.organization_id;
        teamId = parentTestRun.systemUnderTest.team_id;
      } else {
        const orgs = await this.authzService.getAccessibleOrganizations(userId);
        const first = orgs?.[0];
        if (!first) {
          throw new ForbiddenException('No accessible organization found for user');
        }
        organizationId = first;
      }

      const preset = this.comparePresetRepo.create({
        name: createComparePresetDto.name,
        description: createComparePresetDto.description,
        presetType: createComparePresetDto.preset_type,
        seriesSearchText: createComparePresetDto.series_search_text,
        showPercentiles: createComparePresetDto.show_percentiles || false,
        applicationDashboardId: createComparePresetDto.application_dashboard_id,
        metricsSourceId: createComparePresetDto.metrics_source_id,
        source: createComparePresetDto.source,
        dashboardLabel: createComparePresetDto.dashboard_label,
        panelId: createComparePresetDto.panel_id,
        panelTitle: createComparePresetDto.panel_title,
        baselineTestRunId: createComparePresetDto.baseline_test_run_id,
        seriesConfig: createComparePresetDto.series_config as unknown as Record<string, unknown>[],
        displayConfig: createComparePresetDto.display_config as unknown as Record<string, unknown>,
        createdForTestRunId: createComparePresetDto.created_for_test_run_id,
        isGlobal: createComparePresetDto.is_global || false,
        createdBy: userId,
        organizationId,
        teamId,
      } as unknown as DeepPartial<CompareFilterPreset>);

      const savedPreset = await withRequestEm(this.comparePresetRepo).save(preset);

      // Phase 5a: CompareFilterPreset.organization_id maps to camelCase
      // property organizationId, so AuditService.dispatch cannot read it off
      // ref directly — pass organizationIdOverride so the audit row is org-scoped.
      this.auditService.logCreate(savedPreset as unknown as OwnedResource, {
        organizationIdOverride: (savedPreset as unknown as CompareFilterPreset).organizationId,
      });

      return this.mapToDto((savedPreset as unknown) as CompareFilterPreset, null, null);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof ResourceNotFoundException) throw error;
      this.logger.error('Failed to create compare preset:', error);
      throw new Error(`Failed to create compare preset: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  async findAll(
    userId: string,
    currentTestRunId?: string,
    roles: string[] = [],
    metricsSourceId?: string,
  ): Promise<ComparePresetResponseDto[]> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    this.logger.log(`Fetching compare presets for user: ${userId}${orgIds === null ? ' (admin)' : ''}`);

    try {
      // Resolve SUT context from the provided testRunId
      let sutContext: { systemUnderTestId: string; testEnvironment: string; workload: string } | null = null;
      if (currentTestRunId) {
        const testRun = await withRequestEm(this.testRunRepo).findOne({
          where: { testRunId: currentTestRunId },
          select: ['systemUnderTestId', 'testEnvironment', 'workload'],
        });
        if (testRun) {
          sutContext = {
            systemUnderTestId: testRun.systemUnderTestId,
            testEnvironment: testRun.testEnvironment,
            workload: testRun.workload,
          };
        }
      }

      // Get presets — admins see all, others see own + global
      const queryBuilder = withRequestEm(this.comparePresetRepo)
        .createQueryBuilder('preset')
        .leftJoinAndSelect('preset.applicationDashboard', 'dashboard');

      if (orgIds !== null) {
        queryBuilder.where('(preset.createdBy = :userId OR preset.isGlobal = :isGlobal)', {
          userId,
          isGlobal: true
        });
      }

      // Scope presets to the same SUT/environment/workload
      if (sutContext) {
        queryBuilder
          .leftJoin('test_runs', 'tr', 'tr.test_run_id = preset.createdForTestRunId')
          .andWhere(new Brackets(qb => {
            qb.where(
              'tr.system_under_test_id = :sutId AND tr.test_environment = :env AND tr.workload = :workload',
              { sutId: sutContext.systemUnderTestId, env: sutContext.testEnvironment, workload: sutContext.workload }
            )
            .orWhere('preset.createdForTestRunId IS NULL');
          }));
      }

      if (metricsSourceId) {
        queryBuilder.andWhere('preset.metricsSourceId = :metricsSourceId', { metricsSourceId });
      }

      queryBuilder.orderBy('preset.createdAt', 'DESC');

      const allData = await queryBuilder.getMany();

      // Filter the results based on preset type and test run
      let filteredData = allData;
      if (currentTestRunId) {
        // Show generic presets and specific presets created for this test run
        filteredData = allData.filter(preset =>
          preset.presetType === 'generic' ||
          (preset.presetType === 'specific' && preset.createdForTestRunId === currentTestRunId)
        );
      } else {
        // If no currentTestRunId, only show generic presets to avoid confusion
        filteredData = allData.filter(preset => preset.presetType === 'generic');
      }

      // For non-admin users, filter out global presets that reference test runs from other organizations
      if (orgIds !== null) {
        const accessCheckedData: CompareFilterPreset[] = [];
        for (const preset of filteredData) {
          // User's own presets are always visible
          if (preset.createdBy === userId) {
            accessCheckedData.push(preset);
            continue;
          }

          // Global presets: check access to referenced test runs
          let hasAccess = true;

          if (preset.baselineTestRunId) {
            hasAccess = await this.validateTestRunAccess(preset.baselineTestRunId, orgIds);
          }

          if (hasAccess && preset.createdForTestRunId) {
            hasAccess = await this.validateTestRunAccess(preset.createdForTestRunId, orgIds);
          }

          if (hasAccess) {
            accessCheckedData.push(preset);
          }
        }
        filteredData = accessCheckedData;
      }

      // For each preset that has baseline_test_run_id, fetch test run data
      const enrichedData = await Promise.all(
        filteredData.map(async (preset) => {
          let testRunData = null;

          // Fetch test run data if baseline_test_run_id exists
          if (preset.baselineTestRunId) {
            try {
              testRunData = await withRequestEm(this.testRunRepo).findOne({
                where: { testRunId: preset.baselineTestRunId },
                select: ['applicationRelease', 'annotations']
              });
            } catch (error) {
              this.logger.warn(`Failed to fetch test run data for ${preset.baselineTestRunId}:`, error);
            }
          }

          return this.mapToDto(preset, preset.applicationDashboard || null, testRunData);
        })
      );

      return enrichedData;
    } catch (error) {
      this.logger.error('Failed to fetch compare presets:', error);
      throw new Error(`Failed to fetch compare presets: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  async findOne(
    id: string,
    userId: string,
    roles: string[] = [],
  ): Promise<ComparePresetResponseDto> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    this.logger.log(`Fetching compare preset: ${id}${orgIds === null ? ' (admin)' : ''}`);

    try {
      const preset = await withRequestEm(this.comparePresetRepo)
        .createQueryBuilder('preset')
        .leftJoinAndSelect('preset.applicationDashboard', 'dashboard')
        .where('preset.id = :id', { id })
        .andWhere('(preset.createdBy = :userId OR preset.isGlobal = :isGlobal)', {
          userId,
          isGlobal: true
        })
        .getOne();

      if (!preset) {
        throw new NotFoundException(`Compare preset with ID ${id} not found`);
      }

      // For non-admin users accessing global presets, verify organization access to referenced test runs
      if (orgIds !== null && preset.createdBy !== userId) {
        if (preset.baselineTestRunId) {
          const hasAccess = await this.validateTestRunAccess(preset.baselineTestRunId, orgIds);
          if (!hasAccess) {
            throw new NotFoundException(`Compare preset with ID ${id} not found`);
          }
        }

        if (preset.createdForTestRunId) {
          const hasAccess = await this.validateTestRunAccess(preset.createdForTestRunId, orgIds);
          if (!hasAccess) {
            throw new NotFoundException(`Compare preset with ID ${id} not found`);
          }
        }
      }

      // Fetch test run data if baseline_test_run_id exists
      let testRunData = null;
      if (preset.baselineTestRunId) {
        try {
          testRunData = await withRequestEm(this.testRunRepo).findOne({
            where: { testRunId: preset.baselineTestRunId },
            select: ['applicationRelease', 'annotations']
          });
        } catch (error) {
          this.logger.warn(`Failed to fetch test run data for ${preset.baselineTestRunId}:`, error);
        }
      }

      return this.mapToDto(preset, preset.applicationDashboard || null, testRunData);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch compare preset ${id}:`, error);
      throw new Error(`Failed to fetch compare preset: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  async update(
    id: string,
    updateComparePresetDto: UpdateComparePresetDto,
    userId: string,
    roles: string[] = [],
  ): Promise<ComparePresetResponseDto> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    this.logger.log(`Updating compare preset: ${id}${orgIds === null ? ' (admin)' : ''}`);

    try {
      // First check if user owns this preset
      const existing = await this.findOne(id, userId, roles);
      if (existing.created_by !== userId) {
        throw new ForbiddenException('You can only update your own presets');
      }

      // Phase 5a: capture pre-update entity snapshot for the audit diff. The
      // service-layer `findOne` returns a DTO (which loses the constructor
      // prototype that `AuditService.dispatch` consults to resolve
      // auditableFields); fetch the raw entity directly for the diff input.
      const before = await withRequestEm(this.comparePresetRepo).findOne({ where: { id } });

      // Validate access to new test run references for non-admin users
      if (orgIds !== null) {
        if (updateComparePresetDto.baseline_test_run_id !== undefined && updateComparePresetDto.baseline_test_run_id) {
          const hasAccess = await this.validateTestRunAccess(
            updateComparePresetDto.baseline_test_run_id,
            orgIds,
          );
          if (!hasAccess) {
            throw new ResourceNotFoundException('TestRun', updateComparePresetDto.baseline_test_run_id);
          }
        }
      }

      // Build update object mapping DTO fields to entity fields
      const updateData: Partial<CompareFilterPreset> = {};
      if (updateComparePresetDto.name !== undefined) updateData.name = updateComparePresetDto.name;
      if (updateComparePresetDto.description !== undefined) updateData.description = updateComparePresetDto.description;
      if (updateComparePresetDto.preset_type !== undefined) updateData.presetType = updateComparePresetDto.preset_type;
      if (updateComparePresetDto.series_search_text !== undefined) updateData.seriesSearchText = updateComparePresetDto.series_search_text;
      if (updateComparePresetDto.show_percentiles !== undefined) updateData.showPercentiles = updateComparePresetDto.show_percentiles;
      if (updateComparePresetDto.application_dashboard_id !== undefined) updateData.applicationDashboardId = updateComparePresetDto.application_dashboard_id;
      if (updateComparePresetDto.metrics_source_id !== undefined) updateData.metricsSourceId = updateComparePresetDto.metrics_source_id;
      if (updateComparePresetDto.source !== undefined) updateData.source = updateComparePresetDto.source;
      if (updateComparePresetDto.dashboard_label !== undefined) updateData.dashboardLabel = updateComparePresetDto.dashboard_label;
      if (updateComparePresetDto.panel_id !== undefined) updateData.panelId = updateComparePresetDto.panel_id;
      if (updateComparePresetDto.panel_title !== undefined) updateData.panelTitle = updateComparePresetDto.panel_title;
      if (updateComparePresetDto.baseline_test_run_id !== undefined) updateData.baselineTestRunId = updateComparePresetDto.baseline_test_run_id;
      if (updateComparePresetDto.series_config !== undefined) updateData.seriesConfig = updateComparePresetDto.series_config as unknown as Record<string, unknown>[];
      if (updateComparePresetDto.display_config !== undefined) updateData.displayConfig = updateComparePresetDto.display_config as unknown as Record<string, unknown>;
      if (updateComparePresetDto.is_global !== undefined) updateData.isGlobal = updateComparePresetDto.is_global;

      await withRequestEm(this.comparePresetRepo).update(
        { id, createdBy: userId },
        updateData as unknown as Parameters<typeof this.comparePresetRepo.update>[1]
      );

      // Fetch updated preset
      const updated = await withRequestEm(this.comparePresetRepo).findOne({
        where: { id },
        relations: ['applicationDashboard']
      });

      if (!updated) {
        throw new Error('Failed to fetch updated preset');
      }

      // Phase 5a: emit UPDATE audit row with the diff. `before` is loaded
      // above; `updated` is the persisted entity. organizationIdOverride
      // bridges the camelCase property / snake_case column mismatch.
      if (before) {
        this.auditService.logUpdate(
          before as unknown as OwnedResource,
          updated as unknown as OwnedResource,
          { organizationIdOverride: before.organizationId ?? updated.organizationId },
        );
      }

      // Fetch test run data if needed
      let testRunData = null;
      if (updated.baselineTestRunId) {
        try {
          testRunData = await withRequestEm(this.testRunRepo).findOne({
            where: { testRunId: updated.baselineTestRunId },
            select: ['applicationRelease', 'annotations']
          });
        } catch (error) {
          this.logger.warn(`Failed to fetch test run data for ${updated.baselineTestRunId}:`, error);
        }
      }

      return this.mapToDto(updated, updated.applicationDashboard || null, testRunData);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to update compare preset ${id}:`, error);
      throw new Error(`Failed to update compare preset: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  async remove(
    id: string,
    userId: string,
    roles: string[] = [],
  ): Promise<void> {
    this.logger.log(`Deleting compare preset: ${id}`);

    try {
      // First check if user owns this preset (organization filtering handled in findOne)
      const existing = await this.findOne(id, userId, roles);
      if (existing.created_by !== userId) {
        throw new ForbiddenException('You can only delete your own presets');
      }

      // Phase 5a: load the raw entity for the audit diff (`existing` is a DTO
      // and would lose the constructor prototype). Log DELETE before the
      // remove so the diff captures the pre-delete state.
      const entity = await withRequestEm(this.comparePresetRepo).findOne({ where: { id } });
      if (entity) {
        this.auditService.logDelete(entity as unknown as OwnedResource, {
          organizationIdOverride: entity.organizationId,
        });
      }

      await withRequestEm(this.comparePresetRepo).delete({
        id,
        createdBy: userId
      });

      this.logger.log(`Deleted compare preset: ${id}`);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete compare preset ${id}:`, error);
      throw new Error(`Failed to delete compare preset: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  private mapToDto(
    preset: CompareFilterPreset,
    dashboard: ApplicationDashboard | null,
    testRun: Pick<TestRunEntity, 'applicationRelease' | 'annotations'> | null
  ): ComparePresetResponseDto {
    return {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      preset_type: preset.presetType as PresetType,
      series_search_text: preset.seriesSearchText,
      show_percentiles: preset.showPercentiles,
      application_dashboard_id: preset.applicationDashboardId,
      metrics_source_id: preset.metricsSourceId,
      source: preset.source,
      panel_id: preset.panelId,
      panel_title: preset.panelTitle,
      baseline_test_run_id: preset.baselineTestRunId,
      baseline_application_release: testRun?.applicationRelease,
      baseline_annotations: testRun?.annotations,
      dashboard_label: preset.dashboardLabel || dashboard?.dashboardLabel,
      series_config: preset.seriesConfig as CompareSeriesConfig[] | undefined,
      display_config: preset.displayConfig as ComparePresetResponseDto['display_config'],
      is_global: preset.isGlobal,
      created_by: preset.createdBy || '',
      created_at: preset.createdAt.toISOString(),
      updated_at: preset.updatedAt.toISOString()
    };
  }
}
