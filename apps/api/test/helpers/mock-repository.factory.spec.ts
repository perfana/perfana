/**
 * Unit tests for Mock Repository Factory
 *
 * Tests verify:
 * - createMockQueryBuilder creates complete SelectQueryBuilder mock with all methods
 * - createMockInsertQueryBuilder creates complete InsertQueryBuilder mock
 * - createMockUpdateQueryBuilder creates complete UpdateQueryBuilder mock
 * - createMockDeleteQueryBuilder creates complete DeleteQueryBuilder mock
 * - createMockEntityManager creates complete EntityManager mock
 * - createMockQueryRunner creates complete QueryRunner mock
 * - createMockRepository creates complete Repository mock with all methods
 * - Helper functions for reset and configuration work correctly
 * - Method chaining works correctly for QueryBuilder methods
 * - Overrides are properly applied to mocks
 */

import {
  createMockQueryBuilder,
  createMockInsertQueryBuilder,
  createMockUpdateQueryBuilder,
  createMockDeleteQueryBuilder,
  createMockEntityManager,
  createMockQueryRunner,
  createMockRepository,
  resetMockRepository,
  configureMockRepository,
  configureMockQueryBuilder,
  createQueryBuilderChain,
  resetQueryBuilderChain,
  resetMockQueryBuilder,
  MockRepository,
  MockSelectQueryBuilder,
} from './mock-repository.factory';

// Test entity type
interface TestEntity {
  id: string;
  name: string;
  value: number;
}

