/**
 * Mock Repository Factory
 *
 * Provides reusable mock repository and query builder factories for unit testing.
 * This helps standardize mocking patterns across all API service tests.
 *
 * Usage:
 * ```typescript
 * import { createMockRepository, createMockQueryBuilder } from '../../../test/helpers/mock-repository.factory';
 *
 * const mockRepo = createMockRepository<MyEntity>();
 * const mockQueryBuilder = createMockQueryBuilder<MyEntity>();
 * ```
 */

import {
  Repository,
  SelectQueryBuilder,
  InsertQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
  ObjectLiteral,
  InsertResult,
  UpdateResult,
  DeleteResult,
  EntityManager,
  QueryRunner,
} from 'typeorm';

/**
 * Type alias for a fully mocked SelectQueryBuilder
 */
export type MockSelectQueryBuilder<T extends ObjectLiteral> = jest.Mocked<SelectQueryBuilder<T>>;

/**
 * Type alias for a fully mocked Repository
 */
export type MockRepository<T extends ObjectLiteral> = jest.Mocked<Repository<T>>;

/**
 * Creates a mock SelectQueryBuilder with all methods stubbed.
 * All chainable methods return `this` to support method chaining.
 * Includes transition methods (delete, update, insert) that return specialized query builders.
 *
 * @param overrides - Optional partial overrides for specific methods
 * @returns A fully mocked SelectQueryBuilder
 */
export function createMockQueryBuilder<T extends ObjectLiteral>(
  overrides?: Partial<SelectQueryBuilder<T>>,
): MockSelectQueryBuilder<T> {
  // Create specialized builders that will be returned by transition methods
  // These are lazily created to avoid circular dependencies
  let deleteBuilder: jest.Mocked<DeleteQueryBuilder<T>> | null = null;
  let updateBuilder: jest.Mocked<UpdateQueryBuilder<T>> | null = null;
  let insertBuilder: jest.Mocked<InsertQueryBuilder<T>> | null = null;

  const mockQueryBuilder = {
    // Selection methods
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    distinctOn: jest.fn().mockReturnThis(),
    distinct: jest.fn().mockReturnThis(),

    // From/Join methods
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoinAndMapOne: jest.fn().mockReturnThis(),
    innerJoinAndMapMany: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndMapOne: jest.fn().mockReturnThis(),
    leftJoinAndMapMany: jest.fn().mockReturnThis(),
    rightJoin: jest.fn().mockReturnThis(),
    rightJoinAndSelect: jest.fn().mockReturnThis(),

    // Where clause methods
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    whereInIds: jest.fn().mockReturnThis(),
    andWhereInIds: jest.fn().mockReturnThis(),
    orWhereInIds: jest.fn().mockReturnThis(),
    whereExists: jest.fn().mockReturnThis(),
    andWhereExists: jest.fn().mockReturnThis(),
    orWhereExists: jest.fn().mockReturnThis(),
    whereNotExists: jest.fn().mockReturnThis(),
    andWhereNotExists: jest.fn().mockReturnThis(),
    orWhereNotExists: jest.fn().mockReturnThis(),

    // Bracket (nested conditions) methods
    andWhereBrackets: jest.fn().mockReturnThis(),
    orWhereBrackets: jest.fn().mockReturnThis(),

    // Parameter methods
    setParameter: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),

    // Grouping and ordering
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    andHaving: jest.fn().mockReturnThis(),
    orHaving: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),

    // Pagination
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),

    // Soft delete support
    withDeleted: jest.fn().mockReturnThis(),

    // Caching
    cache: jest.fn().mockReturnThis(),

    // Locking
    setLock: jest.fn().mockReturnThis(),
    useTransaction: jest.fn().mockReturnThis(),

    // Subqueries
    subQuery: jest.fn().mockReturnThis(),
    getSubQuery: jest.fn(),

    // Relation methods
    relation: jest.fn().mockReturnThis(),
    loadAllRelationIds: jest.fn().mockReturnThis(),
    loadRelationIdAndMap: jest.fn().mockReturnThis(),
    loadRelationCountAndMap: jest.fn().mockReturnThis(),

    // Result methods
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    getOneOrFail: jest.fn().mockRejectedValue(new Error('Entity not found')),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getCount: jest.fn().mockResolvedValue(0),
    getExists: jest.fn().mockResolvedValue(false),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue(null),
    getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
    stream: jest.fn(),

    // Query builder transition methods (return specialized builders)
    delete: jest.fn().mockImplementation(() => {
      if (!deleteBuilder) {
        deleteBuilder = createMockDeleteQueryBuilder<T>();
      }
      return deleteBuilder;
    }),
    update: jest.fn().mockImplementation(() => {
      if (!updateBuilder) {
        updateBuilder = createMockUpdateQueryBuilder<T>();
      }
      return updateBuilder;
    }),
    insert: jest.fn().mockImplementation(() => {
      if (!insertBuilder) {
        insertBuilder = createMockInsertQueryBuilder<T>();
      }
      return insertBuilder;
    }),
    softDelete: jest.fn().mockReturnThis(),
    restore: jest.fn().mockReturnThis(),

    // Other methods
    clone: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
    getQuery: jest.fn().mockReturnValue(''),
    getQueryAndParameters: jest.fn().mockReturnValue(['', []]),
    getSql: jest.fn().mockReturnValue(''),
    printSql: jest.fn().mockReturnThis(),
    setQueryRunner: jest.fn().mockReturnThis(),

    // Comment and optimization hints
    comment: jest.fn().mockReturnThis(),
    maxExecutionTime: jest.fn().mockReturnThis(),
    disableEscaping: jest.fn().mockReturnThis(),

    // Expression methods
    expressionMap: {
      mainAlias: { name: 'entity' },
    },

    // Additional common properties/methods
    connection: {} as any,
    alias: 'entity',
    parentQueryBuilder: undefined,

    ...overrides,
  } as unknown as MockSelectQueryBuilder<T>;

  return mockQueryBuilder;
}

