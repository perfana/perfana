# Repository Pattern Guidelines

## Overview

Perfana uses the **Repository Pattern** with TypeORM to provide a clean abstraction layer between business logic (services) and data access (databases). All repositories extend `TypeOrmBaseRepository` for consistency.

## Current Implementation Status

### Strengths

1. **Consistent Base Repository** - `TypeOrmBaseRepository` provides standardized CRUD operations
2. **Proper Error Handling** - All operations wrapped in try-catch with `DatabaseException`
3. **Comprehensive Logging** - NestJS Logger integration throughout
4. **Type Safety** - Full TypeScript support with generic constraints
5. **Domain-Specific Methods** - Each repository adds business-specific query methods
6. **Proper Dependency Injection** - Injectable decorators and TypeORM integration

### Existing Repositories

- `ApiKeyRepository` - 267 lines, 22 methods
- `TestRunRepository` - 368 lines, 26 methods
- `TestRunConfigurationRepository` - Configuration management
- `ExpectedConfigChangeRepository` - 181 lines, 14 methods
- `TrendsFilterPresetRepository` - Trends presets
- `CompareFilterPresetRepository` - Compare presets
- `ApplicationDashboardRepository` - Grafana dashboards

## TypeOrmBaseRepository Features

### Core CRUD Operations

```typescript
// Find operations
findAll(options?: FindManyOptions<T>): Promise<T[]>
findById(id: string, options?: FindOneOptions<T>): Promise<T>
findOne(options: FindOneOptions<T>): Promise<T | null>
findBy(where: FindOptionsWhere<T>): Promise<T[]>
findWithPagination(options?: FindManyOptions<T>): Promise<{ data, total, page, pageSize }>

// Create operations
create(data: DeepPartial<T>): Promise<T>
createMany(data: DeepPartial<T>[], chunkSize = 100): Promise<T[]>

// Update operations
update(id: string, data: QueryDeepPartialEntity<T>): Promise<T>
updateMany(ids: string[], data: QueryDeepPartialEntity<T>): Promise<void>

// Delete operations
delete(id: string): Promise<void>
deleteMany(ids: string[]): Promise<void>
softDelete(id: string): Promise<void>
restore(id: string): Promise<void>

// Utility operations
exists(id: string): Promise<boolean>
count(where?: FindOptionsWhere<T>): Promise<number>
getRepository(): Repository<T>
```

### Built-in Features

- **Automatic Logging** - All operations logged with entity name
- **Exception Handling** - `DatabaseException` for errors, `ResourceNotFoundException` for missing entities
- **Type Safety** - Generic constraints ensure `T extends { id: string }`
- **Protected Logger** - Available to child repositories as `this.logger`
- **Protected Repository** - Direct TypeORM access as `this.repository`

## Best Practices

### 1. Repository Creation Pattern

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmBaseRepository } from '../common/repositories/typeorm-base.repository';
import { YourEntity } from '../entities/your-entity.entity';
import { DatabaseException } from '../common/exceptions/business.exception';

@Injectable()
export class YourEntityRepository extends TypeOrmBaseRepository<YourEntity> {
  constructor(
    @InjectRepository(YourEntity)
    repository: Repository<YourEntity>,
  ) {
    super(repository, 'YourEntity'); // Entity name for logging
  }

  // Add domain-specific methods below
}
```

### 2. Domain-Specific Query Methods

Add business-specific queries that extend base functionality:

```typescript
/**
 * Find entities by business context
 */
