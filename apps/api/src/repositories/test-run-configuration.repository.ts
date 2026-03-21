import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmBaseRepository } from '../common/repositories/typeorm-base.repository';
import { TestRunConfiguration } from '@perfana/shared/entities';
import { DatabaseException } from '../common/exceptions/business.exception';

@Injectable()
export class TestRunConfigurationRepository extends TypeOrmBaseRepository<TestRunConfiguration> {
  constructor(
    @InjectRepository(TestRunConfiguration)
    repository: Repository<TestRunConfiguration>,
  ) {
    super(repository, 'TestRunConfiguration');
  }

  /**
   * Find all configurations for a test run
   */
  async findByTestRunId(testRunId: string): Promise<TestRunConfiguration[]> {
    try {
      return await this.repository.find({
        where: { testRunId },
        order: { key: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find configurations by test run ID:', error);
      throw new DatabaseException('Failed to retrieve test run configurations', error);
    }
  }

  /**
   * Find all configurations for a test run by test_run_id string
   */
  async findByTestRunIdString(testRunIdString: string): Promise<TestRunConfiguration[]> {
    try {
      return await this.repository.find({
        where: { testRunIdString },
        order: { key: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find configurations by test run ID string:', error);
      throw new DatabaseException('Failed to retrieve test run configurations', error);
    }
  }

  /**
   * Find configuration by key for a specific test run
   */
  async findByKey(testRunId: string, key: string): Promise<TestRunConfiguration | null> {
    return await this.findOne({
      where: { testRunId, key }
    });
  }

  /**
   * Find configurations by tags
   */
  async findByTags(tags: string[]): Promise<TestRunConfiguration[]> {
    try {
      return await this.repository.createQueryBuilder('config')
        .where('config.tags && ARRAY[:...tags]::varchar[]', { tags })
        .orderBy('config.createdAt', 'DESC')
        .getMany();
    } catch (error) {
      this.logger.error('Failed to find configurations by tags:', error);
      throw new DatabaseException('Failed to retrieve test run configurations', error);
    }
  }

  /**
   * Bulk create configurations
   */
  async createMany(configs: Partial<TestRunConfiguration>[]): Promise<TestRunConfiguration[]> {
    try {
      const entities = this.repository.create(configs);
      return await this.repository.save(entities);
    } catch (error) {
      this.logger.error('Failed to bulk create configurations:', error);
      throw new DatabaseException('Failed to create test run configurations', error);
    }
  }

  /**
   * Delete all configurations for a test run
   */
  async deleteByTestRunId(testRunId: string): Promise<number> {
    try {
      const result = await this.repository.createQueryBuilder()
        .delete()
        .where('testRunId = :testRunId', { testRunId })
        .execute();

      this.logger.log(`Deleted ${result.affected} configurations for test run ${testRunId}`);
      return result.affected || 0;
    } catch (error) {
      this.logger.error('Failed to delete configurations:', error);
      throw new DatabaseException('Failed to delete test run configurations', error);
    }
  }

  /**
   * Search configurations by key pattern
   */
  async searchByKeyPattern(pattern: string, limit = 50): Promise<TestRunConfiguration[]> {
    try {
      return await this.repository.createQueryBuilder('config')
        .where('config.key ILIKE :pattern', { pattern: `%${pattern}%` })
        .orderBy('config.createdAt', 'DESC')
        .limit(limit)
        .getMany();
    } catch (error) {
      this.logger.error('Failed to search configurations:', error);
      throw new DatabaseException('Failed to search test run configurations', error);
    }
  }

  /**
   * Get unique configuration keys
   */
  async getUniqueKeys(): Promise<string[]> {
    try {
      const results = await this.repository.createQueryBuilder('config')
        .select('DISTINCT config.key', 'key')
        .orderBy('config.key', 'ASC')
        .getRawMany();

      return results.map(r => r.key);
    } catch (error) {
      this.logger.error('Failed to get unique keys:', error);
      throw new DatabaseException('Failed to retrieve unique configuration keys', error);
    }
  }
}
