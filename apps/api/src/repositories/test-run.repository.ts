import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, IsNull, Not } from 'typeorm';
import { TypeOrmBaseRepository } from '../common/repositories/typeorm-base.repository';
import { TestRun } from '@perfana/shared/entities';
import { DatabaseException, ValidationException } from '../common/exceptions/business.exception';
import { TestRunStatus } from '@perfana/shared/types';

export interface TestRunFilters {
  systemUnderTestId?: string;
  testEnvironment?: string;
  workload?: string;
  completed?: boolean;
  valid?: boolean;
  tags?: string[];
  startDateFrom?: Date;
  startDateTo?: Date;
  limit?: number;
  offset?: number;
}

export interface TestRunStats {
  systemId: string;
  totalRuns: number;
  completedRuns: number;
  avgDuration: number;
  p95Duration: number;
}

export interface TestRunEnvironmentGroup {
  environment: string;
  count: number;
  avgDuration: number | null;
}

@Injectable()
export class TestRunRepository extends TypeOrmBaseRepository<TestRun> {
  constructor(
    @InjectRepository(TestRun)
    repository: Repository<TestRun>,
  ) {
    super(repository, 'TestRun');
  }

  /**
   * Find all test runs with system under test information
   */
  async findAllWithSystem(filters?: TestRunFilters): Promise<TestRun[]> {
    try {
      const queryBuilder = this.repository.createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'system')
        .orderBy('tr.createdAt', 'DESC');

      if (filters?.systemUnderTestId) {
        queryBuilder.andWhere('tr.systemUnderTestId = :systemId', {
          systemId: filters.systemUnderTestId
        });
      }

      if (filters?.testEnvironment) {
        queryBuilder.andWhere('tr.testEnvironment = :env', {
          env: filters.testEnvironment
        });
      }

      if (filters?.workload) {
        queryBuilder.andWhere('tr.workload = :workload', {
          workload: filters.workload
        });
      }

      if (filters?.completed !== undefined) {
        queryBuilder.andWhere('tr.completed = :completed', {
          completed: filters.completed
        });
      }

      if (filters?.valid !== undefined) {
        queryBuilder.andWhere('tr.valid = :valid', {
          valid: filters.valid
        });
      }

      if (filters?.tags && filters.tags.length > 0) {
        queryBuilder.andWhere('tr.tags IS NOT NULL AND tr.tags && ARRAY[:...tags]::varchar[]', {
          tags: filters.tags
        });
      }

      if (filters?.startDateFrom) {
        queryBuilder.andWhere('tr.startTime >= :startFrom', {
          startFrom: filters.startDateFrom
        });
      }

      if (filters?.startDateTo) {
        queryBuilder.andWhere('tr.startTime <= :startTo', {
          startTo: filters.startDateTo
        });
      }

      if (filters?.limit) {
        queryBuilder.limit(filters.limit);
      }

      if (filters?.offset) {
        queryBuilder.offset(filters.offset);
      }

      return await queryBuilder.getMany();
    } catch (error) {
      this.logger.error('Failed to find test runs with system:', error);
      throw new DatabaseException('Failed to retrieve test runs', error);
    }
  }

  /**
   * Find a test run by test_run_id
   */
  async findByTestRunId(testRunId: string): Promise<TestRun | null> {
    return await this.findOne({
      where: { testRunId },
      relations: ['systemUnderTest', 'configurations']
    });
  }

  /**
   * Find test runs by system, environment, and workload
   */
  async findByContext(
    systemId: string,
    environment: string,
    workload: string,
  ): Promise<TestRun[]> {
    return await this.findBy({
      systemUnderTestId: systemId,
      testEnvironment: environment,
      workload: workload,
    });
  }

  /**
   * Find running (not completed) test runs
   */
  async findRunning(): Promise<TestRun[]> {
    return await this.repository.find({
      where: { completed: false },
      relations: ['systemUnderTest'],
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Find test runs by date range
   */
  async findByDateRange(startDate: Date, endDate: Date): Promise<TestRun[]> {
    return await this.repository.find({
      where: {
        startTime: Between(startDate, endDate)
      },
      relations: ['systemUnderTest'],
      order: { startTime: 'ASC' }
    });
  }

  /**
   * Find test runs with specific tags
   */
  async findByTags(tags: string[]): Promise<TestRun[]> {
    try {
      // Return empty array if tags is null or empty
      if (!tags || tags.length === 0) {
        return [];
      }

      return await this.repository.createQueryBuilder('tr')
        .where('tr.tags IS NOT NULL AND tr.tags && ARRAY[:...tags]::varchar[]', { tags })
        .leftJoinAndSelect('tr.systemUnderTest', 'system')
        .orderBy('tr.createdAt', 'DESC')
        .getMany();
    } catch (error) {
      this.logger.error('Failed to find test runs by tags:', error);
      throw new DatabaseException('Failed to retrieve test runs', error);
    }
  }

  /**
   * Find expired test runs
   */
  async findExpired(): Promise<TestRun[]> {
    return await this.repository.find({
      where: {
        expires: Not(IsNull()),
        expired: true
      },
      order: { expires: 'DESC' }
    });
  }

  /**
   * Get test run statistics by system
   */
  async getStatsBySystem(systemIds?: string[]): Promise<TestRunStats[]> {
    try {
      const queryBuilder = this.repository.createQueryBuilder('tr')
        .select('tr.systemUnderTestId', 'systemId')
        .addSelect('COUNT(tr.id)::int', 'totalRuns')
        .addSelect('COUNT(CASE WHEN tr.completed = true THEN 1 END)::int', 'completedRuns')
        .addSelect('AVG(tr.duration)::float', 'avgDuration')
        .addSelect('PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY tr.duration)::float', 'p95Duration')
        .where('tr.duration IS NOT NULL')
        .groupBy('tr.systemUnderTestId');

      if (systemIds && systemIds.length > 0) {
        queryBuilder.andWhere('tr.systemUnderTestId IN (:...systemIds)', { systemIds });
      }

      return await queryBuilder.getRawMany();
    } catch (error) {
      this.logger.error('Failed to get test run stats:', error);
      throw new DatabaseException('Failed to retrieve test run statistics', error);
    }
  }

  /**
   * Get latest test run per system using DISTINCT ON for better performance
   */
  async getLatestPerSystem(systemIds?: string[]): Promise<TestRun[]> {
    try {
      const queryBuilder = this.repository.createQueryBuilder('tr')
        .distinctOn(['tr.systemUnderTestId'])
        .leftJoinAndSelect('tr.systemUnderTest', 'system')
        .orderBy('tr.systemUnderTestId', 'ASC')
        .addOrderBy('tr.createdAt', 'DESC');

      if (systemIds && systemIds.length > 0) {
        queryBuilder.where('tr.systemUnderTestId IN (:...systemIds)', { systemIds });
      }

      return await queryBuilder.getMany();
    } catch (error) {
      this.logger.error('Failed to get latest test runs per system:', error);
      throw new DatabaseException('Failed to retrieve latest test runs', error);
    }
  }

  /**
   * Search test runs by keyword
   */
  async search(searchTerm: string, limit = 50): Promise<TestRun[]> {
    try {
      return await this.repository.createQueryBuilder('tr')
        .leftJoinAndSelect('tr.systemUnderTest', 'system')
        .where(
          '(tr.testRunId ILIKE :search OR system.name ILIKE :search OR tr.testEnvironment ILIKE :search OR tr.workload ILIKE :search)',
          { search: `%${searchTerm}%` }
        )
        .orderBy('tr.createdAt', 'DESC')
        .limit(limit)
        .getMany();
    } catch (error) {
      this.logger.error('Failed to search test runs:', error);
      throw new DatabaseException('Failed to search test runs', error);
    }
  }

  /**
   * Mark test run as completed
   */
  async markCompleted(id: string, endTime: Date, duration: number): Promise<TestRun> {
    const updateData: Partial<TestRun> = {
      completed: true,
      endTime,
      duration,
    };
    return await this.update(id, updateData);
  }

  /**
   * Mark test run as aborted
   */
  async markAborted(id: string): Promise<TestRun> {
    const updateData: Partial<TestRun> = {
      abort: true,
      completed: true,
      endTime: new Date(),
    };
    return await this.update(id, updateData);
  }

  /**
   * Update test run status
   */
  async updateStatus(id: string, status: TestRunStatus): Promise<TestRun> {
    const updateData: Partial<TestRun> = { status };
    return await this.update(id, updateData);
  }

  /**
   * Get test runs grouped by environment
   */
  async groupByEnvironment(systemId?: string): Promise<TestRunEnvironmentGroup[]> {
    try {
      const queryBuilder = this.repository.createQueryBuilder('tr')
        .select('tr.testEnvironment', 'environment')
        .addSelect('COUNT(tr.id)::int', 'count')
        .addSelect('AVG(tr.duration)::float', 'avgDuration')
        .groupBy('tr.testEnvironment')
        .orderBy('count', 'DESC');

      if (systemId) {
        queryBuilder.where('tr.systemUnderTestId = :systemId', { systemId });
      }

      return await queryBuilder.getRawMany();
    } catch (error) {
      this.logger.error('Failed to group test runs by environment:', error);
      throw new DatabaseException('Failed to group test runs', error);
    }
  }

  /**
   * Delete test runs older than a specific date
   */
  async deleteOlderThan(date: Date): Promise<number> {
    try {
      const result = await this.repository.createQueryBuilder()
        .delete()
        .where('createdAt < :date', { date })
        .execute();

      this.logger.log(`Deleted ${result.affected} test runs older than ${date.toISOString()}`);
      return result.affected || 0;
    } catch (error) {
      this.logger.error('Failed to delete old test runs:', error);
      throw new DatabaseException('Failed to delete test runs', error);
    }
  }

  /**
   * Find test runs with JSONB field conditions
   *
   * @param fieldName - The status field name to query. Must be one of the allowed fields.
   * @param fieldValue - The value to match against the field
   * @returns Test runs matching the status field condition
   * @throws ValidationException if fieldName is not in the allowed list
   *
   * Allowed status fields:
   * - evaluatingAdapt: ADAPT evaluation status
   */
  async findByStatusField(fieldName: string, fieldValue: string | number | boolean | null): Promise<TestRun[]> {
    // Whitelist of allowed JSONB status fields to prevent SQL injection
    const allowedFields = ['evaluatingAdapt'] as const;

    if (!allowedFields.includes(fieldName as any)) {
      throw new ValidationException(
        `Invalid status field: '${fieldName}'. Allowed fields: ${allowedFields.join(', ')}`
      );
    }

    try {
      return await this.repository.createQueryBuilder('tr')
        .where(`tr.status->>'${fieldName}' = :value`, { value: String(fieldValue) })
        .leftJoinAndSelect('tr.systemUnderTest', 'system')
        .getMany();
    } catch (error) {
      this.logger.error('Failed to find test runs by status field:', error);
      throw new DatabaseException('Failed to retrieve test runs', error);
    }
  }

  /**
   * Get test run count by workload
   */
  async countByWorkload(systemId: string, environment: string): Promise<Map<string, number>> {
    try {
      const results = await this.repository.createQueryBuilder('tr')
        .select('tr.workload', 'workload')
        .addSelect('COUNT(tr.id)::int', 'count')
        .where('tr.systemUnderTestId = :systemId', { systemId })
        .andWhere('tr.testEnvironment = :environment', { environment })
        .groupBy('tr.workload')
        .getRawMany();

      const map = new Map<string, number>();
      results.forEach(r => map.set(r.workload, Number(r.count)));
      return map;
    } catch (error) {
      this.logger.error('Failed to count test runs by workload:', error);
      throw new DatabaseException('Failed to count test runs', error);
    }
  }
}