/**
 * Creates a mock InsertQueryBuilder with all methods stubbed.
 *
 * @param overrides - Optional partial overrides for specific methods
 * @returns A fully mocked InsertQueryBuilder
 */
export function createMockInsertQueryBuilder<T extends ObjectLiteral>(
  overrides?: Partial<InsertQueryBuilder<T>>,
): jest.Mocked<InsertQueryBuilder<T>> {
  const mockInsertBuilder = {
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    orUpdate: jest.fn().mockReturnThis(),
    updateEntity: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    output: jest.fn().mockReturnThis(),
    useTransaction: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({
      identifiers: [],
      generatedMaps: [],
      raw: [],
    } as InsertResult),
    getQuery: jest.fn().mockReturnValue(''),
    getQueryAndParameters: jest.fn().mockReturnValue(['', []]),
    getSql: jest.fn().mockReturnValue(''),
    printSql: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    setQueryRunner: jest.fn().mockReturnThis(),
    // Common properties
    connection: {} as any,
    expressionMap: {} as any,
    ...overrides,
  } as unknown as jest.Mocked<InsertQueryBuilder<T>>;

  return mockInsertBuilder;
}

/**
 * Creates a mock UpdateQueryBuilder with all methods stubbed.
 *
 * @param overrides - Optional partial overrides for specific methods
 * @returns A fully mocked UpdateQueryBuilder
 */
export function createMockUpdateQueryBuilder<T extends ObjectLiteral>(
  overrides?: Partial<UpdateQueryBuilder<T>>,
): jest.Mocked<UpdateQueryBuilder<T>> {
  const mockUpdateBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    whereInIds: jest.fn().mockReturnThis(),
    andWhereInIds: jest.fn().mockReturnThis(),
    orWhereInIds: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    output: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    useTransaction: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({
      affected: 1,
      raw: [],
      generatedMaps: [],
    } as UpdateResult),
    getQuery: jest.fn().mockReturnValue(''),
    getQueryAndParameters: jest.fn().mockReturnValue(['', []]),
    getSql: jest.fn().mockReturnValue(''),
    printSql: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    setQueryRunner: jest.fn().mockReturnThis(),
    // Common properties
    connection: {} as any,
    expressionMap: {} as any,
    ...overrides,
  } as unknown as jest.Mocked<UpdateQueryBuilder<T>>;

  return mockUpdateBuilder;
}

