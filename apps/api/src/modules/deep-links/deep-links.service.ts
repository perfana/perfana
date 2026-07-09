import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeepLinksRepository } from './deep-links.repository';
import { DeepLink } from '@perfana/shared/entities';
import { ResolvedDeepLink } from './entities/deep-link.entity';
import { GenericDeepLink } from '@perfana/shared/entities';
import { CreateDeepLinkDto } from './dto/create-deep-link.dto';
import { UpdateDeepLinkDto } from './dto/update-deep-link.dto';
import { CreateGenericDeepLinkDto } from './dto/create-generic-deep-link.dto';
import { CopyDeepLinksDto } from './dto/copy-deep-links.dto';
import { TestRunConfiguration, TestRun as TestRunEntity, SystemUnderTest, Profile } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { ResourceNotFoundException } from '../../common/exceptions/business.exception';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';
import type { OwnedResource } from '@perfana/shared';

/**
 * Test run data used for deep link variable resolution.
 * Properties use snake_case to match raw SQL query result column names.
 */
interface TestRunVariableData {
  id?: string;
  test_run_id?: string;
  system_under_test_id?: string;
  system_name?: string;
  systems_under_test?: { name?: string };
  test_environment?: string;
  workload?: string;
  ci_build_results_url?: string;
  start_time?: string | Date;
  end_time?: string | Date;
  completed?: boolean;
  tags?: string[];
}

@Injectable()
export class DeepLinksService {
  private readonly logger = new Logger(DeepLinksService.name);

