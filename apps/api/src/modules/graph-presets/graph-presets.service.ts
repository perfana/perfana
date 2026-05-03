import { Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { GraphPreset, SeriesConfig } from '@perfana/shared/entities';
import { OwnedResource } from '@perfana/shared';
import { CreateGraphPresetDto, SeriesConfigDto } from './dto/create-graph-preset.dto';
import { GraphPresetResponseDto } from './dto/graph-preset-response.dto';
import { TestRun as TestRunEntity } from '../../entities';
import { AuditService } from '../audit/audit.service';

/**
 * Service responsible for managing graph presets.
 *
 * Authorization:
 * - All read/delete methods accept an `isAdmin` boolean resolved by the controller
 * - GraphPreset entity has `userId` for ownership and `isGlobal` for shared presets
 * - Global admins bypass all authorization checks
 * - Regular users can only access their own presets and global presets
 * - Regular users can only delete their own presets
 */
@Injectable()
export class GraphPresetsService {
  private readonly logger = new Logger(GraphPresetsService.name);

  constructor(
    @InjectRepository(GraphPreset)
    private graphPresetRepo: Repository<GraphPreset>,
    @InjectRepository(TestRunEntity)
    private testRunRepo: Repository<TestRunEntity>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create a new graph preset.
   *
   * @param createGraphPresetDto - The preset creation DTO
   * @param userId - The user ID for ownership tracking
   */
  async create(
    createGraphPresetDto: CreateGraphPresetDto,
    userId: string,
  ): Promise<GraphPresetResponseDto> {
    try {
      if (!createGraphPresetDto.seriesConfig || createGraphPresetDto.seriesConfig.length === 0) {
        throw new BadRequestException('Series configuration cannot be empty');
      }

      // Inherit org/team from the parent test run's SUT — GraphPreset.organization_id
      // is NOT NULL, and the camelCase property key is mandatory (TypeORM drops
      // snake_case keys silently for camelCase-mapped columns).
      const testRun = await this.testRunRepo.findOne({
        where: { testRunId: createGraphPresetDto.testRunId },
        relations: ['systemUnderTest'],
      });
      if (!testRun?.systemUnderTest) {
        throw new BadRequestException(`Test run not found: ${createGraphPresetDto.testRunId}`);
      }

      const preset = this.graphPresetRepo.create({
        name: createGraphPresetDto.name,
        description: createGraphPresetDto.description,
        testRunId: createGraphPresetDto.testRunId,
        userId,
        createdBy: userId,
        seriesConfig: createGraphPresetDto.seriesConfig as unknown as SeriesConfig[],
        chartOptions: createGraphPresetDto.chartOptions,
        isGlobal: createGraphPresetDto.isGlobal || false,
        organizationId: testRun.systemUnderTest.organization_id,
        teamId: testRun.systemUnderTest.team_id,
      });

      const savedPreset = await this.graphPresetRepo.save(preset);

      // Phase 5a: GraphPreset.organization_id maps to camelCase property
      // organizationId, so AuditService.dispatch cannot read it off ref directly —
      // pass organizationIdOverride so the audit row is org-scoped.
      this.auditService.logCreate(savedPreset as unknown as OwnedResource, {
        organizationIdOverride: savedPreset.organizationId,
      });

      this.logger.debug(`Created graph preset ${savedPreset.id} for user ${userId}`);
      return this.mapToDto(savedPreset);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Failed to create graph preset:', error);
      throw new Error(`Failed to create graph preset: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Find all graph presets accessible to the user.
   *
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved by controller)
   * @param testRunId - Optional test run ID to filter presets
   *
   * Authorization:
   * - Global admins see all presets
   * - Regular users see their own presets and global presets
   */
  async findAll(userId: string, isAdmin: boolean, testRunId?: string): Promise<GraphPresetResponseDto[]> {
    try {
      // Resolve SUT context from the provided testRunId
      let sutContext: { systemUnderTestId: string; testEnvironment: string; workload: string } | null = null;
      if (testRunId) {
        const testRun = await this.testRunRepo.findOne({
          where: { testRunId },
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

      const queryBuilder = this.graphPresetRepo
        .createQueryBuilder('preset');

      // Global admins see all presets, regular users see only their own + global
      if (!isAdmin) {
        queryBuilder.where('(preset.userId = :userId OR preset.isGlobal = :isGlobal)', {
          userId,
          isGlobal: true
        });
      }

      // Scope presets to the same SUT/environment/workload
      if (sutContext) {
        queryBuilder
          .leftJoin('test_runs', 'tr', 'tr.test_run_id = preset.testRunId')
          .andWhere(new Brackets(qb => {
            qb.where(
              'tr.system_under_test_id = :sutId AND tr.test_environment = :env AND tr.workload = :workload',
              { sutId: sutContext.systemUnderTestId, env: sutContext.testEnvironment, workload: sutContext.workload }
            )
            .orWhere('preset.testRunId IS NULL');
          }));
      } else if (testRunId) {
        // Fallback: if testRunId provided but SUT context not found, filter by exact test run
        queryBuilder.andWhere('(preset.testRunId = :testRunId OR preset.testRunId IS NULL)', {
          testRunId
        });
      }

      queryBuilder.orderBy('preset.createdAt', 'DESC');

      const presets = await queryBuilder.getMany();
      this.logger.debug(`Found ${presets.length} graph presets for user ${userId}`);

      return presets.map(preset => this.mapToDto(preset));
    } catch (error) {
      this.logger.error('Failed to fetch graph presets:', error);
      throw new Error(`Failed to fetch graph presets: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Find a single graph preset by ID.
   *
   * @param id - The preset ID
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved by controller)
   *
   * Authorization:
   * - Global admins can access any preset
   * - Regular users can access their own presets or global presets
   */
  async findOne(id: string, userId: string, isAdmin: boolean): Promise<GraphPresetResponseDto> {
    try {
      // First fetch the preset without filtering to properly handle 404 vs 403
      const preset = await this.graphPresetRepo.findOne({
        where: { id }
      });

      if (!preset) {
        throw new NotFoundException(`Graph preset with ID ${id} not found`);
      }

      // Global admins can access any preset
      if (isAdmin) {
        return this.mapToDto(preset);
      }

      // Regular users can only access their own presets or global presets
      if (preset.userId !== userId && !preset.isGlobal) {
        this.logger.warn(`Access denied for user ${userId} to preset ${id} owned by ${preset.userId}`);
        throw new ForbiddenException('You do not have permission to access this preset');
      }

      return this.mapToDto(preset);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Failed to fetch graph preset ${id}:`, error);
      throw new Error(`Failed to fetch graph preset: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a graph preset.
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
      const preset = await this.graphPresetRepo.findOne({
        where: { id }
      });

      if (!preset) {
        throw new NotFoundException(`Graph preset with ID ${id} not found`);
      }

      // Global admins can delete any preset
      if (!isAdmin) {
        // Regular users can only delete their own presets
        if (preset.userId !== userId) {
          this.logger.warn(`Delete permission denied for user ${userId} to preset ${id} owned by ${preset.userId}`);
          throw new ForbiddenException('You can only delete your own presets');
        }
      }

      // Phase 5a: log DELETE before the row is removed so the diff captures
      // the pre-delete state. organizationIdOverride bridges the camelCase
      // property / snake_case column mismatch.
      this.auditService.logDelete(preset as unknown as OwnedResource, {
        organizationIdOverride: preset.organizationId,
      });

      await this.graphPresetRepo.delete({ id });

      this.logger.log(`Deleted graph preset: ${id} (by user: ${userId}, isAdmin: ${isAdmin})`);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete graph preset ${id}:`, error);
      throw new Error(`Failed to delete graph preset: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
    }
  }

  private mapToDto(preset: GraphPreset): GraphPresetResponseDto {
    return {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      testRunId: preset.testRunId,
      userId: preset.userId,
      seriesConfig: preset.seriesConfig as unknown as SeriesConfigDto[],
      chartOptions: preset.chartOptions,
      isGlobal: preset.isGlobal,
      createdAt: preset.createdAt.toISOString(),
      updatedAt: preset.updatedAt.toISOString()
    };
  }
}