/**
 * Creates a mock DeleteQueryBuilder with all methods stubbed.
 *
 * @param overrides - Optional partial overrides for specific methods
 * @returns A fully mocked DeleteQueryBuilder
 */
export function createMockDeleteQueryBuilder<T extends ObjectLiteral>(
  overrides?: Partial<DeleteQueryBuilder<T>>,
): jest.Mocked<DeleteQueryBuilder<T>> {
  const mockDeleteBuilder = {
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    whereInIds: jest.fn().mockReturnThis(),
    andWhereInIds: jest.fn().mockReturnThis(),
    orWhereInIds: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    output: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    useTransaction: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({
      affected: 1,
      raw: [],
    } as DeleteResult),
    getQuery: jest.fn().mockReturnValue(''),
    getQueryAndParameters: jest.fn().mockReturnValue(['', []]),
    getSql: jest.fn().mockReturnValue(''),
    printSql: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    setQueryRunner: jest.fn().mockReturnThis(),
    // Common properties
    connection: {} as any,
    expressionMap: {} as any,
    ...overrides,
  } as unknown as jest.Mocked<DeleteQueryBuilder<T>>;

  return mockDeleteBuilder;
}

/**
 * Creates a mock EntityManager for transaction testing.
 *
 * @param overrides - Optional partial overrides for specific methods
 * @returns A fully mocked EntityManager
 */
export function createMockEntityManager(
  overrides?: Partial<EntityManager>,
): jest.Mocked<EntityManager> {
  const mockManager = {
    // Transaction methods
    transaction: jest.fn((isolationOrCallback: any, maybeCallback?: any) => {
      const callback = typeof isolationOrCallback === 'function' ? isolationOrCallback : maybeCallback;
      return Promise.resolve(callback ? callback(mockManager) : undefined);
    }),

    // Entity methods
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    findBy: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    findOneOrFail: jest.fn().mockResolvedValue({}),
    findOneByOrFail: jest.fn().mockResolvedValue({}),

    // Persistence methods
    save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    insert: jest.fn().mockResolvedValue({ identifiers: [], generatedMaps: [], raw: [] }),
    update: jest.fn().mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
    upsert: jest.fn().mockResolvedValue({ identifiers: [], generatedMaps: [], raw: [] }),
    delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
    softDelete: jest.fn().mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
    restore: jest.fn().mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
    remove: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    softRemove: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    recover: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),

    // Other methods
    create: jest.fn().mockImplementation((entityClass, data) => data),
    merge: jest.fn().mockImplementation((entityClass, ...entities) => Object.assign({}, ...entities)),
    preload: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    countBy: jest.fn().mockResolvedValue(0),
    sum: jest.fn().mockResolvedValue(0),
    average: jest.fn().mockResolvedValue(0),
    minimum: jest.fn().mockResolvedValue(0),
    maximum: jest.fn().mockResolvedValue(0),
    exists: jest.fn().mockResolvedValue(false),
    existsBy: jest.fn().mockResolvedValue(false),
    clear: jest.fn().mockResolvedValue(undefined),
    increment: jest.fn().mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
    decrement: jest.fn().mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),

    // Query builder
    createQueryBuilder: jest.fn().mockReturnValue(createMockQueryBuilder()),

    // Query
    query: jest.fn().mockResolvedValue([]),

    // Repository
    getRepository: jest.fn(),
    getTreeRepository: jest.fn(),
    getCustomRepository: jest.fn(),
    withRepository: jest.fn(),
    hasId: jest.fn().mockReturnValue(true),
    getId: jest.fn(),
    release: jest.fn().mockResolvedValue(undefined),

    ...overrides,
  } as unknown as jest.Mocked<EntityManager>;

  return mockManager;
}