  constructor(
    private readonly repository: DeepLinksRepository,
    @InjectRepository(TestRunConfiguration)
    private readonly testRunConfigRepo: Repository<TestRunConfiguration>,
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    @InjectRepository(SystemUnderTest)
    private readonly systemRepo: Repository<SystemUnderTest>,
    @InjectRepository(Profile)
    private readonly profileRepo: Repository<Profile>,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Validate that a user has access to a system under test.
   * Returns true if access is granted, false otherwise.
   */
  private async validateSystemAccess(
    systemUnderTestId: string,
    userId: string,
    roles: string[],
  ): Promise<boolean> {
    const system = await withRequestEm(this.systemRepo).findOne({ where: { id: systemUnderTestId } });
    if (!system) {
      return false;
    }

    const result = await this.authzService.canAccessResource(userId, roles, {
      organization_id: system.organization_id,
      created_by: system.created_by ?? '',
    } as OwnedResource);

    return result.allowed;
  }

  /**
   * Find deep links by system/environment/workload with organization filtering
   *
   * @param systemUnderTestId - System under test UUID
   * @param testEnvironment - Test environment name
   * @param workload - Workload name
   * @param userId - User ID for authorization checks
   * @param roles - User roles for authorization checks
   */
  async findBySystemEnvWorkload(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<DeepLink[]> {
    // Validate access if authorization context provided
    if (userId !== '' || roles.length > 0) {
      const hasAccess = await this.validateSystemAccess(systemUnderTestId, userId, roles);
      if (!hasAccess) {
        this.logger.debug(`User denied access to deep links for system ${systemUnderTestId}`);
        return [];
      }
    }

    return this.repository.findBySystemEnvWorkload(
      systemUnderTestId,
      testEnvironment,
      workload,
    );
  }

  /**
   * Find a deep link by ID with organization filtering
   *
   * @param id - Deep link UUID
   * @param userId - User ID for authorization checks
   * @param roles - User roles for authorization checks
   */
  async findById(
    id: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<DeepLink> {
    const deepLink = await this.repository.findById(id);
    if (!deepLink) {
      throw new NotFoundException(`Deep link with ID ${id} not found`);
    }

    // Validate access if authorization context provided
    if (userId !== '' || roles.length > 0) {
      const hasAccess = await this.validateSystemAccess(deepLink.systemUnderTestId, userId, roles);
      if (!hasAccess) {
        this.logger.debug(`User denied access to deep link ${id}`);
        throw new ResourceNotFoundException('DeepLink', id);
      }
    }

    return deepLink;
  }

  /**
   * Create a new deep link with organization filtering
   *
   * @param dto - Create deep link DTO
   * @param userId - User ID for authorization checks
   * @param roles - User roles for authorization checks
   */
  async create(
    dto: CreateDeepLinkDto,
    userId: string = '',
    roles: string[] = [],
  ): Promise<DeepLink> {
    const system = await withRequestEm(this.systemRepo).findOne({ where: { id: dto.systemUnderTestId } });
    if (!system) {
      throw new ResourceNotFoundException('System', dto.systemUnderTestId);
    }

    // Validate access if authorization context provided
    if (userId !== '' || roles.length > 0) {
      const result = await this.authzService.canAccessResource(userId, roles, {
        organization_id: system.organization_id,
        created_by: system.created_by ?? '',
      } as OwnedResource);
      if (!result.allowed) {
        this.logger.warn(`User denied access to create deep link for system ${dto.systemUnderTestId}`);
        throw new ResourceNotFoundException('System', dto.systemUnderTestId);
      }
    }

    return this.repository.create(dto, {
      organizationId: system.organization_id,
      teamId: system.team_id,
    });
  }

  /**
   * Update a deep link with organization filtering
   *
   * @param id - Deep link UUID
   * @param dto - Update deep link DTO
   * @param userId - User ID for authorization checks
   * @param roles - User roles for authorization checks
   */
  // audit-skip: per-test-run DeepLink — high-churn ingestion artefact, not user-curated config (Phase 5a PR16)
  async update(
    id: string,
    dto: UpdateDeepLinkDto,
    userId: string = '',
    roles: string[] = [],
  ): Promise<DeepLink> {
    await this.findById(id, userId, roles); // Check if exists and has access
    return this.repository.update(id, dto);
  }

  /**
   * Delete a deep link with organization filtering
   *
   * @param id - Deep link UUID
   * @param userId - User ID for authorization checks
   * @param roles - User roles for authorization checks
   */
  // audit-skip: per-test-run DeepLink — high-churn ingestion artefact, not user-curated config (Phase 5a PR16)
  async delete(
    id: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<void> {
    await this.findById(id, userId, roles); // Check if exists and has access
    return this.repository.delete(id);
  }

  /**
   * Copy deep links from a source scope to a target scope
   *
   * @param dto - Copy parameters including source/target scopes and conflict strategy
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs
   */
  // audit-skip: per-test-run DeepLink batch copy — same high-churn rationale as update/delete (Phase 5a PR16)
  async copyToScope(
    dto: CopyDeepLinksDto,
    userId: string,
    roles: string[],
  ): Promise<{ copied: number; skipped: number; total: number }> {
    // Validate access to source system
    const hasSourceAccess = await this.validateSystemAccess(dto.sourceSystemUnderTestId, userId, roles);
    if (!hasSourceAccess) {
      throw new ResourceNotFoundException('System', dto.sourceSystemUnderTestId);
    }

    // Validate access to target system and capture it for ownership inheritance
    const hasTargetAccess = await this.validateSystemAccess(dto.targetSystemUnderTestId, userId, roles);
    if (!hasTargetAccess) {
      throw new ResourceNotFoundException('System', dto.targetSystemUnderTestId);
    }
    const targetSystem = await withRequestEm(this.systemRepo).findOne({ where: { id: dto.targetSystemUnderTestId } });
    if (!targetSystem) {
      throw new ResourceNotFoundException('System', dto.targetSystemUnderTestId);
    }

    // Fetch source deep links
    let sourceLinks = await this.repository.findBySystemEnvWorkload(
      dto.sourceSystemUnderTestId,
      dto.sourceTestEnvironment,
      dto.sourceWorkload,
    );

    // Filter to specific IDs if provided
    if (dto.ids && dto.ids.length > 0) {
      const idSet = new Set(dto.ids);
      sourceLinks = sourceLinks.filter(link => idSet.has(link.id));
    }

    const total = sourceLinks.length;
    let copied = 0;
    let skipped = 0;

    // Fetch existing deep links in target scope for conflict detection
    const existingLinks = await this.repository.findBySystemEnvWorkload(
      dto.targetSystemUnderTestId,
      dto.targetTestEnvironment,
      dto.targetWorkload,
    );
    const existingNameSet = new Set(existingLinks.map(l => l.name));

    for (const link of sourceLinks) {
      // Cast to access 'tags' column which exists in the source entity and in the database
      // but may not be in the compiled @perfana/shared type declarations
      const linkRecord = link as unknown as Record<string, unknown>;
      const linkTags: string[] = Array.isArray(linkRecord.tags) ? linkRecord.tags as string[] : [];
      const nameExists = existingNameSet.has(link.name);

      if (nameExists && dto.conflictStrategy === 'skip') {
        skipped++;
        continue;
      }

      if (nameExists && dto.conflictStrategy === 'overwrite') {
        const existing = existingLinks.find(l => l.name === link.name);
        if (existing) {
          await this.repository.update(existing.id, {
            url: link.url,
            tags: linkTags,
          });
          copied++;
          continue;
        }
      }

      // Create new
      await this.repository.create(
        {
          systemUnderTestId: dto.targetSystemUnderTestId,
          testEnvironment: dto.targetTestEnvironment,
          workload: dto.targetWorkload,
          name: link.name,
          url: link.url,
          tags: linkTags,
        },
        { organizationId: targetSystem.organization_id, teamId: targetSystem.team_id },
      );
      copied++;
    }

    this.logger.log(`Copied ${copied} deep links, skipped ${skipped} of ${total} total`);
    return { copied, skipped, total };
  }

  async resolveVariables(
    deepLink: DeepLink,
    testRun: TestRunVariableData,
  ): Promise<ResolvedDeepLink> {
    let resolvedUrl = deepLink.url;
    const unresolvedVariables: string[] = [];

    try {
      // Replace standard variables
      resolvedUrl = this.replaceStandardVariables(resolvedUrl, testRun);

      // Replace configuration variables
      resolvedUrl = await this.replaceConfigVariables(resolvedUrl, testRun);

      // Replace reference variables (previous test run)
      resolvedUrl = await this.replaceReferenceVariables(resolvedUrl, testRun);

      // Check for unresolved variables
      const variablePattern = /\{[^}]+\}/g;
      const matches = resolvedUrl.match(variablePattern);
      if (matches) {
        unresolvedVariables.push(...matches);
      }

      return {
        id: deepLink.id,
        name: deepLink.name,
        url: resolvedUrl,
        isValid: unresolvedVariables.length === 0,
        unresolvedVariables: unresolvedVariables.length > 0 ? unresolvedVariables : undefined,
        tags: deepLink.tags ?? [],
      };
    } catch (error) {
      return {
        id: deepLink.id,
        name: deepLink.name,
        url: resolvedUrl,
        isValid: false,
        unresolvedVariables: ['Error resolving variables'],
        tags: deepLink.tags ?? [],
      };
    }
  }

  private replaceStandardVariables(url: string, testRun: TestRunVariableData): string {
    // System/Environment/Workload variables
    // Use system_name if available (from joined query), otherwise fall back to system_under_test_id
    const systemName = testRun.system_name || testRun.systems_under_test?.name || testRun.system_under_test_id || '';
    url = url.replace(/\{perfana-system-under-test\}/g, systemName);
    url = url.replace(/\{perfana-test-environment\}/g, testRun.test_environment || '');
    url = url.replace(/\{perfana-workload\}/g, testRun.workload || '');

    // Test run ID
    if (testRun.test_run_id) {
      url = url.replace(/\{perfana-test-run-id\}/g, testRun.test_run_id);
    }

    // Build result URL
    if (testRun.ci_build_results_url) {
      url = url.replace(/\{perfana-build-result-url\}/g, testRun.ci_build_results_url);
    }

    // Time variables — named after the official datetime format they produce
    // (Unix epoch, ISO 8601). Legacy tool-named variables keep resolving for
    // deep links saved before the rename.
    if (testRun.start_time) {
      const startDate = new Date(testRun.start_time);
      const startEpochMs = startDate.getTime();
      const startEpochS = Math.round(startEpochMs / 1000);
      const startIsoUtc = startDate.toISOString();

      url = url.replace(/\{perfana-start-epoch-milliseconds\}/g, startEpochMs.toString());
      url = url.replace(/\{perfana-start-epoch-seconds\}/g, startEpochS.toString());

      // ISO 8601, UTC (e.g. 2026-07-09T19:01:00.000Z)
      url = url.replace(/\{perfana-start-iso8601-utc\}/g, startIsoUtc);
      // ISO 8601 with UTC offset, URL-encoded '+' (e.g. 2026-07-09T21:01:00%2B02:00)
      url = url.replace(/\{perfana-start-iso8601-offset\}/g, this.toIso8601OffsetUrlEncoded(startDate));

      // Legacy tool-named variables (both were the same ISO UTC string)
      url = url.replace(/\{perfana-start-dynatrace\}/g, startIsoUtc);
      url = url.replace(/\{perfana-start-elasticsearch\}/g, startIsoUtc);
    }

    // For running tests (not completed, no end_time), use current time
    const endDate = testRun.end_time
      ? new Date(testRun.end_time)
      : (!testRun.completed ? new Date() : null);

    if (endDate) {
      const endEpochMs = endDate.getTime();
      const endEpochS = Math.round(endEpochMs / 1000);
      const endIsoUtc = endDate.toISOString();

      url = url.replace(/\{perfana-end-epoch-milliseconds\}/g, endEpochMs.toString());
      url = url.replace(/\{perfana-end-epoch-seconds\}/g, endEpochS.toString());

      // ISO 8601, UTC (e.g. 2026-07-09T19:31:00.000Z)
      url = url.replace(/\{perfana-end-iso8601-utc\}/g, endIsoUtc);
      // ISO 8601 with UTC offset, URL-encoded '+' (e.g. 2026-07-09T21:31:00%2B02:00)
      url = url.replace(/\{perfana-end-iso8601-offset\}/g, this.toIso8601OffsetUrlEncoded(endDate));

      // Legacy tool-named variables (both were the same ISO UTC string)
      url = url.replace(/\{perfana-end-dynatrace\}/g, endIsoUtc);
      url = url.replace(/\{perfana-end-elasticsearch\}/g, endIsoUtc);
    }

    return url;
  }

  /**
   * ISO 8601 with the server's local UTC offset at seconds precision,
   * with only the '+' URL-encoded so it survives query-string parsing:
   * 2026-07-09T21:01:00%2B02:00. Colons stay literal — they are valid in
   * query values and target systems (e.g. Dynatrace gtf) expect them.
   */
  private toIso8601OffsetUrlEncoded(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const offsetMinutes = -d.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '%2B' : '-';
    const abs = Math.abs(offsetMinutes);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
      `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }

  private async replaceConfigVariables(url: string, testRun: TestRunVariableData): Promise<string> {
    try {
      // Get configuration variables for this test run using the UUID id (TypeORM)
      const configs = await this.testRunConfigRepo.find({
        where: { testRunId: testRun.id },
        select: ['key', 'value']
      });

      if (configs && configs.length > 0) {
        for (const config of configs) {
          // Escape special regex characters in the key
          const escapedKey = config.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\{${escapedKey}\\}`, 'g');
          url = url.replace(regex, config.value || '');
        }
      }

      return url;
    } catch (error) {
      this.logger.warn('Failed to replace config variables:', error);
      return url;
    }
  }

  private async replaceReferenceVariables(url: string, testRun: TestRunVariableData): Promise<string> {
    try {
      // Get previous test run
      if (url.includes('{perfana-previous-test-run-id}')) {
        const previousTestRun = await withRequestEm(this.testRunRepo).findOne({
          where: {
            systemUnderTestId: testRun.system_under_test_id,
            testEnvironment: testRun.test_environment,
            workload: testRun.workload,
            completed: true,
          },
          select: ['testRunId'],
          order: { startTime: 'DESC' }
        });

        if (previousTestRun?.testRunId && previousTestRun.testRunId !== testRun.test_run_id) {
          url = url.replace(/\{perfana-previous-test-run-id\}/g, previousTestRun.testRunId);
        }
      }
    } catch (error) {
      // If we can't resolve reference variables, leave them as-is
      this.logger.warn('Could not resolve reference variables:', error);
    }

    return url;
  }

  // Generic Deep Links methods
  async findGenericByProfile(profile: string): Promise<GenericDeepLink[]> {
    return this.repository.findGenericByProfile(profile);
  }

  async createGeneric(dto: CreateGenericDeepLinkDto): Promise<GenericDeepLink> {
    // Inherit org/team from the parent Profile (matched by name) — GenericDeepLink.
    // organization_id is NOT NULL.
    const profile = await withRequestEm(this.profileRepo).findOne({ where: { name: dto.profile } });
    if (!profile) {
      throw new ResourceNotFoundException('Profile', dto.profile);
    }
    const saved = await this.repository.createGeneric(dto, {
      organizationId: profile.organizationId,
      teamId: profile.teamId,
    });
    this.auditService.logCreate(saved as unknown as OwnedResource);
    return saved;
  }
}