async findByContext(systemId: string, environment: string): Promise<YourEntity[]> {
  try {
    return await this.repository.find({
      where: { systemId, environment },
      order: { createdAt: 'DESC' }
    });
  } catch (error) {
    this.logger.error('Failed to find entities by context:', error);
    throw new DatabaseException('Failed to retrieve entities', error);
  }
}
```

### 3. Complex Query Builder Patterns

Use QueryBuilder for advanced queries:

```typescript
async searchWithFilters(searchTerm: string, filters: Filters): Promise<YourEntity[]> {
  try {
    const queryBuilder = this.repository.createQueryBuilder('alias')
      .leftJoinAndSelect('alias.relation', 'rel')
      .where('alias.name ILIKE :search', { search: `%${searchTerm}%` });

    if (filters.status) {
      queryBuilder.andWhere('alias.status = :status', { status: filters.status });
    }

    return await queryBuilder.getMany();
  } catch (error) {
    this.logger.error('Failed to search with filters:', error);
    throw new DatabaseException('Failed to search entities', error);
  }
}
```

### 4. Error Handling Pattern

**ALWAYS** wrap database operations in try-catch:

```typescript
async customOperation(): Promise<YourEntity> {
  try {
    // Database operation here
    const result = await this.repository.something();
    return result;
  } catch (error) {
    this.logger.error('Failed to perform custom operation:', error);
    throw new DatabaseException('Failed to complete operation', error);
  }
}
```

### 5. Logging Pattern

```typescript
// Successful operations - info level
this.logger.log(`Created new entity with id: ${entity.id}`);
this.logger.log(`Deleted ${count} expired entities`);

// Debugging - debug level
this.logger.debug(`Updated last used timestamp for: ${id}`);

// Warnings - warn level
this.logger.warn('Non-critical issue occurred:', details);

// Errors - error level (before throwing)
this.logger.error('Failed to find entities:', error);
```

### 6. Batch Operations

For multiple records, use efficient batch operations:

```typescript
async createMany(entities: Partial<YourEntity>[]): Promise<YourEntity[]> {
  try {
    const created = this.repository.create(entities);
    const saved = await this.repository.save(created, { chunk: 100 });
    this.logger.log(`Created ${saved.length} new entities`);
    return saved;
  } catch (error) {
    this.logger.error('Failed to bulk create entities:', error);
    throw new DatabaseException('Failed to create entities', error);
  }
}
```

### 7. Statistics and Aggregations

```typescript
async getStatistics(): Promise<EntityStats> {
  try {
    const results = await this.repository.createQueryBuilder('e')
      .select('COUNT(e.id)', 'total')
      .addSelect('AVG(e.duration)', 'avgDuration')
      .addSelect('PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY e.duration)', 'p95')
      .getRawOne();

    return {
      total: parseInt(results.total, 10),
      avgDuration: parseFloat(results.avgDuration),
      p95Duration: parseFloat(results.p95),
    };
  } catch (error) {
    this.logger.error('Failed to get statistics:', error);
    throw new DatabaseException('Failed to retrieve statistics', error);
  }
}
```

### 8. Soft Delete Support

If entity has `@DeleteDateColumn`:

```typescript
// Soft delete (sets deletedAt timestamp)
await this.softDelete(id);

// Restore soft-deleted entity
await this.restore(id);

// Find including soft-deleted
await this.findAll({ withDeleted: true });
```

### 9. Transaction Support

For operations requiring multiple steps:

```typescript
import { DataSource } from 'typeorm';

@Injectable()
export class YourEntityRepository extends TypeOrmBaseRepository<YourEntity> {
  constructor(
    @InjectRepository(YourEntity)
    repository: Repository<YourEntity>,
    private readonly dataSource: DataSource, // Inject DataSource
  ) {
    super(repository, 'YourEntity');
  }

  async complexOperation(data: ComplexData): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Multiple operations
      await queryRunner.manager.save(entity1);
      await queryRunner.manager.save(entity2);

      await queryRunner.commitTransaction();
      this.logger.log('Transaction completed successfully');
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Transaction failed, rolled back:', error);
      throw new DatabaseException('Transaction failed', error);
    } finally {
      await queryRunner.release();
    }
  }
}
```

## Anti-Patterns to Avoid

### ❌ Don't Catch and Swallow Errors

```typescript
// BAD
async findSomething(): Promise<Entity | null> {
  try {
    return await this.repository.find(...);
  } catch (error) {
    // Silent failure - logs nothing, returns null
    return null;
  }
}