/**
 * Creates a mock QueryRunner for transaction testing.
 *
 * @param overrides - Optional partial overrides for specific methods
 * @returns A fully mocked QueryRunner
 */
export function createMockQueryRunner(
  overrides?: Partial<QueryRunner>,
): jest.Mocked<QueryRunner> {
  const mockQueryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    isTransactionActive: false,
    query: jest.fn().mockResolvedValue([]),
    manager: createMockEntityManager(),
    ...overrides,
  } as unknown as jest.Mocked<QueryRunner>;

  return mockQueryRunner;
}

/**
 * Creates a mock Repository with all standard TypeORM Repository methods stubbed.
 * Includes a pre-configured mock QueryBuilder accessible via `createQueryBuilder()`.
 *
 * @param queryBuilderOverrides - Optional overrides for the embedded QueryBuilder mock
 * @param repositoryOverrides - Optional overrides for specific Repository methods
 * @returns A fully mocked Repository
 *
 * @example
 * ```typescript
 * // Basic usage
 * const mockRepo = createMockRepository<User>();
 * mockRepo.findOne.mockResolvedValue({ id: '1', name: 'Test' });
 *
 * // With overrides
 * const mockRepo = createMockRepository<User>({}, {
 *   findOne: jest.fn().mockResolvedValue({ id: '1', name: 'Custom' })
 * });
 * ```
 */
export function createMockRepository<T extends ObjectLiteral>(
  queryBuilderOverrides?: Partial<SelectQueryBuilder<T>>,
  repositoryOverrides?: Partial<Repository<T>>,
): MockRepository<T> {
  const mockQueryBuilder = createMockQueryBuilder<T>(queryBuilderOverrides);
  const mockManager = createMockEntityManager();

  const mockRepository = {
    // Find methods
    find: jest.fn().mockResolvedValue([]),
    findBy: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    findOneOrFail: jest.fn().mockResolvedValue({}),
    findOneByOrFail: jest.fn().mockResolvedValue({}),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    findAndCountBy: jest.fn().mockResolvedValue([[], 0]),

    // Persistence methods
    save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    insert: jest.fn().mockResolvedValue({
      identifiers: [],
      generatedMaps: [],
      raw: [],
    } as InsertResult),
    update: jest.fn().mockResolvedValue({
      affected: 1,
      raw: [],
      generatedMaps: [],
    } as UpdateResult),
    upsert: jest.fn().mockResolvedValue({
      identifiers: [],
      generatedMaps: [],
      raw: [],
    } as InsertResult),
    delete: jest.fn().mockResolvedValue({
      affected: 1,
      raw: [],
    } as DeleteResult),
    softDelete: jest.fn().mockResolvedValue({
      affected: 1,
      raw: [],
      generatedMaps: [],
    } as UpdateResult),
    restore: jest.fn().mockResolvedValue({
      affected: 1,
      raw: [],
      generatedMaps: [],
    } as UpdateResult),
    remove: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    softRemove: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    recover: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),

    // Entity creation/manipulation
    create: jest.fn().mockImplementation((entityLike) => entityLike || {}),
    merge: jest.fn().mockImplementation((...entities) => Object.assign({}, ...entities)),
    preload: jest.fn().mockResolvedValue(null),

    // Counting methods
    count: jest.fn().mockResolvedValue(0),
    countBy: jest.fn().mockResolvedValue(0),
    sum: jest.fn().mockResolvedValue(0),
    average: jest.fn().mockResolvedValue(0),
    minimum: jest.fn().mockResolvedValue(0),
    maximum: jest.fn().mockResolvedValue(0),

    // Existence methods
    exist: jest.fn().mockResolvedValue(false),
    exists: jest.fn().mockResolvedValue(false),
    existsBy: jest.fn().mockResolvedValue(false),

    // Increment/Decrement
    increment: jest.fn().mockResolvedValue({
      affected: 1,
      raw: [],
      generatedMaps: [],
    } as UpdateResult),
    decrement: jest.fn().mockResolvedValue({
      affected: 1,
      raw: [],
      generatedMaps: [],
    } as UpdateResult),

    // Query builder
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),

    // Raw query
    query: jest.fn().mockResolvedValue([]),

    // Clear
    clear: jest.fn().mockResolvedValue(undefined),

    // Manager
    manager: mockManager,

    // Metadata (commonly accessed in some tests)
    metadata: {
      name: 'MockEntity',
      tableName: 'mock_entity',
      columns: [],
      relations: [],
      primaryColumns: [],
      connection: {},
    },

    // Target (entity class)
    target: class MockEntity {},

    // ID methods
    hasId: jest.fn().mockReturnValue(true),
    getId: jest.fn().mockReturnValue('mock-id'),

    // Apply overrides
    ...repositoryOverrides,
  } as unknown as MockRepository<T>;

  return mockRepository;
}

