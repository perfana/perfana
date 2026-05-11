import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan, IsNull, In, FindOptionsWhere } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { TypeOrmBaseRepository } from '../common/repositories/typeorm-base.repository';
import { withRequestEm } from '../common/db/request-em';
import { ApiKey } from '@perfana/shared/entities';
import { DatabaseException } from '../common/exceptions/business.exception';

@Injectable()
export class ApiKeyRepository extends TypeOrmBaseRepository<ApiKey> {
  constructor(
    @InjectRepository(ApiKey)
    repository: Repository<ApiKey>,
  ) {
    super(repository, 'ApiKey');
  }

  /**
   * Find an API key by its key value
   */
  async findByKey(key: string): Promise<ApiKey | null> {
    return await this.findOne({
      where: { apiKey: key }
    });
  }

  /**
   * Find a valid (non-expired) API key
   */
  async findValidKey(key: string): Promise<ApiKey | null> {
    try {
      const now = new Date();
      return await withRequestEm(this.repository).findOne({
        where: [
          {
            apiKey: key,
            validUntil: MoreThan(now)
          },
          {
            apiKey: key,
            validUntil: IsNull()
          }
        ]
      });
    } catch (error) {
      this.logger.error('Failed to find valid API key:', error);
      throw new DatabaseException('Failed to retrieve API key', error);
    }
  }

  /**
   * Find all expired API keys
   */
  async findExpired(): Promise<ApiKey[]> {
    const now = new Date();
    return await withRequestEm(this.repository).find({
      where: {
        validUntil: LessThan(now)
      },
      order: { validUntil: 'DESC' }
    });
  }

  /**
   * Find API keys that never expire
   */
  async findNeverExpiring(): Promise<ApiKey[]> {
    return await withRequestEm(this.repository).find({
      where: {
        validUntil: IsNull()
      },
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Update last used timestamp for an API key
   */
  async updateLastUsed(id: string): Promise<void> {
    try {
      await withRequestEm(this.repository).update(id, {
        lastUsed: new Date()
      });
      this.logger.debug(`Updated last used timestamp for API key: ${id}`);
    } catch (error) {
      this.logger.error('Failed to update API key last used:', error);
      throw new DatabaseException('Failed to update API key', error);
    }
  }

  /**
   * Batch update last_used for multiple API keys in a single statement.
   * Runs outside the HTTP request context (no CLS/RLS) — uses the base repo directly.
   */
  async updateLastUsedBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await this.repository.update({ id: In(ids) }, { lastUsed: new Date() });
      this.logger.debug(`Batch updated last_used for ${ids.length} API key(s)`);
    } catch (error) {
      this.logger.error('Failed to batch update API key last used:', error);
      throw new DatabaseException('Failed to batch update API key', error);
    }
  }

  /**
   * Extend the validity of an API key
   */
  async extendValidity(id: string, additionalDays: number): Promise<ApiKey> {
    try {
      const apiKey = await this.findById(id);
      const currentExpiry = apiKey.validUntil || new Date();
      const newExpiry = new Date(currentExpiry);
      newExpiry.setDate(newExpiry.getDate() + additionalDays);

      return await this.update(id, {
        validUntil: newExpiry
      } as QueryDeepPartialEntity<ApiKey>);
    } catch (error) {
      this.logger.error('Failed to extend API key validity:', error);
      throw new DatabaseException('Failed to extend API key validity', error);
    }
  }

  /**
   * Set expiration date for an API key
   */
  async setExpiration(id: string, expirationDate: Date): Promise<ApiKey> {
    return await this.update(id, {
      validUntil: expirationDate
    } as QueryDeepPartialEntity<ApiKey>);
  }

  /**
   * Remove expiration (make key permanent)
   */
  async removeExpiration(id: string): Promise<ApiKey> {
    return await this.update(id, {
      validUntil: null
    } as unknown as QueryDeepPartialEntity<ApiKey>);
  }

  /**
   * Get API keys expiring soon (within N days)
   */
  async findExpiringSoon(days: number): Promise<ApiKey[]> {
    try {
      const now = new Date();
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + days);

      return await withRequestEm(this.repository).createQueryBuilder('ak')
        .where('ak.validUntil IS NOT NULL')
        .andWhere('ak.validUntil > :now', { now })
        .andWhere('ak.validUntil <= :futureDate', { futureDate })
        .orderBy('ak.validUntil', 'ASC')
        .getMany();
    } catch (error) {
      this.logger.error('Failed to find API keys expiring soon:', error);
      throw new DatabaseException('Failed to retrieve API keys', error);
    }
  }