// GOOD
async findSomething(): Promise<Entity | null> {
  try {
    return await this.repository.find(...);
  } catch (error) {
    this.logger.error('Failed to find entity:', error);
    throw new DatabaseException('Failed to retrieve entity', error);
  }
}
```

### ❌ Don't Mix Business Logic in Repositories

```typescript
// BAD - Business logic in repository
async createWithValidation(data: CreateDto): Promise<Entity> {
  if (data.amount < 0) {
    throw new BusinessException('Amount must be positive');
  }
  return this.create(data);
}

// GOOD - Keep repositories focused on data access
async create(data: CreateDto): Promise<Entity> {
  return super.create(data);
}

// Put business logic in service layer
```

### ❌ Don't Return Raw Database Errors

```typescript
// BAD
async findSomething(): Promise<Entity> {
  return await this.repository.find(...); // Database error bubbles up
}

// GOOD
async findSomething(): Promise<Entity> {
  try {
    return await this.repository.find(...);
  } catch (error) {
    this.logger.error('Failed to find entity:', error);
    throw new DatabaseException('Failed to retrieve entity', error);
  }
}
```

### ❌ Don't Use Magic Numbers

```typescript
// BAD
async findRecent(): Promise<Entity[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30); // Magic number
  return this.repository.find({ where: { createdAt: MoreThan(cutoff) }});
}

// GOOD
private readonly RECENT_DAYS = 30;

async findRecent(days: number = this.RECENT_DAYS): Promise<Entity[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return this.repository.find({ where: { createdAt: MoreThan(cutoff) }});
}
```

## Module Registration

Register repositories in module providers:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { YourEntity } from './entities/your-entity.entity';
import { YourEntityRepository } from './repositories/your-entity.repository';
import { YourEntityService } from './services/your-entity.service';

@Module({
  imports: [TypeOrmModule.forFeature([YourEntity])],
  providers: [YourEntityRepository, YourEntityService],
  exports: [YourEntityRepository],
})
export class YourEntityModule {}
```

## Testing Repositories

Use TypeORM's testing utilities:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

describe('YourEntityRepository', () => {
  let repository: YourEntityRepository;
  let typeOrmRepository: Repository<YourEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YourEntityRepository,
        {
          provide: getRepositoryToken(YourEntity),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            // ... mock other TypeORM methods
          },
        },
      ],
    }).compile();

    repository = module.get<YourEntityRepository>(YourEntityRepository);
    typeOrmRepository = module.get<Repository<YourEntity>>(
      getRepositoryToken(YourEntity),
    );
  });

  it('should find entities', async () => {
    const mockEntities = [{ id: '1', name: 'Test' }];
    jest.spyOn(typeOrmRepository, 'find').mockResolvedValue(mockEntities);

    const result = await repository.findAll();

    expect(result).toEqual(mockEntities);
    expect(typeOrmRepository.find).toHaveBeenCalled();
  });
});
```

## Performance Tips

1. **Use Pagination** - Always limit results for large datasets
2. **Selective Relations** - Only load needed relations with `relations: ['relation']`
3. **QueryBuilder for Complex Queries** - More efficient than multiple finds
4. **Batch Operations** - Use `createMany` instead of multiple `create` calls
5. **Proper Indexes** - Define indexes in entity decorators for frequently queried fields
6. **Connection Pooling** - Configure in `ormconfig.ts`

## Summary

The repository pattern in Perfana provides:
- ✅ Consistent error handling
- ✅ Comprehensive logging
- ✅ Type-safe operations
- ✅ Clean separation of concerns
- ✅ Testable data access layer
- ✅ Extensible base functionality

All repositories should extend `TypeOrmBaseRepository` and follow these patterns for maintainability and consistency.