/**
 * Helper to reset all mocks in a repository to their default state.
 * Useful in beforeEach/afterEach blocks.
 *
 * @param repository - The mock repository to reset
 */
export function resetMockRepository<T extends ObjectLiteral>(
  repository: MockRepository<T>,
): void {
  Object.keys(repository).forEach((key) => {
    const value = (repository as any)[key];
    if (typeof value === 'function' && 'mockReset' in value) {
      value.mockReset();
    }
  });
}

/**
 * Helper to configure a mock repository to return specific data for common operations.
 *
 * @param repository - The mock repository to configure
 * @param config - Configuration for common operations
 */
export function configureMockRepository<T extends ObjectLiteral>(
  repository: MockRepository<T>,
  config: {
    findResult?: T[];
    findOneResult?: T | null;
    findAndCountResult?: [T[], number];
    countResult?: number;
    saveResult?: T | T[];
  },
): void {
  if (config.findResult !== undefined) {
    repository.find.mockResolvedValue(config.findResult);
    repository.findBy.mockResolvedValue(config.findResult);
  }

  if (config.findOneResult !== undefined) {
    repository.findOne.mockResolvedValue(config.findOneResult);
    repository.findOneBy.mockResolvedValue(config.findOneResult);
  }

  if (config.findAndCountResult !== undefined) {
    repository.findAndCount.mockResolvedValue(config.findAndCountResult);
    repository.findAndCountBy.mockResolvedValue(config.findAndCountResult);
  }

  if (config.countResult !== undefined) {
    repository.count.mockResolvedValue(config.countResult);
    repository.countBy.mockResolvedValue(config.countResult);
  }

  if (config.saveResult !== undefined) {
    repository.save.mockResolvedValue(config.saveResult as any);
  }
}

/**
 * Helper to configure a mock query builder to return specific data.
 *
 * @param queryBuilder - The mock query builder to configure
 * @param config - Configuration for query builder results
 */
export function configureMockQueryBuilder<T extends ObjectLiteral>(
  queryBuilder: MockSelectQueryBuilder<T>,
  config: {
    getManyResult?: T[];
    getOneResult?: T | null;
    getManyAndCountResult?: [T[], number];
    getCountResult?: number;
    getRawManyResult?: any[];
    getRawOneResult?: any;
    executeResult?: { affected?: number; raw?: any[] };
  },
): void {
  if (config.getManyResult !== undefined) {
    queryBuilder.getMany.mockResolvedValue(config.getManyResult);
  }

  if (config.getOneResult !== undefined) {
    queryBuilder.getOne.mockResolvedValue(config.getOneResult);
  }

  if (config.getManyAndCountResult !== undefined) {
    queryBuilder.getManyAndCount.mockResolvedValue(config.getManyAndCountResult);
  }

  if (config.getCountResult !== undefined) {
    queryBuilder.getCount.mockResolvedValue(config.getCountResult);
  }

  if (config.getRawManyResult !== undefined) {
    queryBuilder.getRawMany.mockResolvedValue(config.getRawManyResult);
  }

  if (config.getRawOneResult !== undefined) {
    queryBuilder.getRawOne.mockResolvedValue(config.getRawOneResult);
  }

  if (config.executeResult !== undefined) {
    queryBuilder.execute.mockResolvedValue(config.executeResult);
  }
}

