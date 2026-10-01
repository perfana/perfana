import { Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { GraphPreset, SeriesConfig } from '@perfana/shared/entities';
import { OwnedResource } from '@perfana/shared';
import { CreateGraphPresetDto, SeriesConfigDto } from './dto/create-graph-preset.dto';
import { UpdateGraphPresetDto } from './dto/update-graph-preset.dto';
import { GraphPresetResponseDto } from './dto/graph-preset-response.dto';
import { TestRun as TestRunEntity } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
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
   * Tenant boundary for the by-id routes.
   *
   * `null` means global admin. Anything else is the caller's accessible organizations,
   * and a preset outside them answers 404 rather than 403 — a 403 would confirm that
   * the id exists, which is itself a cross-tenant disclosure.
   *
   * This exists because closing the leak in `findAll` alone was only half the job: a
   * global preset was still readable by id from any tenant, and `update`/`remove`
   * authorized on `userId` only. There is no RLS backstop on a default deploy
   * (`DB_ENABLE_RLS_ROLE` defaults to 'false').
   */
  private assertTenantAccess(
    preset: GraphPreset,
    accessibleOrgIds: string[] | null,
    id: string,
  ): void {
    if (accessibleOrgIds === null) return;
    if (!preset.organizationId || !accessibleOrgIds.includes(preset.organizationId)) {
      this.logger.warn(`Cross-tenant access refused for preset ${id}`);
      throw new NotFoundException(`Graph preset with ID ${id} not found`);
    }
  }

  /**
   * Create a new graph preset.
   *
   * @param createGraphPresetDto - The preset creation DTO
   * @param userId - The user ID for ownership tracking
   */
  async create(
    createGraphPresetDto: CreateGraphPresetDto,
    userId: string,
    accessibleOrgIds: string[] | null,
  ): Promise<GraphPresetResponseDto> {
    try {
      if (!createGraphPresetDto.seriesConfig || createGraphPresetDto.seriesConfig.length === 0) {
        throw new BadRequestException('Series configuration cannot be empty');
      }

      // A preset without a run has no SUT to inherit from. This used to fall through to
      // `findOne({ where: { testRunId: undefined } })`, which TypeORM turns into "any
      // test run" — so the preset was stamped with an arbitrary system's org and team.
      if (!createGraphPresetDto.testRunId) {
        throw new BadRequestException('testRunId is required: a preset is scoped to the system under test it was saved from');
      }

      // Inherit org/team from the parent test run's SUT — GraphPreset.organization_id
      // is NOT NULL, and the camelCase property key is mandatory (TypeORM drops
      // snake_case keys silently for camelCase-mapped columns).
      const testRun = await withRequestEm(this.testRunRepo).findOne({
        where: { testRunId: createGraphPresetDto.testRunId },
        relations: ['systemUnderTest'],
      });
      if (!testRun?.systemUnderTest) {
        throw new BadRequestException(`Test run not found: ${createGraphPresetDto.testRunId}`);
      }

      // The run id is caller-supplied and decides which tenant owns the preset, so it
      // has to be authorized before it is inherited. Test run ids are human-readable
      // and routinely pasted into CI logs and chat: without this, naming another
      // tenant's run writes a preset into their organization, and `isGlobal: true`
      // then puts attacker-chosen name/description/seriesConfig into their list.
      // Making testRunId required turned this from one path into the only path.
      if (
        accessibleOrgIds !== null &&
        !accessibleOrgIds.includes(testRun.systemUnderTest.organization_id)
      ) {
        this.logger.warn(`Cross-tenant preset create refused for run ${createGraphPresetDto.testRunId}`);
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

      const savedPreset = await withRequestEm(this.graphPresetRepo).save(preset);

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
  async findAll(
    userId: string,
    isAdmin: boolean,
    testRunId: string | undefined,
    // Required on purpose: as an optional parameter a forgotten argument silently
    // restored the cross-tenant behaviour with no type error and no log line.
    accessibleOrgIds: string[] | null,
  ): Promise<GraphPresetResponseDto[]> {
    try {
      // A non-admin with no accessible organization can see nothing. Returning early
      // also keeps `IN (:...orgs)` away from an empty array, which TypeORM renders as
      // `IN ()` — a syntax error, not an empty result.
      if (!isAdmin && accessibleOrgIds !== null && accessibleOrgIds.length === 0) {
        return [];
      }
      // Resolve SUT context from the provided testRunId
      let sutContext: { systemUnderTestId: string; testEnvironment: string } | null = null;
      if (testRunId) {
        const testRun = await withRequestEm(this.testRunRepo).findOne({
          where: { testRunId },
          select: ['systemUnderTestId', 'testEnvironment'],
        });
        if (testRun) {
          sutContext = {
            systemUnderTestId: testRun.systemUnderTestId,
            testEnvironment: testRun.testEnvironment,
          };
        }
      }

      const queryBuilder = withRequestEm(this.graphPresetRepo)
        .createQueryBuilder('preset');

      // Global admins see all presets, regular users see only their own + global
      if (!isAdmin) {
        queryBuilder.where('(preset.userId = :userId OR preset.isGlobal = :isGlobal)', {
          userId,
          isGlobal: true
        });

        // Tenant boundary, independent of the SUT scoping below. The scoping block only
        // runs when a testRunId is supplied, so without this a bare
        // `GET /api/graph-presets` answered with every `is_global` preset in the
        // database — other tenants' preset names, descriptions, dashboard labels and
        // metric names. RLS would have caught it, but `DB_ENABLE_RLS_ROLE` defaults to
        // 'false' and is set nowhere in the shipped compose files, so on a default
        // deploy there was no backstop at all.
        if (accessibleOrgIds !== null) {
          queryBuilder.andWhere('preset.organizationId IN (:...accessibleOrgIds)', {
            accessibleOrgIds,
          });
        }
      }

      // Scope presets to the system under test the caller is looking at.
      //
      // "Global" means every test run OF THIS SYSTEM, not every system. The previous
      // `preset.testRunId IS NULL` arm meant every global preset showed on every SUT —
      // and since the save dialog defaults to Global with no run id, that was all of
      // them. A preset's series point at `application_dashboards` rows, which belong to
      // one SUT and environment, so a preset from another system draws nothing anyway.
      //
      // The subselect is uncorrelated on purpose. As a correlated EXISTS it was
      // re-executed per preset row, and `application_dashboards` carries an RLS SELECT
      // policy backed by a plpgsql function — so the function ran once per
      // (preset x dashboard) pair. Uncorrelated, Postgres hashes it once.
      //
      // The owning SUT is derived from the preset's own first series rather than stored,
      // so it survives the test run it was saved from being pruned — `test_run_id` has
      // no foreign key and is left dangling by a delete. `ad.id` is compared as text on
      // purpose: a legacy row whose dashboardId is not a uuid would make a `::uuid` cast
      // throw for the whole query instead of just not matching.
      if (sutContext) {
        queryBuilder.andWhere(new Brackets(qb => {
          qb.where('preset.isGlobal = false AND preset.testRunId = :testRunId', { testRunId })
            .orWhere(
              `preset.isGlobal = true AND preset.series_config -> 0 ->> 'dashboardId' IN (
                 SELECT ad.id::text FROM application_dashboards ad
                 WHERE ad.system_under_test_id = :sutId
                   AND ad.test_environment = :env
               )`,
              { sutId: sutContext.systemUnderTestId, env: sutContext.testEnvironment },
            );
        }));
      } else if (testRunId) {
        // Fallback: if testRunId provided but SUT context not found, filter by exact test run
        queryBuilder.andWhere('preset.testRunId = :testRunId', { testRunId });
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
  async findOne(
    id: string,
    userId: string,
    isAdmin: boolean,
    accessibleOrgIds: string[] | null,
  ): Promise<GraphPresetResponseDto> {
    try {
      // First fetch the preset without filtering to properly handle 404 vs 403
      const preset = await withRequestEm(this.graphPresetRepo).findOne({
        where: { id }
      });

      if (!preset) {
        throw new NotFoundException(`Graph preset with ID ${id} not found`);
      }

      // Global admins can access any preset
      if (isAdmin) {
        return this.mapToDto(preset);
      }

      this.assertTenantAccess(preset, accessibleOrgIds, id);

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
   * Update an existing graph preset.
   *
   * @param id - The preset ID
   * @param updateGraphPresetDto - The fields to change
   * @param userId - The user ID for authorization
   * @param isAdmin - Whether the caller is a global admin (resolved by controller)
   *
   * Authorization mirrors `remove`: global admins may update any preset, everyone else
   * only their own. Being global does not make a preset editable by others — it widens
   * who can *see* it, not who owns it.
   *
   * `testRunId` is not updatable (see UpdateGraphPresetDto), so a preset can never
   * change which system it belongs to, and `organizationId`/`teamId` stay consistent
   * with the run it was created from.
   */
  async update(
    id: string,
    updateGraphPresetDto: UpdateGraphPresetDto,
    userId: string,
    isAdmin: boolean,
    accessibleOrgIds: string[] | null,
  ): Promise<GraphPresetResponseDto> {
    try {
      const preset = await withRequestEm(this.graphPresetRepo).findOne({ where: { id } });

      if (!preset) {
        throw new NotFoundException(`Graph preset with ID ${id} not found`);
      }

      if (!isAdmin) {
        this.assertTenantAccess(preset, accessibleOrgIds, id);
        if (preset.userId !== userId) {
          this.logger.warn(`Update permission denied for user ${userId} to preset ${id} owned by ${preset.userId}`);
          throw new ForbiddenException('You can only update your own presets');
        }
      }

      if (updateGraphPresetDto.seriesConfig && updateGraphPresetDto.seriesConfig.length === 0) {
        throw new BadRequestException('Series configuration cannot be empty');
      }

      // `PartialType` stamps `@IsOptional()` on every property, and class-validator's
      // `@IsOptional()` skips `null` as well as `undefined`. So `{"name": null}` passes
      // the pipe, and keying the apply block on `!== undefined` would write NULL into a
      // NOT NULL column — a 500 carrying the raw Postgres error text. Reject explicit
      // nulls on the non-nullable columns instead.
      for (const field of ['name', 'seriesConfig', 'isGlobal'] as const) {
        if (updateGraphPresetDto[field] === null) {
          throw new BadRequestException(`${field} cannot be null`);
        }
      }

      // `isGlobal: false` scopes a preset to its own run, but findAll's non-global arm
      // is `preset.testRunId = :testRunId`. A legacy preset created by the old save
      // dialog has test_run_id NULL, so narrowing it would match no arm on any run: the
      // preset vanishes from every list, and testRunId is deliberately not updatable, so
      // the user could never undo it through the API.
      if (updateGraphPresetDto.isGlobal === false && !preset.testRunId) {
        throw new BadRequestException(
          'This preset has no test run to scope to, so it cannot be made run-specific. Save it again from a test run instead.',
        );
      }

      const before = { ...preset };

      if (updateGraphPresetDto.name !== undefined) preset.name = updateGraphPresetDto.name;
      // description is nullable, so an explicit null legitimately clears it.
      if (updateGraphPresetDto.description !== undefined) preset.description = updateGraphPresetDto.description;
      if (updateGraphPresetDto.seriesConfig !== undefined) {
        preset.seriesConfig = updateGraphPresetDto.seriesConfig as unknown as SeriesConfig[];
      }
      if (updateGraphPresetDto.chartOptions !== undefined) preset.chartOptions = updateGraphPresetDto.chartOptions;
      if (updateGraphPresetDto.isGlobal !== undefined) preset.isGlobal = updateGraphPresetDto.isGlobal;
      preset.updatedBy = userId;

      const saved = await withRequestEm(this.graphPresetRepo).save(preset);

      // Phase 5a: same camelCase/snake_case bridge as create and delete.
      this.auditService.logUpdate(before as unknown as OwnedResource, saved as unknown as OwnedResource, {
        organizationIdOverride: saved.organizationId,
      });

      this.logger.debug(`Updated graph preset ${id} for user ${userId}`);
      return this.mapToDto(saved);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(`Failed to update graph preset ${id}:`, error);
      throw new Error(`Failed to update graph preset: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`);
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
  async remove(
    id: string,
    userId: string,
    isAdmin: boolean,
    accessibleOrgIds: string[] | null,
  ): Promise<void> {
    try {
      // First check if preset exists
      const preset = await withRequestEm(this.graphPresetRepo).findOne({
        where: { id }
      });

      if (!preset) {
        throw new NotFoundException(`Graph preset with ID ${id} not found`);
      }

      // Global admins can delete any preset
      if (!isAdmin) {
        this.assertTenantAccess(preset, accessibleOrgIds, id);
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

      await withRequestEm(this.graphPresetRepo).delete({ id });

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
