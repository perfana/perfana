import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetricsSource as MetricsSourceEntity } from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { OwnedResource } from '@perfana/shared';
import { CreateMetricsSourceDto } from './dto/create-metrics-source.dto';
import { UpdateMetricsSourceDto } from './dto/update-metrics-source.dto';

export interface MetricsSourceResponse {
  id: string;
  system_under_test_id: string;
  test_environment: string;
  source_type: string;
  source_config_id?: string;
  external_ref?: string;
  display_name: string;
  display_label?: string;
  workload?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  organization_id?: string;
  team_id?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  system_under_test?: {
    id: string;
    name: string;
  };
}

export interface MetricsSourceQuery {
  systemId?: string;
  systemUnderTestId?: string;
  environment?: string;
  testEnvironment?: string;
  sourceType?: string;
  tags?: string[];
  displayName?: string;
}

@Injectable()
export class MetricsSourcesService {
  private readonly logger = new Logger(MetricsSourcesService.name);

  constructor(
    @InjectRepository(MetricsSourceEntity)
    private readonly metricsSourceRepo: Repository<MetricsSourceEntity>,
    private readonly authzService: AuthorizationService,
  ) {}

  async findAll(userId: string, roles: string[], query: MetricsSourceQuery = {}): Promise<MetricsSourceResponse[]> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    this.logger.debug(`findAll: userId=${userId}, isGlobalAdmin=${orgIds === null}`);

