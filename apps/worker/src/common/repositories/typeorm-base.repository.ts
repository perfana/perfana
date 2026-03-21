import { Logger } from '@nestjs/common';
import { Repository, FindOptionsWhere, FindManyOptions, FindOneOptions, DeepPartial } from 'typeorm';
import { ResourceNotFoundException, DatabaseException } from '../exceptions/business.exception.js';

/**
 * Base TypeORM repository providing common database operations
 * All TypeORM repositories should extend this class for consistent patterns
 */
export abstract class TypeOrmBaseRepository<T extends { id: string }> {
  protected readonly logger: Logger;

  constructor(
    protected readonly repository: Repository<T>,
    protected readonly entityName: string,
  ) {
    this.logger = new Logger(`${entityName}Repository`);
  }

  /**
   * Find all entities with optional query options
   */
  async findAll(options?: FindManyOptions<T>): Promise<T[]> {
    try {
      return await this.repository.find(options);
    } catch (error) {
      this.logger.error(`Failed to find all ${this.entityName}s:`, error);
      throw new DatabaseException(`Failed to retrieve ${this.entityName}s`, error);
    }
  }

  /**
   * Find entities with pagination
   */
  async findWithPagination(options?: FindManyOptions<T>): Promise<{
    data: T[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    try {
      const page = options?.skip ? Math.floor(options.skip / (options.take || 20)) + 1 : 1;
      const pageSize = options?.take || 20;

      const [data, total] = await this.repository.findAndCount(options);

      return { data, total, page, pageSize };
    } catch (error) {
      this.logger.error(`Failed to find paginated ${this.entityName}s:`, error);
      throw new DatabaseException(`Failed to retrieve ${this.entityName}s`, error);
    }
  }

  /**
   * Find a single entity by ID
   */
  async findById(id: string, options?: FindOneOptions<T>): Promise<T> {
    try {
      const entity = await this.repository.findOne({
        ...options,
        where: { ...options?.where, id } as FindOptionsWhere<T>,
      });

      if (!entity) {
        throw new ResourceNotFoundException(this.entityName, id);
      }

      return entity;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to find ${this.entityName} by id:`, error);
      throw new DatabaseException(`Failed to retrieve ${this.entityName}`, error);
    }
  }

  /**
   * Find a single entity by custom criteria
   */
  async findOne(options: FindOneOptions<T>): Promise<T | null> {
    try {
      return await this.repository.findOne(options);
    } catch (error) {
      this.logger.error(`Failed to find ${this.entityName}:`, error);
      throw new DatabaseException(`Failed to retrieve ${this.entityName}`, error);
    }
  }

  /**
   * Find entities by specific field value
   */
  async findBy(where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<T[]> {
    try {
      return await this.repository.findBy(where);
    } catch (error) {
      this.logger.error(`Failed to find ${this.entityName}s:`, error);
      throw new DatabaseException(`Failed to retrieve ${this.entityName}s`, error);
    }
  }

  /**
   * Create a new entity
   */
  async create(data: DeepPartial<T>): Promise<T> {
    try {
      const entity = this.repository.create(data);
      const saved = await this.repository.save(entity);
      this.logger.log(`Created new ${this.entityName} with id: ${saved.id}`);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to create ${this.entityName}:`, error);
      throw new DatabaseException(`Failed to create ${this.entityName}`, error);
    }
  }

  /**
   * Create multiple entities
   */
  async createMany(data: DeepPartial<T>[], chunkSize = 100): Promise<T[]> {
    try {
      const entities = this.repository.create(data);
      const saved = await this.repository.save(entities, { chunk: chunkSize });
      this.logger.log(`Created ${saved.length} new ${this.entityName}s`);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to create multiple ${this.entityName}s:`, error);
      throw new DatabaseException(`Failed to create ${this.entityName}s`, error);
    }
  }

  /**
   * Update an entity by ID
   */
  async update(id: string, data: DeepPartial<T>): Promise<T> {
    try {
      await this.repository.update(id, data as any);

      const updated = await this.findById(id);
      this.logger.log(`Updated ${this.entityName} with id: ${id}`);
      return updated;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to update ${this.entityName}:`, error);
      throw new DatabaseException(`Failed to update ${this.entityName}`, error);
    }
  }

  /**
   * Update multiple entities by IDs
   */
  async updateMany(ids: string[], data: DeepPartial<T>): Promise<void> {
    try {
      await this.repository.createQueryBuilder()
        .update()
        .set(data as any)
        .whereInIds(ids)
        .execute();

      this.logger.log(`Updated ${ids.length} ${this.entityName}s`);
    } catch (error) {
      this.logger.error(`Failed to update multiple ${this.entityName}s:`, error);
      throw new DatabaseException(`Failed to update ${this.entityName}s`, error);
    }
  }

  /**
   * Delete an entity by ID
   */
  async delete(id: string): Promise<void> {
    try {
      const result = await this.repository.delete(id);

      if (result.affected === 0) {
        throw new ResourceNotFoundException(this.entityName, id);
      }

      this.logger.log(`Deleted ${this.entityName} with id: ${id}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete ${this.entityName}:`, error);
      throw new DatabaseException(`Failed to delete ${this.entityName}`, error);
    }
  }

  /**
   * Delete multiple entities by IDs
   */
  async deleteMany(ids: string[]): Promise<void> {
    try {
      await this.repository.delete(ids);
      this.logger.log(`Deleted ${ids.length} ${this.entityName}s`);
    } catch (error) {
      this.logger.error(`Failed to delete multiple ${this.entityName}s:`, error);
      throw new DatabaseException(`Failed to delete ${this.entityName}s`, error);
    }
  }

  /**
   * Soft delete an entity by ID (if entity supports soft delete)
   */
  async softDelete(id: string): Promise<void> {
    try {
      const result = await this.repository.softDelete(id);

      if (result.affected === 0) {
        throw new ResourceNotFoundException(this.entityName, id);
      }

      this.logger.log(`Soft deleted ${this.entityName} with id: ${id}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to soft delete ${this.entityName}:`, error);
      throw new DatabaseException(`Failed to soft delete ${this.entityName}`, error);
    }
  }

  /**
   * Restore a soft-deleted entity by ID
   */
  async restore(id: string): Promise<void> {
    try {
      await this.repository.restore(id);
      this.logger.log(`Restored ${this.entityName} with id: ${id}`);
    } catch (error) {
      this.logger.error(`Failed to restore ${this.entityName}:`, error);
      throw new DatabaseException(`Failed to restore ${this.entityName}`, error);
    }
  }

  /**
   * Check if an entity exists by ID
   */
  async exists(id: string): Promise<boolean> {
    try {
      const count = await this.repository.countBy({ id } as FindOptionsWhere<T>);
      return count > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Count entities with optional filter
   */
  async count(where?: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<number> {
    try {
      return await this.repository.countBy(where || {});
    } catch (error) {
      this.logger.error(`Failed to count ${this.entityName}s:`, error);
      throw new DatabaseException(`Failed to count ${this.entityName}s`, error);
    }
  }

  /**
   * Get the underlying TypeORM repository for custom operations
   */
  getRepository(): Repository<T> {
    return this.repository;
  }
}
