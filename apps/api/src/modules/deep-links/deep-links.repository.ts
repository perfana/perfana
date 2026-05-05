import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeepLink as DeepLinkEntity } from '../../entities';
import { GenericDeepLink as GenericDeepLinkEntity } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { DeepLink } from '@perfana/shared/entities';
import { GenericDeepLink } from '@perfana/shared/entities';
import { CreateDeepLinkDto } from './dto/create-deep-link.dto';
import { UpdateDeepLinkDto } from './dto/update-deep-link.dto';
import { CreateGenericDeepLinkDto } from './dto/create-generic-deep-link.dto';

@Injectable()
export class DeepLinksRepository {
  constructor(
    @InjectRepository(DeepLinkEntity)
    private deepLinkRepo: Repository<DeepLinkEntity>,
    @InjectRepository(GenericDeepLinkEntity)
    private genericDeepLinkRepo: Repository<GenericDeepLinkEntity>
  ) {}

  async findBySystemEnvWorkload(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
  ): Promise<DeepLink[]> {
    const results = await withRequestEm(this.deepLinkRepo).find({
      where: {
        systemUnderTestId,
        testEnvironment,
        workload
      },
      order: { name: 'ASC' }
    });

    return results.map(this.mapToDeepLink);
  }

  async findById(id: string): Promise<DeepLink | null> {
    const result = await withRequestEm(this.deepLinkRepo).findOne({ where: { id } });
    return result ? this.mapToDeepLink(result) : null;
  }

  async create(
    dto: CreateDeepLinkDto,
    ownership: { organizationId: string; teamId?: string },
  ): Promise<DeepLink> {
    const deepLink = this.deepLinkRepo.create({
      systemUnderTestId: dto.systemUnderTestId,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      name: dto.name,
      url: dto.url,
      tags: dto.tags ?? [],
      templateDeepLinkId: dto.templateDeepLinkId,
      organizationId: ownership.organizationId,
      teamId: ownership.teamId,
    });

    const result = await withRequestEm(this.deepLinkRepo).save(deepLink);
    return this.mapToDeepLink(result);
  }

  async update(id: string, dto: UpdateDeepLinkDto): Promise<DeepLink> {
    const updateData: Partial<DeepLinkEntity> = {};

    if (dto.systemUnderTestId !== undefined) updateData.systemUnderTestId = dto.systemUnderTestId;
    if (dto.testEnvironment !== undefined) updateData.testEnvironment = dto.testEnvironment;
    if (dto.workload !== undefined) updateData.workload = dto.workload;
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.url !== undefined) updateData.url = dto.url;
    if (dto.templateDeepLinkId !== undefined) updateData.templateDeepLinkId = dto.templateDeepLinkId;
    if (dto.tags !== undefined) updateData.tags = dto.tags;

    await withRequestEm(this.deepLinkRepo).update(id, updateData);

    const result = await withRequestEm(this.deepLinkRepo).findOne({ where: { id } });
    if (!result) {
      throw new NotFoundException(`DeepLink with id ${id} not found after update`);
    }

    return this.mapToDeepLink(result);
  }

  async delete(id: string): Promise<void> {
    await withRequestEm(this.deepLinkRepo).delete(id);
  }

  // Generic Deep Links methods
  async findGenericByProfile(profile: string): Promise<GenericDeepLink[]> {
    const results = await withRequestEm(this.genericDeepLinkRepo).find({
      where: { profile },
      order: { name: 'ASC' }
    });

    return results.map(this.mapToGenericDeepLink);
  }

  async createGeneric(
    dto: CreateGenericDeepLinkDto,
    ownership: { organizationId: string; teamId?: string },
  ): Promise<GenericDeepLink> {
    const genericDeepLink = this.genericDeepLinkRepo.create({
      profile: dto.profile,
      name: dto.name,
      url: dto.url,
      organizationId: ownership.organizationId,
      teamId: ownership.teamId,
    });

    // Return the saved TypeORM entity instance (not a mapped plain object) so
    // the caller can pass it to AuditService — dispatch reads `.constructor`
    // to resolve `auditableFields`. Read paths keep the mapping to preserve
    // their narrower API shape.
    return withRequestEm(this.genericDeepLinkRepo).save(genericDeepLink);
  }

  private mapToDeepLink(entity: DeepLinkEntity): DeepLink {
    return {
      id: entity.id,
      systemUnderTestId: entity.systemUnderTestId,
      testEnvironment: entity.testEnvironment,
      workload: entity.workload,
      name: entity.name,
      url: entity.url,
      tags: entity.tags ?? [],
      templateDeepLinkId: entity.templateDeepLinkId,
      organizationId: entity.organizationId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private mapToGenericDeepLink(entity: GenericDeepLinkEntity): GenericDeepLink {
    return {
      id: entity.id,
      profile: entity.profile,
      name: entity.name,
      url: entity.url,
      organizationId: entity.organizationId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}