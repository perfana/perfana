import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmBaseRepository } from '../common/repositories/typeorm-base.repository';
import { ExpectedConfigChange } from '@perfana/shared/entities';
import { DatabaseException } from '../common/exceptions/business.exception';

@Injectable()
export class ExpectedConfigChangeRepository extends TypeOrmBaseRepository<ExpectedConfigChange> {
  constructor(
    @InjectRepository(ExpectedConfigChange)
    repository: Repository<ExpectedConfigChange>,
  ) {
    super(repository, 'ExpectedConfigChange');
  }

  /**
   * Find expected config changes by system, environment, and workload
   */
  async findByContext(
    systemId: string,
    environment: string,
    workload: string
  ): Promise<ExpectedConfigChange[]> {
    try {
      return await this.repository.find({
        where: {
          system_under_test_id: systemId,
          test_environment: environment,
          workload: workload
        },
        order: { config_key: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find expected config changes by context:', error);
      throw new DatabaseException('Failed to retrieve expected config changes', error);
    }
  }

  /**
   * Find expected config change by specific key in context
   */
  async findByConfigKey(
    systemId: string,
    environment: string,
    workload: string,
    configKey: string
  ): Promise<ExpectedConfigChange | null> {
    return await this.findOne({
      where: {
        system_under_test_id: systemId,
        test_environment: environment,
        workload: workload,
        config_key: configKey
      }
    });
  }

  /**
   * Find all expected changes for a system
   */
  async findBySystemId(systemId: string): Promise<ExpectedConfigChange[]> {
    try {
      return await this.repository.find({
        where: { system_under_test_id: systemId },
        relations: ['system_under_test'],
        order: { test_environment: 'ASC', workload: 'ASC', config_key: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find expected config changes by system:', error);
      throw new DatabaseException('Failed to retrieve expected config changes', error);
    }
  }

  /**
   * Find expected changes for a specific environment across all systems
   */
  async findByEnvironment(environment: string): Promise<ExpectedConfigChange[]> {
    try {
      return await this.repository.find({
        where: { test_environment: environment },
        relations: ['system_under_test'],
        order: { system_under_test_id: 'ASC', workload: 'ASC', config_key: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find expected config changes by environment:', error);
      throw new DatabaseException('Failed to retrieve expected config changes', error);
    }
  }

  /**
   * Bulk create expected config changes
   */
  async createMany(changes: Partial<ExpectedConfigChange>[]): Promise<ExpectedConfigChange[]> {
    try {
      const entities = this.repository.create(changes);
      return await this.repository.save(entities);
    } catch (error) {
      this.logger.error('Failed to bulk create expected config changes:', error);
      throw new DatabaseException('Failed to create expected config changes', error);
    }
  }

  /**
   * Delete all expected changes for a system
   */
  async deleteBySystemId(systemId: string): Promise<number> {
    try {
      const result = await this.repository.createQueryBuilder()
        .delete()
        .where('system_under_test_id = :systemId', { systemId })
        .execute();

      this.logger.log(`Deleted ${result.affected} expected config changes for system ${systemId}`);
      return result.affected || 0;
    } catch (error) {
      this.logger.error('Failed to delete expected config changes:', error);
      throw new DatabaseException('Failed to delete expected config changes', error);
    }
  }

  /**
   * Delete expected changes by context
   */
  async deleteByContext(
    systemId: string,
    environment: string,
    workload: string
  ): Promise<number> {
    try {
      const result = await this.repository.createQueryBuilder()
        .delete()
        .where('system_under_test_id = :systemId', { systemId })
        .andWhere('test_environment = :environment', { environment })
        .andWhere('workload = :workload', { workload })
        .execute();

      this.logger.log(`Deleted ${result.affected} expected config changes for context`);
      return result.affected || 0;
    } catch (error) {
      this.logger.error('Failed to delete expected config changes by context:', error);
      throw new DatabaseException('Failed to delete expected config changes', error);
    }
  }

  /**
   * Get unique environments with expected changes
   */
  async getUniqueEnvironments(): Promise<string[]> {
    try {
      const results = await this.repository.createQueryBuilder('ecc')
        .select('DISTINCT ecc.test_environment', 'environment')
        .orderBy('ecc.test_environment', 'ASC')
        .getRawMany();

      return results.map(r => r.environment);
    } catch (error) {
      this.logger.error('Failed to get unique environments:', error);
      throw new DatabaseException('Failed to retrieve unique environments', error);
    }
  }

  /**
   * Get unique workloads for a system and environment
   */
  async getUniqueWorkloads(systemId: string, environment: string): Promise<string[]> {
    try {
      const results = await this.repository.createQueryBuilder('ecc')
        .select('DISTINCT ecc.workload', 'workload')
        .where('ecc.system_under_test_id = :systemId', { systemId })
        .andWhere('ecc.test_environment = :environment', { environment })
        .orderBy('ecc.workload', 'ASC')
        .getRawMany();

      return results.map(r => r.workload);
    } catch (error) {
      this.logger.error('Failed to get unique workloads:', error);
      throw new DatabaseException('Failed to retrieve unique workloads', error);
    }
  }
}
