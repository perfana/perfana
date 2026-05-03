import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { TrendsFilterPreset, ApplicationDashboard, TestRun as TestRunEntity } from '../../entities';
import { OwnedResource } from '@perfana/shared';
import { CreateTrendsPresetDto } from './dto/create-trends-preset.dto';
import { TrendsPresetResponseDto } from './dto/trends-preset-response.dto';
import { AuditService } from '../audit/audit.service';

/**
 * Service responsible for managing trends filter presets.
 *
 * Authorization:
 * - All read/delete methods accept an `isAdmin` boolean resolved by the controller
 * - TrendsFilterPreset entity has `createdBy` for ownership and `isGlobal` for shared presets
 * - Global admins bypass all authorization checks
 * - Regular users can only access their own presets and global presets
 * - Regular users can only delete their own presets
 */
@Injectable()
export class TrendsPresetsService {
  private readonly logger = new Logger(TrendsPresetsService.name);

  constructor(
    @InjectRepository(TrendsFilterPreset)
    private trendsPresetRepo: Repository<TrendsFilterPreset>,
    @InjectRepository(TestRunEntity)
    private testRunRepo: Repository<TestRunEntity>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create a new trends preset.
   *
   * @param createTrendsPresetDto - The preset creation DTO
   * @param userId - The user ID for ownership tracking
   */
  async create(
    createTrendsPresetDto: CreateTrendsPresetDto,
    userId: string,
  ): Promise<TrendsPresetResponseDto> {
    try {
      // Inherit org/team from the parent test run's SUT — TrendsFilterPreset.
      // organization_id is NOT NULL and the camelCase property key is required.
      const testRun = await this.testRunRepo.findOne({
        where: { testRunId: createTrendsPresetDto.created_for_test_run_id },
        relations: ['systemUnderTest'],
      });
      if (!testRun?.systemUnderTest) {
        throw new BadRequestException(`Test run not found: ${createTrendsPresetDto.created_for_test_run_id}`);
      }

      const preset = this.trendsPresetRepo.create({
        name: createTrendsPresetDto.name,
        description: createTrendsPresetDto.description,
        presetType: createTrendsPresetDto.preset_type,
        applicationDashboardId: createTrendsPresetDto.application_dashboard_id,
        metricsSourceId: createTrendsPresetDto.metrics_source_id,
        panelId: createTrendsPresetDto.panel_id,
        panelTitle: createTrendsPresetDto.panel_title,
        evaluateType: createTrendsPresetDto.evaluate_type,
        source: createTrendsPresetDto.source,
        dashboardLabel: createTrendsPresetDto.dashboard_label,
        seriesConfig: createTrendsPresetDto.series_config,
        createdForTestRunId: createTrendsPresetDto.created_for_test_run_id,
        isGlobal: createTrendsPresetDto.is_global || false,
        createdBy: userId,
        organizationId: testRun.systemUnderTest.organization_id,
        teamId: testRun.systemUnderTest.team_id,
      });

      const savedPreset = await this.trendsPresetRepo.save(preset);

      // Phase 5a: TrendsFilterPreset.organization_id maps to camelCase property
      // organizationId, so AuditService.dispatch cannot read it off ref directly —
      // pass organizationIdOverride so the audit row is org-scoped.
      this.auditService.logCreate(savedPreset as unknown as OwnedResource, {
        organizationIdOverride: savedPreset.organizationId,
      });

      this.logger.debug(`Created trends preset ${savedPreset.id} for user ${userId}`);
      return this.mapToDto(savedPreset, null);
    } catch (error) {
      this.logger.error('Failed to create trends preset:', error);
      throw new Error(`Failed to create trends preset: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Find all trends presets accessible to the user.
   *
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved by controller)
   * @param currentTestRunId - Optional test run ID to filter specific presets
   *
   * Authorization:
   * - Global admins see all presets
   * - Regular users see their own presets and global presets
   */
  async findAll(userId: string, isAdmin: boolean, currentTestRunId?: string, metricsSourceId?: string): Promise<TrendsPresetResponseDto[]> {
    try {
      // Resolve SUT context from the provided testRunId
      let sutContext: { systemUnderTestId: string; testEnvironment: string; workload: string } | null = null;
      if (currentTestRunId) {
        const testRun = await this.testRunRepo.findOne({
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

      const queryBuilder = this.trendsPresetRepo
        .createQueryBuilder('preset')
        .leftJoinAndSelect('preset.applicationDashboard', 'dashboard');

      // Global admins see all presets, regular users see only their own + global
      if (!isAdmin) {
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
        // Show generic presets and specific presets for this test run only
        filteredData = allData.filter(preset =>
          preset.presetType === 'generic' ||
          (preset.presetType === 'specific' && preset.createdForTestRunId === currentTestRunId)
        );
      } else {
        // If no currentTestRunId, only show generic presets to avoid confusion
        filteredData = allData.filter(preset => preset.presetType === 'generic');
      }

      this.logger.debug(`Found ${filteredData.length} trends presets for user ${userId}`);

      return filteredData.map(preset =>
        this.mapToDto(preset, preset.applicationDashboard || null)
      );
    } catch (error) {
      this.logger.error('Failed to fetch trends presets:', error);
      throw new Error(`Failed to fetch trends presets: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Find a single trends preset by ID.
   *
   * @param id - The preset ID
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved by controller)
   *
   * Authorization:
   * - Global admins can access any preset
   * - Regular users can access their own presets or global presets
   */
  async findOne(id: string, userId: string, isAdmin: boolean): Promise<TrendsPresetResponseDto> {
    try {
      // First fetch the preset without filtering to properly handle 404 vs 403
      const preset = await this.trendsPresetRepo
        .createQueryBuilder('preset')
        .leftJoinAndSelect('preset.applicationDashboard', 'dashboard')
        .where('preset.id = :id', { id })
        .getOne();

      if (!preset) {
        throw new NotFoundException(`Trends preset with ID ${id} not found`);
      }

      // Global admins can access any preset
      if (isAdmin) {
        return this.mapToDto(preset, preset.applicationDashboard || null);
      }

      // Regular users can only access their own presets or global presets
      if (preset.createdBy !== userId && !preset.isGlobal) {
        this.logger.warn(`Access denied for user ${userId} to preset ${id} owned by ${preset.createdBy}`);
        throw new ForbiddenException('You do not have permission to access this preset');
      }

      return this.mapToDto(preset, preset.applicationDashboard || null);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Failed to fetch trends preset ${id}:`, error);
      throw new Error(`Failed to fetch trends preset: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a trends preset.
   *
   * @param id - The preset ID
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved by controller)
   *
   * Authorization:
   * - Global admins can delete any preset
   * - Regular users can only delete their own presets
   */
  async remove(id: string, userId: string, isAdmin: boolean): Promise<void> {
    try {
      // First check if preset exists
      const preset = await this.trendsPresetRepo.findOne({
        where: { id }
      });

      if (!preset) {
        throw new NotFoundException(`Trends preset with ID ${id} not found`);
      }

      // Global admins can delete any preset
      if (!isAdmin) {
        // Regular users can only delete their own presets
        if (preset.createdBy !== userId) {
          this.logger.warn(`Delete permission denied for user ${userId} to preset ${id} owned by ${preset.createdBy}`);
          throw new ForbiddenException('You can only delete your own presets');
        }
      }

      // Phase 5a: log DELETE before the row is removed so the diff captures
      // the pre-delete state. organizationIdOverride bridges the camelCase
      // property / snake_case column mismatch.
      this.auditService.logDelete(preset as unknown as OwnedResource, {
        organizationIdOverride: preset.organizationId,
      });

      await this.trendsPresetRepo.delete({ id });

      this.logger.log(`Deleted trends preset: ${id} (by user: ${userId}, isAdmin: ${isAdmin})`);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete trends preset ${id}:`, error);
      throw new Error(`Failed to delete trends preset: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  private mapToDto(preset: TrendsFilterPreset, dashboard: ApplicationDashboard | null): TrendsPresetResponseDto {
    return {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      preset_type: preset.presetType,
      application_dashboard_id: preset.applicationDashboardId,
      metrics_source_id: preset.metricsSourceId,
      panel_id: preset.panelId,
      panel_title: preset.panelTitle,
      evaluate_type: preset.evaluateType,
      source: preset.source,
      created_for_test_run_id: preset.createdForTestRunId || '',
      // Use stored dashboard_label first, fall back to relationship dashboard label
      dashboard_label: preset.dashboardLabel || dashboard?.dashboardLabel || undefined,
      series_config: preset.seriesConfig,
      is_global: preset.isGlobal,
      created_by: preset.createdBy || '',
      created_at: preset.createdAt.toISOString(),
      updated_at: preset.updatedAt.toISOString()
    };
  }
}
