import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { TypeOrmBaseRepository } from '../common/repositories/typeorm-base.repository';
import { withRequestEm } from '../common/db/request-em';
import { TracingService } from '@perfana/shared/entities';
import { DatabaseException } from '../common/exceptions/business.exception';

@Injectable()
export class TracingServiceRepository extends TypeOrmBaseRepository<TracingService> {
  constructor(
    @InjectRepository(TracingService)
    repository: Repository<TracingService>,
  ) {
    super(repository, 'TracingService');
  }

  /**
   * Find tracing service with hierarchical resolution
   *
   * Resolution order:
   * 1. Most specific: system + environment + workload
   * 2. Environment level: system + environment (workload IS NULL)
   * 3. System level: system only (environment IS NULL, workload IS NULL)
   *
   * Returns the first match found
   */
  async findWithHierarchy(
    systemId: string,
    environment?: string,
    workload?: string,
  ): Promise<TracingService | null> {
    try {
      // Try most specific first: system + environment + workload
      if (environment && workload) {
        const specificMatch = await withRequestEm(this.repository).createQueryBuilder('ts')
          .leftJoinAndSelect('ts.tracingInstance', 'ti')
          .where('ts.system_under_test_id = :systemId', { systemId })
          .andWhere('ts.test_environment = :environment', { environment })
          .andWhere('ts.workload = :workload', { workload })
          .getOne();

        if (specificMatch) {
          return specificMatch;
        }
      }

      // Try environment level: system + environment (workload IS NULL)
      if (environment) {
        const envMatch = await withRequestEm(this.repository).createQueryBuilder('ts')
          .leftJoinAndSelect('ts.tracingInstance', 'ti')
          .where('ts.system_under_test_id = :systemId', { systemId })
          .andWhere('ts.test_environment = :environment', { environment })
          .andWhere('ts.workload IS NULL')
          .getOne();

        if (envMatch) {
          return envMatch;
        }
      }

      // Fallback to system level: system only (environment IS NULL, workload IS NULL)
      const systemMatch = await withRequestEm(this.repository).createQueryBuilder('ts')
        .leftJoinAndSelect('ts.tracingInstance', 'ti')
        .where('ts.system_under_test_id = :systemId', { systemId })
        .andWhere('ts.test_environment IS NULL')
        .andWhere('ts.workload IS NULL')
        .getOne();

      return systemMatch;
    } catch (error) {
      this.logger.error('Failed to find tracing service with hierarchy:', error);
      throw new DatabaseException('Failed to retrieve tracing service', error);
    }
  }

  /**
   * Find all tracing services for a system (for configuration UI)
   */
  async findBySystemId(systemId: string): Promise<TracingService[]> {
    try {
      return await withRequestEm(this.repository).find({
        where: { systemUnderTestId: systemId },
        relations: ['tracingInstance'],
        order: {
          testEnvironment: 'ASC',
          workload: 'ASC',
        },
      });
    } catch (error) {
      this.logger.error('Failed to find tracing services by system:', error);
      throw new DatabaseException('Failed to retrieve tracing services', error);
    }
  }

  /**
   * Find tracing service by exact match (for updates/deletes)
   */
  async findByExactMatch(
    systemId: string,
    environment: string | null,
    workload: string | null,
  ): Promise<TracingService | null> {
    try {
      const where: Record<string, unknown> = {
        systemUnderTestId: systemId,
      };

      if (environment === null) {
        where.testEnvironment = IsNull();
      } else {
        where.testEnvironment = environment;
      }

      if (workload === null) {
        where.workload = IsNull();
      } else {
        where.workload = workload;
      }

      return await withRequestEm(this.repository).findOne({ where });
    } catch (error) {
      this.logger.error('Failed to find tracing service by exact match:', error);
      throw new DatabaseException('Failed to retrieve tracing service', error);
    }
  }

  /**
   * Create or update tracing service
   * If a service already exists with the same system/environment/workload, update it
   */
  async createOrUpdate(data: Partial<TracingService>): Promise<TracingService> {
    try {
      // Check if one already exists
      const existing = await this.findByExactMatch(
        data.systemUnderTestId!,
        data.testEnvironment ?? null,
        data.workload ?? null,
      );

      if (existing) {
        // Update existing
        await withRequestEm(this.repository).update(existing.id, data);
        return await this.findById(existing.id);
      }

      // Create new
      const created = withRequestEm(this.repository).create(data);
      return await withRequestEm(this.repository).save(created);
    } catch (error) {
      this.logger.error('Failed to create or update tracing service:', error);
      throw new DatabaseException('Failed to save tracing service', error);
    }
  }
}