describe('Mock Repository Factory', () => {
  describe('createMockQueryBuilder', () => {
    it('should create a mock query builder', () => {
      const queryBuilder = createMockQueryBuilder<TestEntity>();

      expect(queryBuilder).toBeDefined();
      expect(typeof queryBuilder.getMany).toBe('function');
      expect(typeof queryBuilder.getOne).toBe('function');
    });

    describe('selection methods', () => {
      it('should have all selection methods that return this', () => {
        const qb = createMockQueryBuilder<TestEntity>();

        expect(qb.select()).toBe(qb);
        expect(qb.addSelect()).toBe(qb);
        expect(qb.distinctOn()).toBe(qb);
        expect(qb.distinct()).toBe(qb);
      });
    });

    describe('join methods', () => {
      it('should have all join methods that return this', () => {
        const qb = createMockQueryBuilder<TestEntity>();

        expect(qb.innerJoin()).toBe(qb);
        expect(qb.innerJoinAndSelect()).toBe(qb);
        expect(qb.innerJoinAndMapOne()).toBe(qb);
        expect(qb.innerJoinAndMapMany()).toBe(qb);
        expect(qb.leftJoin()).toBe(qb);
        expect(qb.leftJoinAndSelect()).toBe(qb);
        expect(qb.leftJoinAndMapOne()).toBe(qb);
        expect(qb.leftJoinAndMapMany()).toBe(qb);
        expect(qb.rightJoin()).toBe(qb);
        expect(qb.rightJoinAndSelect()).toBe(qb);
      });
    });

    describe('where clause methods', () => {
      it('should have all where methods that return this', () => {
        const qb = createMockQueryBuilder<TestEntity>();

        expect(qb.where()).toBe(qb);
        expect(qb.andWhere()).toBe(qb);
        expect(qb.orWhere()).toBe(qb);
        expect(qb.whereInIds()).toBe(qb);
        expect(qb.andWhereInIds()).toBe(qb);
        expect(qb.orWhereInIds()).toBe(qb);
        expect(qb.whereExists()).toBe(qb);
        expect(qb.andWhereExists()).toBe(qb);
        expect(qb.orWhereExists()).toBe(qb);
        expect(qb.whereNotExists()).toBe(qb);
        expect(qb.andWhereNotExists()).toBe(qb);
        expect(qb.orWhereNotExists()).toBe(qb);
      });

      it('should have bracket methods that return this', () => {
        const qb = createMockQueryBuilder<TestEntity>();

        expect(qb.andWhereBrackets()).toBe(qb);
        expect(qb.orWhereBrackets()).toBe(qb);
      });
    });

    describe('parameter methods', () => {
      it('should have parameter methods that return this', () => {
        const qb = createMockQueryBuilder<TestEntity>();

        expect(qb.setParameter()).toBe(qb);
        expect(qb.setParameters()).toBe(qb);
      });
    });

    describe('grouping and ordering methods', () => {
      it('should have grouping and ordering methods that return this', () => {
        const qb = createMockQueryBuilder<TestEntity>();

        expect(qb.groupBy()).toBe(qb);
        expect(qb.addGroupBy()).toBe(qb);
        expect(qb.having()).toBe(qb);
        expect(qb.andHaving()).toBe(qb);
        expect(qb.orHaving()).toBe(qb);
        expect(qb.orderBy()).toBe(qb);
        expect(qb.addOrderBy()).toBe(qb);
      });
    });

    describe('pagination methods', () => {
      it('should have pagination methods that return this', () => {
        const qb = createMockQueryBuilder<TestEntity>();

        expect(qb.skip()).toBe(qb);
        expect(qb.take()).toBe(qb);
        expect(qb.limit()).toBe(qb);
        expect(qb.offset()).toBe(qb);
      });
    });

    describe('result methods', () => {
      it('should have getMany that resolves to empty array by default', async () => {
        const qb = createMockQueryBuilder<TestEntity>();
        const result = await qb.getMany();
        expect(result).toEqual([]);
      });

      it('should have getOne that resolves to null by default', async () => {
        const qb = createMockQueryBuilder<TestEntity>();
        const result = await qb.getOne();
        expect(result).toBeNull();
      });

      it('should have getOneOrFail that rejects by default', async () => {
        const qb = createMockQueryBuilder<TestEntity>();
        await expect(qb.getOneOrFail()).rejects.toThrow('Entity not found');
      });

      it('should have getManyAndCount that resolves to empty array and zero', async () => {
        const qb = createMockQueryBuilder<TestEntity>();
        const result = await qb.getManyAndCount();
        expect(result).toEqual([[], 0]);
      });

      it('should have getCount that resolves to zero by default', async () => {
        const qb = createMockQueryBuilder<TestEntity>();
        const result = await qb.getCount();
        expect(result).toBe(0);
      });

      it('should have getExists that resolves to false by default', async () => {
        const qb = createMockQueryBuilder<TestEntity>();
        const result = await qb.getExists();
        expect(result).toBe(false);
      });

      it('should have getRawMany that resolves to empty array by default', async () => {
        const qb = createMockQueryBuilder<TestEntity>();
        const result = await qb.getRawMany();
        expect(result).toEqual([]);
      });

      it('should have getRawOne that resolves to null by default', async () => {
        const qb = createMockQueryBuilder<TestEntity>();
        const result = await qb.getRawOne();
        expect(result).toBeNull();
      });
    });

    describe('transition methods', () => {
      it('should have delete method that returns DeleteQueryBuilder', () => {
        const qb = createMockQueryBuilder<TestEntity>();
        const deleteQb = qb.delete();

        expect(deleteQb).toBeDefined();
        expect(typeof deleteQb.execute).toBe('function');
        expect(typeof deleteQb.where).toBe('function');
      });

      it('should have update method that returns UpdateQueryBuilder', () => {
        const qb = createMockQueryBuilder<TestEntity>();
        const updateQb = qb.update();

        expect(updateQb).toBeDefined();
        expect(typeof updateQb.execute).toBe('function');
        expect(typeof updateQb.set).toBe('function');
      });

      it('should have insert method that returns InsertQueryBuilder', () => {
        const qb = createMockQueryBuilder<TestEntity>();
        const insertQb = qb.insert();

        expect(insertQb).toBeDefined();
        expect(typeof insertQb.execute).toBe('function');
        expect(typeof insertQb.values).toBe('function');
      });
    });

    describe('other methods', () => {
      it('should have utility methods that return this', () => {
        const qb = createMockQueryBuilder<TestEntity>();

        expect(qb.withDeleted()).toBe(qb);
        expect(qb.cache()).toBe(qb);
        expect(qb.setLock()).toBe(qb);
        expect(qb.useTransaction()).toBe(qb);
        expect(qb.clone()).toBe(qb);
        expect(qb.printSql()).toBe(qb);
        expect(qb.setQueryRunner()).toBe(qb);
        expect(qb.comment()).toBe(qb);
        expect(qb.maxExecutionTime()).toBe(qb);
        expect(qb.disableEscaping()).toBe(qb);
      });

      it('should have query methods', () => {
        const qb = createMockQueryBuilder<TestEntity>();

        expect(qb.getQuery()).toBe('');
        expect(qb.getQueryAndParameters()).toEqual(['', []]);
        expect(qb.getSql()).toBe('');
      });
    });

    describe('method chaining', () => {
      it('should support full query chain', () => {
        const qb = createMockQueryBuilder<TestEntity>();

        const result = qb
          .select()
          .where('id = :id')
          .andWhere('name = :name')
          .orderBy('created_at', 'DESC')
          .skip(0)
          .take(10);

        expect(result).toBe(qb);
      });
    });

    describe('overrides', () => {
      it('should accept overrides for methods', async () => {
        const mockData: TestEntity[] = [
          { id: '1', name: 'Test', value: 100 },
        ];

        const qb = createMockQueryBuilder<TestEntity>({
          getMany: jest.fn().mockResolvedValue(mockData) as any,
        });

        const result = await qb.getMany();
        expect(result).toEqual(mockData);
      });
    });
  });

  describe('createMockInsertQueryBuilder', () => {
    it('should create insert query builder', () => {
      const insertQb = createMockInsertQueryBuilder<TestEntity>();

      expect(insertQb).toBeDefined();
      expect(typeof insertQb.into).toBe('function');
      expect(typeof insertQb.values).toBe('function');
      expect(typeof insertQb.execute).toBe('function');
    });

    it('should have chainable methods that return this', () => {
      const insertQb = createMockInsertQueryBuilder<TestEntity>();

      expect(insertQb.into()).toBe(insertQb);
      expect(insertQb.values()).toBe(insertQb);
      expect(insertQb.onConflict()).toBe(insertQb);
      expect(insertQb.orIgnore()).toBe(insertQb);
      expect(insertQb.orUpdate()).toBe(insertQb);
      expect(insertQb.updateEntity()).toBe(insertQb);
      expect(insertQb.returning()).toBe(insertQb);
      expect(insertQb.output()).toBe(insertQb);
    });

    it('should have execute that resolves to InsertResult', async () => {
      const insertQb = createMockInsertQueryBuilder<TestEntity>();
      const result = await insertQb.execute();

      expect(result).toHaveProperty('identifiers');
      expect(result).toHaveProperty('generatedMaps');
      expect(result).toHaveProperty('raw');
    });

    it('should accept overrides', async () => {
      const customResult = {
        identifiers: [{ id: '123' }],
        generatedMaps: [{ id: '123' }],
        raw: [],
      };

      const insertQb = createMockInsertQueryBuilder<TestEntity>({
        execute: jest.fn().mockResolvedValue(customResult) as any,
      });

      const result = await insertQb.execute();
      expect(result).toEqual(customResult);
    });
  });

  describe('createMockUpdateQueryBuilder', () => {
    it('should create update query builder', () => {
      const updateQb = createMockUpdateQueryBuilder<TestEntity>();

      expect(updateQb).toBeDefined();
      expect(typeof updateQb.update).toBe('function');
      expect(typeof updateQb.set).toBe('function');
      expect(typeof updateQb.execute).toBe('function');
    });

    it('should have chainable methods that return this', () => {
      const updateQb = createMockUpdateQueryBuilder<TestEntity>();

      expect(updateQb.update()).toBe(updateQb);
      expect(updateQb.set()).toBe(updateQb);
      expect(updateQb.where()).toBe(updateQb);
      expect(updateQb.andWhere()).toBe(updateQb);
      expect(updateQb.orWhere()).toBe(updateQb);
      expect(updateQb.returning()).toBe(updateQb);
      expect(updateQb.limit()).toBe(updateQb);
      expect(updateQb.orderBy()).toBe(updateQb);
    });

    it('should have execute that resolves to UpdateResult', async () => {
      const updateQb = createMockUpdateQueryBuilder<TestEntity>();
      const result = await updateQb.execute();

      expect(result).toHaveProperty('affected');
      expect(result).toHaveProperty('raw');
      expect(result.affected).toBe(1);
    });
  });

  describe('createMockDeleteQueryBuilder', () => {
    it('should create delete query builder', () => {
      const deleteQb = createMockDeleteQueryBuilder<TestEntity>();

      expect(deleteQb).toBeDefined();
      expect(typeof deleteQb.delete).toBe('function');
      expect(typeof deleteQb.from).toBe('function');
      expect(typeof deleteQb.execute).toBe('function');
    });

    it('should have chainable methods that return this', () => {
      const deleteQb = createMockDeleteQueryBuilder<TestEntity>();

      expect(deleteQb.delete()).toBe(deleteQb);
      expect(deleteQb.from()).toBe(deleteQb);
      expect(deleteQb.where()).toBe(deleteQb);
      expect(deleteQb.andWhere()).toBe(deleteQb);
      expect(deleteQb.orWhere()).toBe(deleteQb);
      expect(deleteQb.returning()).toBe(deleteQb);
      expect(deleteQb.limit()).toBe(deleteQb);
      expect(deleteQb.orderBy()).toBe(deleteQb);
    });

    it('should have execute that resolves to DeleteResult', async () => {
      const deleteQb = createMockDeleteQueryBuilder<TestEntity>();
      const result = await deleteQb.execute();

      expect(result).toHaveProperty('affected');
      expect(result).toHaveProperty('raw');
      expect(result.affected).toBe(1);
    });
  });

  describe('createMockEntityManager', () => {
    it('should create entity manager', () => {
      const manager = createMockEntityManager();

      expect(manager).toBeDefined();
      expect(typeof manager.find).toBe('function');
      expect(typeof manager.save).toBe('function');
      expect(typeof manager.transaction).toBe('function');
    });

    describe('find methods', () => {
      it('should have find methods with default values', async () => {
        const manager = createMockEntityManager();

        expect(await manager.find()).toEqual([]);
        expect(await manager.findOne()).toBeNull();
        expect(await manager.findOneBy()).toBeNull();
        expect(await manager.findBy()).toEqual([]);
        expect(await manager.findAndCount()).toEqual([[], 0]);
      });
    });

    describe('persistence methods', () => {
      it('should have save that returns the entity', async () => {
        const manager = createMockEntityManager();
        const entity = { id: '1', name: 'Test' };

        const result = await manager.save(entity);
        expect(result).toBe(entity);
      });

      it('should have insert/update/delete methods', async () => {
        const manager = createMockEntityManager();

        expect(await manager.insert()).toHaveProperty('identifiers');
        expect(await manager.update()).toHaveProperty('affected');
        expect(await manager.delete()).toHaveProperty('affected');
      });
    });

    describe('transaction method', () => {
      it('should execute callback with manager', async () => {
        const manager = createMockEntityManager();
        const callback = jest.fn().mockResolvedValue('result');

        const result = await manager.transaction(callback);

        expect(callback).toHaveBeenCalledWith(manager);
        expect(result).toBe('result');
      });

      it('should handle isolation level parameter', async () => {
        const manager = createMockEntityManager();
        const callback = jest.fn().mockResolvedValue('result');

        const result = await manager.transaction('READ COMMITTED', callback);

        expect(callback).toHaveBeenCalledWith(manager);
        expect(result).toBe('result');
      });
    });

    describe('createQueryBuilder method', () => {
      it('should return a mock query builder', () => {
        const manager = createMockEntityManager();
        const qb = manager.createQueryBuilder();

        expect(qb).toBeDefined();
        expect(typeof qb.getMany).toBe('function');
      });
    });

    it('should accept overrides', async () => {
      const customResult = [{ id: '1' }];
      const manager = createMockEntityManager({
        find: jest.fn().mockResolvedValue(customResult) as any,
      });

      const result = await manager.find();
      expect(result).toEqual(customResult);
    });
  });

  describe('createMockQueryRunner', () => {
    it('should create query runner', () => {
      const queryRunner = createMockQueryRunner();

      expect(queryRunner).toBeDefined();
      expect(typeof queryRunner.connect).toBe('function');
      expect(typeof queryRunner.startTransaction).toBe('function');
      expect(typeof queryRunner.commitTransaction).toBe('function');
      expect(typeof queryRunner.rollbackTransaction).toBe('function');
      expect(typeof queryRunner.release).toBe('function');
    });

    it('should have transaction methods that resolve', async () => {
      const queryRunner = createMockQueryRunner();

      await expect(queryRunner.connect()).resolves.toBeUndefined();
      await expect(queryRunner.startTransaction()).resolves.toBeUndefined();
      await expect(queryRunner.commitTransaction()).resolves.toBeUndefined();
      await expect(queryRunner.rollbackTransaction()).resolves.toBeUndefined();
      await expect(queryRunner.release()).resolves.toBeUndefined();
    });

    it('should have manager property', () => {
      const queryRunner = createMockQueryRunner();

      expect(queryRunner.manager).toBeDefined();
      expect(typeof queryRunner.manager.find).toBe('function');
    });

    it('should accept overrides', () => {
      const customManager = createMockEntityManager();
      const queryRunner = createMockQueryRunner({
        manager: customManager as any,
      });

      expect(queryRunner.manager).toBe(customManager);
    });
  });

  describe('createMockRepository', () => {
    it('should create a mock repository', () => {
      const repo = createMockRepository<TestEntity>();

      expect(repo).toBeDefined();
      expect(typeof repo.find).toBe('function');
      expect(typeof repo.save).toBe('function');
      expect(typeof repo.createQueryBuilder).toBe('function');
    });

    describe('find methods', () => {
      it('should have find methods with default values', async () => {
        const repo = createMockRepository<TestEntity>();

        expect(await repo.find()).toEqual([]);
        expect(await repo.findBy()).toEqual([]);
        expect(await repo.findOne()).toBeNull();
        expect(await repo.findOneBy()).toBeNull();
        expect(await repo.findAndCount()).toEqual([[], 0]);
        expect(await repo.findAndCountBy()).toEqual([[], 0]);
      });

      it('should have findOneOrFail that resolves to empty object', async () => {
        const repo = createMockRepository<TestEntity>();
        const result = await repo.findOneOrFail();
        expect(result).toEqual({});
      });
    });

    describe('persistence methods', () => {
      it('should have save that returns the entity', async () => {
        const repo = createMockRepository<TestEntity>();
        const entity: TestEntity = { id: '1', name: 'Test', value: 100 };

        const result = await repo.save(entity);
        expect(result).toBe(entity);
      });

      it('should have insert that resolves to InsertResult', async () => {
        const repo = createMockRepository<TestEntity>();
        const result = await repo.insert({} as any);

        expect(result).toHaveProperty('identifiers');
        expect(result).toHaveProperty('generatedMaps');
      });

      it('should have update that resolves to UpdateResult', async () => {
        const repo = createMockRepository<TestEntity>();
        const result = await repo.update('1', {});

        expect(result).toHaveProperty('affected');
        expect(result.affected).toBe(1);
      });

      it('should have delete that resolves to DeleteResult', async () => {
        const repo = createMockRepository<TestEntity>();
        const result = await repo.delete('1');

        expect(result).toHaveProperty('affected');
        expect(result.affected).toBe(1);
      });

      it('should have remove that returns the entity', async () => {
        const repo = createMockRepository<TestEntity>();
        const entity: TestEntity = { id: '1', name: 'Test', value: 100 };

        const result = await repo.remove(entity);
        expect(result).toBe(entity);
      });
    });

    describe('entity creation', () => {
      it('should have create that returns entity-like object', () => {
        const repo = createMockRepository<TestEntity>();
        const entity = repo.create({ id: '1', name: 'Test', value: 100 });

        expect(entity).toEqual({ id: '1', name: 'Test', value: 100 });
      });

      it('should have merge that combines entities', () => {
        const repo = createMockRepository<TestEntity>();
        const result = repo.merge(
          {} as any,
          { id: '1' } as TestEntity,
          { name: 'Test' } as TestEntity
        );

        expect(result).toEqual({ id: '1', name: 'Test' });
      });
    });

    describe('counting methods', () => {
      it('should have count methods with default zero', async () => {
        const repo = createMockRepository<TestEntity>();

        expect(await repo.count()).toBe(0);
        expect(await repo.countBy()).toBe(0);
        expect(await repo.sum()).toBe(0);
        expect(await repo.average()).toBe(0);
        expect(await repo.minimum()).toBe(0);
        expect(await repo.maximum()).toBe(0);
      });
    });

    describe('existence methods', () => {
      it('should have exist methods with default false', async () => {
        const repo = createMockRepository<TestEntity>();

        expect(await repo.exist()).toBe(false);
        expect(await repo.exists()).toBe(false);
        expect(await repo.existsBy()).toBe(false);
      });
    });

    describe('increment/decrement methods', () => {
      it('should have increment/decrement methods', async () => {
        const repo = createMockRepository<TestEntity>();

        const incrementResult = await repo.increment({}, 'value', 1);
        expect(incrementResult).toHaveProperty('affected');

        const decrementResult = await repo.decrement({}, 'value', 1);
        expect(decrementResult).toHaveProperty('affected');
      });
    });

    describe('createQueryBuilder method', () => {
      it('should return a mock query builder', () => {
        const repo = createMockRepository<TestEntity>();
        const qb = repo.createQueryBuilder();

        expect(qb).toBeDefined();
        expect(typeof qb.getMany).toBe('function');
        expect(typeof qb.where).toBe('function');
      });

      it('should return the same query builder on multiple calls', () => {
        const repo = createMockRepository<TestEntity>();
        const qb1 = repo.createQueryBuilder();
        const qb2 = repo.createQueryBuilder();

        // The mock returns the same instance
        expect(qb1).toBe(qb2);
      });
    });

    describe('manager property', () => {
      it('should have manager with entity manager methods', () => {
        const repo = createMockRepository<TestEntity>();

        expect(repo.manager).toBeDefined();
        expect(typeof repo.manager.transaction).toBe('function');
      });
    });

    describe('metadata property', () => {
      it('should have metadata with table information', () => {
        const repo = createMockRepository<TestEntity>();

        expect(repo.metadata).toBeDefined();
        expect(repo.metadata.name).toBe('MockEntity');
        expect(repo.metadata.tableName).toBe('mock_entity');
      });
    });

    describe('ID methods', () => {
      it('should have hasId that returns true by default', () => {
        const repo = createMockRepository<TestEntity>();
        expect(repo.hasId({} as TestEntity)).toBe(true);
      });

      it('should have getId that returns mock-id', () => {
        const repo = createMockRepository<TestEntity>();
        expect(repo.getId({} as TestEntity)).toBe('mock-id');
      });
    });

    describe('overrides', () => {
      it('should accept query builder overrides', async () => {
        const mockData: TestEntity[] = [
          { id: '1', name: 'Test', value: 100 },
        ];

        const repo = createMockRepository<TestEntity>({
          getMany: jest.fn().mockResolvedValue(mockData) as any,
        });

        const qb = repo.createQueryBuilder();
        const result = await qb.getMany();
        expect(result).toEqual(mockData);
      });

      it('should accept repository overrides', async () => {
        const mockData: TestEntity[] = [
          { id: '1', name: 'Test', value: 100 },
        ];

        const repo = createMockRepository<TestEntity>(
          {},
          {
            find: jest.fn().mockResolvedValue(mockData) as any,
          }
        );

        const result = await repo.find();
        expect(result).toEqual(mockData);
      });
    });
  });

  describe('resetMockRepository', () => {
    it('should reset all mock functions in repository', async () => {
      const repo = createMockRepository<TestEntity>();

      // Configure some mock return values
      repo.find.mockResolvedValue([{ id: '1', name: 'Test', value: 100 }]);
      repo.count.mockResolvedValue(5);

      // Verify they're set
      expect(await repo.find()).toEqual([{ id: '1', name: 'Test', value: 100 }]);
      expect(await repo.count()).toBe(5);

      // Reset
      resetMockRepository(repo);

      // Verify they're reset (returns undefined after reset)
      expect(repo.find.mock.calls.length).toBe(0);
      expect(repo.count.mock.calls.length).toBe(0);
    });

    it('should not throw for non-function properties', () => {
      const repo = createMockRepository<TestEntity>();

      expect(() => resetMockRepository(repo)).not.toThrow();
    });
  });

  describe('configureMockRepository', () => {
    it('should configure findResult', async () => {
      const repo = createMockRepository<TestEntity>();
      const mockData: TestEntity[] = [
        { id: '1', name: 'Test', value: 100 },
      ];

      configureMockRepository(repo, { findResult: mockData });

      expect(await repo.find()).toEqual(mockData);
      expect(await repo.findBy()).toEqual(mockData);
    });

    it('should configure findOneResult', async () => {
      const repo = createMockRepository<TestEntity>();
      const mockEntity: TestEntity = { id: '1', name: 'Test', value: 100 };

      configureMockRepository(repo, { findOneResult: mockEntity });

      expect(await repo.findOne()).toEqual(mockEntity);
      expect(await repo.findOneBy()).toEqual(mockEntity);
    });

    it('should configure findOneResult to null', async () => {
      const repo = createMockRepository<TestEntity>();

      configureMockRepository(repo, { findOneResult: null });

      expect(await repo.findOne()).toBeNull();
      expect(await repo.findOneBy()).toBeNull();
    });

    it('should configure findAndCountResult', async () => {
      const repo = createMockRepository<TestEntity>();
      const mockData: TestEntity[] = [
        { id: '1', name: 'Test', value: 100 },
      ];
      const mockResult: [TestEntity[], number] = [mockData, 1];

      configureMockRepository(repo, { findAndCountResult: mockResult });

      expect(await repo.findAndCount()).toEqual(mockResult);
      expect(await repo.findAndCountBy()).toEqual(mockResult);
    });

    it('should configure countResult', async () => {
      const repo = createMockRepository<TestEntity>();

      configureMockRepository(repo, { countResult: 42 });

      expect(await repo.count()).toBe(42);
      expect(await repo.countBy()).toBe(42);
    });

    it('should configure saveResult', async () => {
      const repo = createMockRepository<TestEntity>();
      const savedEntity: TestEntity = { id: '1', name: 'Saved', value: 200 };

      configureMockRepository(repo, { saveResult: savedEntity });

      expect(await repo.save({} as any)).toEqual(savedEntity);
    });

    it('should configure multiple values at once', async () => {
      const repo = createMockRepository<TestEntity>();
      const mockData: TestEntity[] = [
        { id: '1', name: 'Test', value: 100 },
      ];

      configureMockRepository(repo, {
        findResult: mockData,
        countResult: 1,
      });

      expect(await repo.find()).toEqual(mockData);
      expect(await repo.count()).toBe(1);
    });
  });

  describe('configureMockQueryBuilder', () => {
    it('should configure getManyResult', async () => {
      const qb = createMockQueryBuilder<TestEntity>();
      const mockData: TestEntity[] = [
        { id: '1', name: 'Test', value: 100 },
      ];

      configureMockQueryBuilder(qb, { getManyResult: mockData });

      expect(await qb.getMany()).toEqual(mockData);
    });

    it('should configure getOneResult', async () => {
      const qb = createMockQueryBuilder<TestEntity>();
      const mockEntity: TestEntity = { id: '1', name: 'Test', value: 100 };

      configureMockQueryBuilder(qb, { getOneResult: mockEntity });

      expect(await qb.getOne()).toEqual(mockEntity);
    });

    it('should configure getOneResult to null', async () => {
      const qb = createMockQueryBuilder<TestEntity>();

      configureMockQueryBuilder(qb, { getOneResult: null });

      expect(await qb.getOne()).toBeNull();
    });

    it('should configure getManyAndCountResult', async () => {
      const qb = createMockQueryBuilder<TestEntity>();
      const mockData: TestEntity[] = [
        { id: '1', name: 'Test', value: 100 },
      ];
      const mockResult: [TestEntity[], number] = [mockData, 1];

      configureMockQueryBuilder(qb, { getManyAndCountResult: mockResult });

      expect(await qb.getManyAndCount()).toEqual(mockResult);
    });

    it('should configure getCountResult', async () => {
      const qb = createMockQueryBuilder<TestEntity>();

      configureMockQueryBuilder(qb, { getCountResult: 42 });

      expect(await qb.getCount()).toBe(42);
    });

    it('should configure getRawManyResult', async () => {
      const qb = createMockQueryBuilder<TestEntity>();
      const rawData = [{ avg: 100 }, { avg: 200 }];

      configureMockQueryBuilder(qb, { getRawManyResult: rawData });

      expect(await qb.getRawMany()).toEqual(rawData);
    });

    it('should configure getRawOneResult', async () => {
      const qb = createMockQueryBuilder<TestEntity>();
      const rawData = { avg: 150 };

      configureMockQueryBuilder(qb, { getRawOneResult: rawData });

      expect(await qb.getRawOne()).toEqual(rawData);
    });

    it('should configure executeResult', async () => {
      const qb = createMockQueryBuilder<TestEntity>();

      configureMockQueryBuilder(qb, {
        executeResult: { affected: 5, raw: [] },
      });

      expect(await qb.execute()).toEqual({ affected: 5, raw: [] });
    });

    it('should configure multiple values at once', async () => {
      const qb = createMockQueryBuilder<TestEntity>();
      const mockData: TestEntity[] = [
        { id: '1', name: 'Test', value: 100 },
      ];

      configureMockQueryBuilder(qb, {
        getManyResult: mockData,
        getCountResult: 1,
      });

      expect(await qb.getMany()).toEqual(mockData);
      expect(await qb.getCount()).toBe(1);
    });
  });

  describe('createQueryBuilderChain', () => {
    it('should create a chain with all builder types', () => {
      const chain = createQueryBuilderChain<TestEntity>();

      expect(chain.selectQueryBuilder).toBeDefined();
      expect(chain.insertQueryBuilder).toBeDefined();
      expect(chain.updateQueryBuilder).toBeDefined();
      expect(chain.deleteQueryBuilder).toBeDefined();
    });

    it('should wire up delete transition correctly', () => {
      const chain = createQueryBuilderChain<TestEntity>();

      const deleteQb = chain.selectQueryBuilder.delete();

      expect(deleteQb).toBe(chain.deleteQueryBuilder);
    });

    it('should wire up update transition correctly', () => {
      const chain = createQueryBuilderChain<TestEntity>();

      const updateQb = chain.selectQueryBuilder.update();

      expect(updateQb).toBe(chain.updateQueryBuilder);
    });

    it('should wire up insert transition correctly', () => {
      const chain = createQueryBuilderChain<TestEntity>();

      const insertQb = chain.selectQueryBuilder.insert();

      expect(insertQb).toBe(chain.insertQueryBuilder);
    });

    it('should allow configuring specialized builders', async () => {
      const chain = createQueryBuilderChain<TestEntity>();

      chain.deleteQueryBuilder.execute.mockResolvedValue({
        affected: 10,
        raw: [],
      });

      const repo = createMockRepository<TestEntity>();
      repo.createQueryBuilder.mockReturnValue(chain.selectQueryBuilder);

      const qb = repo.createQueryBuilder();
      const result = await qb.delete().execute();

      expect(result.affected).toBe(10);
    });

    it('should accept overrides for select query builder', () => {
      const chain = createQueryBuilderChain<TestEntity>({
        alias: 'customAlias' as any,
      });

      expect(chain.selectQueryBuilder.alias).toBe('customAlias');
    });
  });

  describe('resetQueryBuilderChain', () => {
    it('should reset all builders in the chain', () => {
      const chain = createQueryBuilderChain<TestEntity>();

      // Configure mocks
      chain.selectQueryBuilder.getMany.mockResolvedValue([]);
      chain.deleteQueryBuilder.execute.mockResolvedValue({ affected: 5, raw: [] });
      chain.updateQueryBuilder.execute.mockResolvedValue({
        affected: 3,
        raw: [],
        generatedMaps: [],
      });
      chain.insertQueryBuilder.execute.mockResolvedValue({
        identifiers: [],
        generatedMaps: [],
        raw: [],
      });

      // Call the mocks
      chain.selectQueryBuilder.getMany();
      chain.deleteQueryBuilder.execute();
      chain.updateQueryBuilder.execute();
      chain.insertQueryBuilder.execute();

      // Verify calls were recorded
      expect(chain.selectQueryBuilder.getMany).toHaveBeenCalled();
      expect(chain.deleteQueryBuilder.execute).toHaveBeenCalled();
      expect(chain.updateQueryBuilder.execute).toHaveBeenCalled();
      expect(chain.insertQueryBuilder.execute).toHaveBeenCalled();

      // Reset
      resetQueryBuilderChain(chain);

      // Verify call counts are reset
      expect(chain.selectQueryBuilder.getMany.mock.calls.length).toBe(0);
      expect(chain.deleteQueryBuilder.execute.mock.calls.length).toBe(0);
      expect(chain.updateQueryBuilder.execute.mock.calls.length).toBe(0);
      expect(chain.insertQueryBuilder.execute.mock.calls.length).toBe(0);
    });
  });

  describe('resetMockQueryBuilder', () => {
    it('should reset all mock functions in query builder', () => {
      const qb = createMockQueryBuilder<TestEntity>();

      // Configure and call mocks
      qb.getMany.mockResolvedValue([]);
      qb.getMany();
      qb.where();
      qb.andWhere();

      // Verify calls were recorded
      expect(qb.getMany).toHaveBeenCalled();
      expect(qb.where).toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalled();

      // Reset
      resetMockQueryBuilder(qb);

      // Verify call counts are reset
      expect(qb.getMany.mock.calls.length).toBe(0);
      expect(qb.where.mock.calls.length).toBe(0);
      expect(qb.andWhere.mock.calls.length).toBe(0);
    });
  });

  describe('Type exports', () => {
    it('should export MockRepository type', () => {
      const repo: MockRepository<TestEntity> = createMockRepository<TestEntity>();
      expect(repo).toBeDefined();
    });

    it('should export MockSelectQueryBuilder type', () => {
      const qb: MockSelectQueryBuilder<TestEntity> = createMockQueryBuilder<TestEntity>();
      expect(qb).toBeDefined();
    });
  });

  describe('Integration scenarios', () => {
    it('should work with NestJS testing pattern', async () => {
      // Simulates how the factory would be used in a NestJS service test
      const mockRepo = createMockRepository<TestEntity>();
      const testData: TestEntity[] = [
        { id: '1', name: 'Item 1', value: 100 },
        { id: '2', name: 'Item 2', value: 200 },
      ];

      configureMockRepository(mockRepo, {
        findResult: testData,
        countResult: 2,
      });

      // Service would call these
      const items = await mockRepo.find();
      const count = await mockRepo.count();

      expect(items).toEqual(testData);
      expect(count).toBe(2);
    });

    it('should work with complex query builder chains', async () => {
      const mockRepo = createMockRepository<TestEntity>();
      const qb = mockRepo.createQueryBuilder();

      const testData: TestEntity = { id: '1', name: 'Found', value: 999 };
      configureMockQueryBuilder(qb as MockSelectQueryBuilder<TestEntity>, {
        getOneResult: testData,
      });

      // Service would build a query like this
      const result = await mockRepo
        .createQueryBuilder('entity')
        .where('entity.id = :id', { id: '1' })
        .andWhere('entity.value > :min', { min: 0 })
        .getOne();

      expect(result).toEqual(testData);
      expect(qb.where).toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalled();
    });

    it('should work with transaction testing', async () => {
      const mockRepo = createMockRepository<TestEntity>();
      const savedEntity: TestEntity = { id: '1', name: 'Saved', value: 100 };

      mockRepo.save.mockResolvedValue(savedEntity);

      // Service would do something like this
      const result = await mockRepo.manager.transaction(async (manager) => {
        return mockRepo.save({ name: 'New', value: 100 } as any);
      });

      expect(result).toEqual(savedEntity);
    });
  });
});