/**
 * Type representing a complete query builder chain with access to all specialized builders
 */
export interface QueryBuilderChain<T extends ObjectLiteral> {
  selectQueryBuilder: MockSelectQueryBuilder<T>;
  insertQueryBuilder: jest.Mocked<InsertQueryBuilder<T>>;
  updateQueryBuilder: jest.Mocked<UpdateQueryBuilder<T>>;
  deleteQueryBuilder: jest.Mocked<DeleteQueryBuilder<T>>;
}

/**
 * Creates a complete query builder chain where all transition methods
 * (delete, update, insert) return pre-configured specialized builders.
 * This is useful for testing complex query chains that involve multiple builder types.
 *
 * @param overrides - Optional overrides for the SelectQueryBuilder
 * @returns An object containing all query builder mocks for easy configuration
 *
 * @example
 * ```typescript
 * const chain = createQueryBuilderChain<User>();
 *
 * // Configure the delete builder
 * chain.deleteQueryBuilder.execute.mockResolvedValue({ affected: 5, raw: [] });
 *
 * // Configure the select builder to return the chain's delete builder
 * chain.selectQueryBuilder.delete.mockReturnValue(chain.deleteQueryBuilder);
 *
 * // Use in tests
 * repository.createQueryBuilder.mockReturnValue(chain.selectQueryBuilder);
 * ```
 */
export function createQueryBuilderChain<T extends ObjectLiteral>(
  overrides?: Partial<SelectQueryBuilder<T>>,
): QueryBuilderChain<T> {
  const insertQueryBuilder = createMockInsertQueryBuilder<T>();
  const updateQueryBuilder = createMockUpdateQueryBuilder<T>();
  const deleteQueryBuilder = createMockDeleteQueryBuilder<T>();

  const selectQueryBuilder = createMockQueryBuilder<T>({
    ...overrides,
  });

  // Wire up the transition methods to return the specialized builders
  selectQueryBuilder.delete = jest.fn().mockReturnValue(deleteQueryBuilder);
  selectQueryBuilder.update = jest.fn().mockReturnValue(updateQueryBuilder);
  selectQueryBuilder.insert = jest.fn().mockReturnValue(insertQueryBuilder);

  return {
    selectQueryBuilder,
    insertQueryBuilder,
    updateQueryBuilder,
    deleteQueryBuilder,
  };
}

/**
 * Helper to reset all mocks in a query builder chain.
 *
 * @param chain - The query builder chain to reset
 */
export function resetQueryBuilderChain<T extends ObjectLiteral>(
  chain: QueryBuilderChain<T>,
): void {
  const resetBuilder = (builder: any) => {
    Object.keys(builder).forEach((key) => {
      const value = builder[key];
      if (typeof value === 'function' && 'mockReset' in value) {
        value.mockReset();
      }
    });
  };

  resetBuilder(chain.selectQueryBuilder);
  resetBuilder(chain.insertQueryBuilder);
  resetBuilder(chain.updateQueryBuilder);
  resetBuilder(chain.deleteQueryBuilder);
}

/**
 * Helper to reset all mocks in a query builder to their default state.
 *
 * @param queryBuilder - The mock query builder to reset
 */
export function resetMockQueryBuilder<T extends ObjectLiteral>(
  queryBuilder: MockSelectQueryBuilder<T>,
): void {
  Object.keys(queryBuilder).forEach((key) => {
    const value = (queryBuilder as any)[key];
    if (typeof value === 'function' && 'mockReset' in value) {
      value.mockReset();
    }
  });
}