  /**
   * Find an API key by exact description within an organization.
   * Used to surface a clean ConflictException before hitting the
   * (organization_id, description) unique index on INSERT.
   */
  async findByOrganizationAndDescription(
    organizationId: string,
    description: string,
  ): Promise<ApiKey | null> {
    return await withRequestEm(this.repository).findOne({
      where: { organization_id: organizationId, description },
    });
  }

  /**
   * Search API keys by description
   */
  async searchByDescription(searchTerm: string): Promise<ApiKey[]> {
    try {
      return await withRequestEm(this.repository).createQueryBuilder('ak')
        .where('ak.description ILIKE :search', { search: `%${searchTerm}%` })
        .orderBy('ak.createdAt', 'DESC')
        .getMany();
    } catch (error) {
      this.logger.error('Failed to search API keys:', error);
      throw new DatabaseException('Failed to search API keys', error);
    }
  }

  /**
   * Get API key statistics
   */
  async getStatistics(): Promise<{
    total: number;
    valid: number;
    expired: number;
    neverExpiring: number;
  }> {
    try {
      const now = new Date();

      const [total, expired, neverExpiring] = await Promise.all([
        this.count(),
        this.count({ validUntil: LessThan(now) } as FindOptionsWhere<ApiKey>),
        this.count({ validUntil: IsNull() } as FindOptionsWhere<ApiKey>),
      ]);

      const valid = total - expired;

      return { total, valid, expired, neverExpiring };
    } catch (error) {
      this.logger.error('Failed to get API key statistics:', error);
      throw new DatabaseException('Failed to retrieve API key statistics', error);
    }
  }

  /**
   * Delete expired API keys
   */
  async deleteExpired(): Promise<number> {
    try {
      const now = new Date();
      const result = await withRequestEm(this.repository).createQueryBuilder()
        .delete()
        .where('validUntil < :now', { now })
        .execute();

      this.logger.log(`Deleted ${result.affected} expired API keys`);
      return result.affected || 0;
    } catch (error) {
      this.logger.error('Failed to delete expired API keys:', error);
      throw new DatabaseException('Failed to delete API keys', error);
    }
  }

  /**
   * Find recently created API keys
   */
  async findRecentlyCreated(days: number = 7): Promise<ApiKey[]> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      return await withRequestEm(this.repository).find({
        where: {
          createdAt: MoreThan(cutoffDate)
        },
        order: { createdAt: 'DESC' }
      });
    } catch (error) {
      this.logger.error('Failed to find recently created API keys:', error);
      throw new DatabaseException('Failed to retrieve API keys', error);
    }
  }

  /**
   * Find unused API keys (never used)
   */
  async findUnused(): Promise<ApiKey[]> {
    return await withRequestEm(this.repository).find({
      where: {
        lastUsed: IsNull()
      },
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Find API keys not used recently
   */
  async findInactive(days: number = 30): Promise<ApiKey[]> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      return await withRequestEm(this.repository).createQueryBuilder('ak')
        .where('ak.lastUsed < :cutoffDate', { cutoffDate })
        .orWhere('ak.lastUsed IS NULL')
        .orderBy('ak.lastUsed', 'ASC', 'NULLS FIRST')
        .getMany();
    } catch (error) {
      this.logger.error('Failed to find inactive API keys:', error);
      throw new DatabaseException('Failed to retrieve API keys', error);
    }
  }

  /**
   * Validate if an API key is valid and not expired
   */
  async isValid(key: string): Promise<boolean> {
    const apiKey = await this.findValidKey(key);
    return apiKey !== null;
  }
}
