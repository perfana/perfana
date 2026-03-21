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
import { TestRunConfiguration, TestRun as TestRunEntity, SystemUnderTest } from '../../entities';
import { ResourceNotFoundException } from '../../common/exceptions/business.exception';

/**
 * Global admin roles that bypass organization filtering
 */
const ADMIN_ROLES = ['perfana-admin', 'super-admin', 'admin'];

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
  ) {}

  /**
   * Check if a user has global admin role
   */
  private isGlobalAdmin(roles: string[]): boolean {
    return roles.some(role => ADMIN_ROLES.includes(role));
  }

  /**
   * Validate that a user has access to a system under test via organization membership
   * Returns true if access is granted, false otherwise
   */
  private async validateSystemAccess(
    systemUnderTestId: string,
    roles: string[],
    organizationIds: string[],
  ): Promise<boolean> {
    // Admins have access to all systems
    if (this.isGlobalAdmin(roles)) {
      return true;
    }

    // Non-admin users with no organization memberships have no access
    if (organizationIds.length === 0) {
      return false;
    }

    // Check if the system belongs to an organization the user has access to
    const system = await this.systemRepo
      .createQueryBuilder('sut')
      .leftJoin('sut.team', 'team')
      .where('sut.id = :systemId', { systemId: systemUnderTestId })
      .andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds })
      .getOne();

    return !!system;
  }

  /**
   * Find deep links by system/environment/workload with organization filtering
   *
   * @param systemUnderTestId - System under test UUID
   * @param testEnvironment - Test environment name
   * @param workload - Workload name
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async findBySystemEnvWorkload(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    roles: string[] = [],
    organizationIds: string[] = [],
  ): Promise<DeepLink[]> {
    // Validate access if organization filtering is enabled
    if (roles.length > 0 || organizationIds.length > 0) {
      const hasAccess = await this.validateSystemAccess(systemUnderTestId, roles, organizationIds);
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
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async findById(
    id: string,
    roles: string[] = [],
    organizationIds: string[] = [],
  ): Promise<DeepLink> {
    const deepLink = await this.repository.findById(id);
    if (!deepLink) {
      throw new NotFoundException(`Deep link with ID ${id} not found`);
    }

    // Validate access if organization filtering is enabled
    if (roles.length > 0 || organizationIds.length > 0) {
      const hasAccess = await this.validateSystemAccess(deepLink.systemUnderTestId, roles, organizationIds);
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
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async create(
    dto: CreateDeepLinkDto,
    roles: string[] = [],
    organizationIds: string[] = [],
  ): Promise<DeepLink> {
    // Validate access if organization filtering is enabled
    if (roles.length > 0 || organizationIds.length > 0) {
      const hasAccess = await this.validateSystemAccess(dto.systemUnderTestId, roles, organizationIds);
      if (!hasAccess) {
        this.logger.warn(`User denied access to create deep link for system ${dto.systemUnderTestId}`);
        throw new ResourceNotFoundException('System', dto.systemUnderTestId);
      }
    }

    return this.repository.create(dto);
  }

  /**
   * Update a deep link with organization filtering
   *
   * @param id - Deep link UUID
   * @param dto - Update deep link DTO
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async update(
    id: string,
    dto: UpdateDeepLinkDto,
    roles: string[] = [],
    organizationIds: string[] = [],
  ): Promise<DeepLink> {
    await this.findById(id, roles, organizationIds); // Check if exists and has access
    return this.repository.update(id, dto);
  }

  /**
   * Delete a deep link with organization filtering
   *
   * @param id - Deep link UUID
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async delete(
    id: string,
    roles: string[] = [],
    organizationIds: string[] = [],
  ): Promise<void> {
    await this.findById(id, roles, organizationIds); // Check if exists and has access
    return this.repository.delete(id);
  }

  /**
   * Copy deep links from a source scope to a target scope
   *
   * @param dto - Copy parameters including source/target scopes and conflict strategy
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs
   */
  async copyToScope(
    dto: CopyDeepLinksDto,
    roles: string[],
    organizationIds: string[],
  ): Promise<{ copied: number; skipped: number; total: number }> {
    // Validate access to source system
    const hasSourceAccess = await this.validateSystemAccess(dto.sourceSystemUnderTestId, roles, organizationIds);
    if (!hasSourceAccess) {
      throw new ResourceNotFoundException('System', dto.sourceSystemUnderTestId);
    }

    // Validate access to target system
    const hasTargetAccess = await this.validateSystemAccess(dto.targetSystemUnderTestId, roles, organizationIds);
    if (!hasTargetAccess) {
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
      // Cast to any to work around stale compiled declaration in @perfana/shared/entities
      // The 'tags' column exists in the source entity and in the database
      const linkAny = link as any;
      const linkTags: string[] = Array.isArray(linkAny.tags) ? linkAny.tags : [];
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
      await this.repository.create({
        systemUnderTestId: dto.targetSystemUnderTestId,
        testEnvironment: dto.targetTestEnvironment,
        workload: dto.targetWorkload,
        name: link.name,
        url: link.url,
        tags: linkTags,
      });
      copied++;
    }

    this.logger.log(`Copied ${copied} deep links, skipped ${skipped} of ${total} total`);
    return { copied, skipped, total };
  }

  async resolveVariables(
    deepLink: DeepLink,
    testRun: any,
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

  private replaceStandardVariables(url: string, testRun: any): string {
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

    // Time variables
    if (testRun.start_time) {
      const startDate = new Date(testRun.start_time);
      const startEpochMs = startDate.getTime();
      const startEpochS = Math.round(startEpochMs / 1000);
      
      url = url.replace(/\{perfana-start-epoch-milliseconds\}/g, startEpochMs.toString());
      url = url.replace(/\{perfana-start-epoch-seconds\}/g, startEpochS.toString());
      
      // Dynatrace format (ISO string)
      url = url.replace(/\{perfana-start-dynatrace\}/g, startDate.toISOString());
      
      // Elasticsearch format (ISO string with Z)
      url = url.replace(/\{perfana-start-elasticsearch\}/g, startDate.toISOString());
    }

    if (testRun.end_time) {
      const endDate = new Date(testRun.end_time);
      const endEpochMs = endDate.getTime();
      const endEpochS = Math.round(endEpochMs / 1000);
      
      url = url.replace(/\{perfana-end-epoch-milliseconds\}/g, endEpochMs.toString());
      url = url.replace(/\{perfana-end-epoch-seconds\}/g, endEpochS.toString());
      
      // Dynatrace format (ISO string)
      url = url.replace(/\{perfana-end-dynatrace\}/g, endDate.toISOString());
      
      // Elasticsearch format (ISO string with Z)
      url = url.replace(/\{perfana-end-elasticsearch\}/g, endDate.toISOString());
    }

    return url;
  }

  private async replaceConfigVariables(url: string, testRun: any): Promise<string> {
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

  private async replaceReferenceVariables(url: string, testRun: any): Promise<string> {
    try {
      // Get previous test run
      if (url.includes('{perfana-previous-test-run-id}')) {
        const previousTestRun = await this.testRunRepo.findOne({
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
    return this.repository.createGeneric(dto);
  }
}