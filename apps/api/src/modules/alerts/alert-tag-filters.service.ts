import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertTagFilter } from '../../entities';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { OwnedResource } from '@perfana/shared';
import { CreateAlertTagFilterDto, UpdateAlertTagFilterDto } from './dto/alert-tag-filter.dto';

@Injectable()
export class AlertTagFiltersService {
  constructor(
    @InjectRepository(AlertTagFilter)
    private readonly filterRepo: Repository<AlertTagFilter>,
    private readonly authzService: AuthorizationService,
  ) {}

  async findAll(userId: string, roles: string[]): Promise<AlertTagFilter[]> {
    const orgIds = await withOrgFilter(userId, roles, this.authzService);

    const qb = this.filterRepo
      .createQueryBuilder('f')
      .orderBy('f.created_at', 'DESC');

    if (orgIds !== null) {
      qb.andWhere(
        '(f.organization_id IN (:...orgIds) OR f.organization_id IS NULL)',
        { orgIds: orgIds.length > 0 ? orgIds : ['00000000-0000-0000-0000-000000000000'] },
      );
    }

    return qb.getMany();
  }

  async findOne(id: string, userId: string, roles: string[]): Promise<AlertTagFilter> {
    const filter = await this.filterRepo.findOne({ where: { id } });
    if (!filter) {
      throw new NotFoundException(`Alert tag filter ${id} not found`);
    }

    // Delegate the admin / legacy-null-org / membership decision to AuthorizationService.
    // team_id is omitted to preserve the prior behavior of not checking team membership for
    // alert tag filters. created_by is unused by canAccessResource (only canModifyResource reads it).
    const result = await this.authzService.canAccessResource(userId, roles, {
      organization_id: filter.organizationId,
      created_by: '',
    } as OwnedResource);
    if (!result.allowed) {
      throw new NotFoundException(`Alert tag filter ${id} not found`);
    }

    return filter;
  }

  async create(dto: CreateAlertTagFilterDto, userId: string): Promise<AlertTagFilter> {
    // AlertTagFilter.organization_id is NOT NULL. Use the DTO value if supplied,
    // otherwise default to the caller's first accessible org.
    let organizationId = dto.organizationId;
    if (!organizationId) {
      const orgs = await this.authzService.getAccessibleOrganizations(userId);
      const first = orgs?.[0];
      if (!first) {
        throw new ForbiddenException('No accessible organization found for user');
      }
      organizationId = first;
    }

    const filter = this.filterRepo.create({
      filterType: dto.filterType,
      alertSource: dto.alertSource,
      tagKey: dto.tagKey,
      tagValue: dto.tagValue,
      systemUnderTestId: dto.systemUnderTestId,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      organizationId,
      createdBy: userId,
      updatedBy: userId,
    });

    return this.filterRepo.save(filter);
  }

  async update(id: string, dto: UpdateAlertTagFilterDto, userId: string, roles: string[]): Promise<AlertTagFilter> {
    const filter = await this.findOne(id, userId, roles);

    if (dto.filterType !== undefined) filter.filterType = dto.filterType;
    if (dto.alertSource !== undefined) filter.alertSource = dto.alertSource;
    if (dto.tagKey !== undefined) filter.tagKey = dto.tagKey;
    if (dto.tagValue !== undefined) filter.tagValue = dto.tagValue;
    if (dto.systemUnderTestId !== undefined) filter.systemUnderTestId = dto.systemUnderTestId;
    if (dto.testEnvironment !== undefined) filter.testEnvironment = dto.testEnvironment;
    if (dto.workload !== undefined) filter.workload = dto.workload;
    filter.updatedBy = userId;

    return this.filterRepo.save(filter);
  }

  async remove(id: string, userId: string, roles: string[]): Promise<void> {
    await this.findOne(id, userId, roles);
    await this.filterRepo.delete(id);
  }
}
