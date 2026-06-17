import { Logger } from '@nestjs/common';
import { Repository, FindOptionsWhere, FindManyOptions, FindOneOptions, DeepPartial } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ResourceNotFoundException, DatabaseException } from '../exceptions/business.exception';
import { withRequestEm } from '../db/request-em';

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
      return await withRequestEm(this.repository).find(options);
    } catch (error) {
      this.logger.error(`Failed to find all ${this.entityName}s:`, error);
      throw new DatabaseException(`Failed to retrieve ${this.entityName}s`, error);
    }
  }

  /**
   * Find a single entity by ID
   */
  async findById(id: string, options?: FindOneOptions<T>): Promise<T> {
    try {
      const entity = await withRequestEm(this.repository).findOne({
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
      return await withRequestEm(this.repository).findOne(options);
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
      return await withRequestEm(this.repository).findBy(where);
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
      const repo = withRequestEm(this.repository);
      const entity = repo.create(data);
      const saved = await repo.save(entity);
      this.logger.log(`Created new ${this.entityName} with id: ${saved.id}`);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to create ${this.entityName}:`, error);
      throw new DatabaseException(`Failed to create ${this.entityName}`, error);
    }
  }

  /**
   * Update an entity by ID
   */
  async update(id: string, data: QueryDeepPartialEntity<T>): Promise<T> {
    try {
      await withRequestEm(this.repository).update(id, data);

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
   * Delete an entity by ID
   */
  async delete(id: string): Promise<void> {
    try {
      const result = await withRequestEm(this.repository).delete(id);

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
   * Count entities with optional filter
   */
  async count(where?: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<number> {
    try {
      return await withRequestEm(this.repository).countBy(where || {});
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