    try {
      const qb = this.metricsSourceRepo
        .createQueryBuilder('ms')
        .leftJoinAndSelect('ms.systemUnderTest', 'sut');

      if (orgIds !== null) {
        if (orgIds.length === 0) {
          qb.andWhere('ms.organizationId IS NULL');
        } else {
          qb.andWhere(
            '(ms.organizationId IN (:...orgIds) OR ms.organizationId IS NULL)',
            { orgIds },
          );
        }
      }

      if (query.systemId || query.systemUnderTestId) {
        qb.andWhere('ms.systemUnderTestId = :systemId', {
          systemId: query.systemId || query.systemUnderTestId,
        });
      }

      if (query.environment || query.testEnvironment) {
        qb.andWhere('ms.testEnvironment = :environment', {
          environment: query.environment || query.testEnvironment,
        });
      }

      if (query.sourceType) {
        qb.andWhere('ms.sourceType = :sourceType', { sourceType: query.sourceType });
      }

      if (query.displayName) {
        qb.andWhere('ms.displayName ILIKE :displayName', {
          displayName: `%${query.displayName}%`,
        });
      }

      if (query.tags && query.tags.length > 0) {
        qb.andWhere('ms.tags && :tags', { tags: query.tags });
      }

      qb.orderBy('ms.displayName', 'ASC').addOrderBy('ms.displayLabel', 'ASC');

      const results = await qb.getMany();
      this.logger.debug(`Found ${results.length} metrics sources`);

      return results.map(row => this.toResponse(row));
    } catch (error) {
      this.logger.error('Failed to fetch metrics sources:', error);
      throw error;
    }
  }

  async findOne(id: string, userId: string, roles: string[]): Promise<MetricsSourceResponse> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    this.logger.debug(`findOne: id=${id}, userId=${userId}, isGlobalAdmin=${orgIds === null}`);

    try {
      const qb = this.metricsSourceRepo
        .createQueryBuilder('ms')
        .leftJoinAndSelect('ms.systemUnderTest', 'sut')
        .where('ms.id = :id', { id });

      if (orgIds !== null) {
        if (orgIds.length === 0) {
          qb.andWhere('ms.organizationId IS NULL');
        } else {
          qb.andWhere(
            '(ms.organizationId IN (:...orgIds) OR ms.organizationId IS NULL)',
            { orgIds },
          );
        }
      }

      const result = await qb.getOne();
      if (!result) {
        throw new NotFoundException(`MetricsSource with ID ${id} not found`);
      }

      return this.toResponse(result);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Failed to fetch metrics source ${id}:`, error);
      throw error;
    }
  }

  async findByApplicationDashboardId(
    applicationDashboardId: string,
    userId: string,
    roles: string[],
  ): Promise<MetricsSourceResponse | null> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);
    this.logger.debug(`findByApplicationDashboardId: adId=${applicationDashboardId}, userId=${userId}`);

    try {
      const qb = this.metricsSourceRepo
        .createQueryBuilder('ms')
        .leftJoinAndSelect('ms.systemUnderTest', 'sut')
        .where('ms.externalRef = (SELECT dashboard_uid FROM application_dashboards WHERE id = :adId)', {
          adId: applicationDashboardId,
        });

      if (orgIds !== null) {
        if (orgIds.length === 0) {
          qb.andWhere('ms.organizationId IS NULL');
        } else {
          qb.andWhere(
            '(ms.organizationId IN (:...orgIds) OR ms.organizationId IS NULL)',
            { orgIds },
          );
        }
      }

      const result = await qb.getOne();
      if (!result) return null;

      return this.toResponse(result);
    } catch (error) {
      this.logger.error(`Failed to find metrics source for application dashboard ${applicationDashboardId}:`, error);
      throw error;
    }
  }

  async create(dto: CreateMetricsSourceDto, userId: string, _roles: string[]): Promise<MetricsSourceResponse> {
    this.logger.debug(`create: userId=${userId}`);

    try {
      const entity = this.metricsSourceRepo.create({
        systemUnderTestId: dto.systemUnderTestId,
        testEnvironment: dto.testEnvironment,
        sourceType: dto.sourceType,
        sourceConfigId: dto.sourceConfigId,
        externalRef: dto.externalRef,
        displayName: dto.displayName,
        displayLabel: dto.displayLabel,
        workload: dto.workload,
        tags: dto.tags || [],
        metadata: dto.metadata,
        organizationId: dto.organizationId,
        teamId: dto.teamId,
        createdBy: userId,
      });

      const saved = await this.metricsSourceRepo.save(entity);

      const result = await this.metricsSourceRepo.findOne({
        where: { id: saved.id },
        relations: ['systemUnderTest'],
      });

      if (!result) {
        throw new Error('Failed to fetch created metrics source');
      }

      this.logger.log(`Created metrics source: ${result.displayName} (${result.id}) by user: ${userId}`);
      return this.toResponse(result);
    } catch (error) {
      this.logger.error('Error creating metrics source:', error);
      throw error;
    }
  }

  async update(id: string, dto: UpdateMetricsSourceDto, userId: string, roles: string[]): Promise<MetricsSourceResponse> {
    this.logger.debug(`update: id=${id}, userId=${userId}`);

    try {
      const existing = await this.metricsSourceRepo.findOne({ where: { id } });
      if (!existing) {
        throw new NotFoundException(`MetricsSource with id ${id} not found`);
      }

      // Delegate the admin / legacy-null-org / membership decision to AuthorizationService.
      // The original guard used getAccessibleOrganizations + accessibleOrgs.includes(orgId), which
      // is read-membership semantics — same shape as canAccessResource (NOT canModifyResource,
      // which would tighten access to org-admin role). team_id is omitted to preserve the prior
      // behavior of not checking team membership. created_by is unused by canAccessResource.
      const accessResult = await this.authzService.canAccessResource(userId, roles, {
        organization_id: existing.organizationId,
        created_by: '',
      } as OwnedResource);
      if (!accessResult.allowed) {
        throw new ForbiddenException('You do not have permission to modify this metrics source');
      }

      const updateData: Partial<MetricsSourceEntity> = {};
      if (dto.systemUnderTestId !== undefined) updateData.systemUnderTestId = dto.systemUnderTestId;
      if (dto.testEnvironment !== undefined) updateData.testEnvironment = dto.testEnvironment;
      if (dto.sourceType !== undefined) updateData.sourceType = dto.sourceType;
      if (dto.sourceConfigId !== undefined) updateData.sourceConfigId = dto.sourceConfigId;
      if (dto.externalRef !== undefined) updateData.externalRef = dto.externalRef;
      if (dto.displayName !== undefined) updateData.displayName = dto.displayName;
      if (dto.displayLabel !== undefined) updateData.displayLabel = dto.displayLabel;
      if (dto.workload !== undefined) updateData.workload = dto.workload;
      if (dto.tags !== undefined) updateData.tags = dto.tags;
      if (dto.metadata !== undefined) updateData.metadata = dto.metadata;
      if (dto.organizationId !== undefined) updateData.organizationId = dto.organizationId;
      if (dto.teamId !== undefined) updateData.teamId = dto.teamId;

      await this.metricsSourceRepo.update(id, updateData as any);

      const result = await this.findOne(id, userId, roles);
      this.logger.log(`Updated metrics source: ${result.display_name} (${result.id}) by user: ${userId}`);
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error updating metrics source ${id}:`, error);
      throw error;
    }
  }

  async delete(id: string, userId: string, roles: string[]): Promise<void> {
    this.logger.debug(`delete: id=${id}, userId=${userId}`);

    try {
      const existing = await this.metricsSourceRepo.findOne({ where: { id } });
      if (!existing) {
        throw new NotFoundException(`MetricsSource with id ${id} not found`);
      }

      // Same access shape as update — see comment there for the rationale of canAccessResource over canModifyResource.
      const result = await this.authzService.canAccessResource(userId, roles, {
        organization_id: existing.organizationId,
        created_by: '',
      } as OwnedResource);
      if (!result.allowed) {
        throw new ForbiddenException('You do not have permission to delete this metrics source');
      }

      await this.metricsSourceRepo.delete(id);
      this.logger.log(`Deleted metrics source: ${existing.displayName} (${id}) by user: ${userId}`);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(`Error deleting metrics source ${id}:`, error);
      throw error;
    }
  }

  private toResponse(row: MetricsSourceEntity): MetricsSourceResponse {
    return {
      id: row.id,
      system_under_test_id: row.systemUnderTestId,
      test_environment: row.testEnvironment,
      source_type: row.sourceType,
      source_config_id: row.sourceConfigId,
      external_ref: row.externalRef,
      display_name: row.displayName,
      display_label: row.displayLabel,
      workload: row.workload,
      tags: row.tags,
      metadata: row.metadata,
      organization_id: row.organizationId,
      team_id: row.teamId,
      created_by: row.createdBy,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      system_under_test: row.systemUnderTest ? {
        id: row.systemUnderTest.id,
        name: row.systemUnderTest.name,
      } : undefined,
    };
  }
}
