import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmBaseRepository } from '../common/repositories/typeorm-base.repository';
import { withRequestEm } from '../common/db/request-em';
import { ApplicationDashboard } from '@perfana/shared/entities';
import { DatabaseException } from '../common/exceptions/business.exception';

@Injectable()
export class ApplicationDashboardRepository extends TypeOrmBaseRepository<ApplicationDashboard> {
  constructor(
    @InjectRepository(ApplicationDashboard)
    repository: Repository<ApplicationDashboard>,
  ) {
    super(repository, 'ApplicationDashboard');
  }

  /**
   * Find application dashboards by system and environment
   */
  async findBySystemAndEnvironment(
    systemId: string,
    environment: string
  ): Promise<ApplicationDashboard[]> {
    try {
      return await withRequestEm(this.repository).find({
        where: {
          systemUnderTestId: systemId,
          testEnvironment: environment
        },
        order: { dashboardLabel: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find application dashboards by system and environment:', error);
      throw new DatabaseException('Failed to retrieve application dashboards', error);
    }
  }

  /**
   * Find application dashboards by system
   */
  async findBySystem(systemId: string): Promise<ApplicationDashboard[]> {
    try {
      return await withRequestEm(this.repository).find({
        where: { systemUnderTestId: systemId },
        order: { testEnvironment: 'ASC', dashboardLabel: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find application dashboards by system:', error);
      throw new DatabaseException('Failed to retrieve application dashboards', error);
    }
  }

  /**
   * Find application dashboards by environment
   */
  async findByEnvironment(environment: string): Promise<ApplicationDashboard[]> {
    try {
      return await withRequestEm(this.repository).find({
        where: { testEnvironment: environment },
        order: { systemUnderTestId: 'ASC', dashboardLabel: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find application dashboards by environment:', error);
      throw new DatabaseException('Failed to retrieve application dashboards', error);
    }
  }

  /**
   * Find application dashboards by Grafana instance
   */
  async findByGrafanaInstance(instanceId: string): Promise<ApplicationDashboard[]> {
    try {
      return await withRequestEm(this.repository).find({
        where: { grafanaInstanceId: instanceId },
        order: { dashboardLabel: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find application dashboards by Grafana instance:', error);
      throw new DatabaseException('Failed to retrieve application dashboards', error);
    }
  }

  /**
   * Find application dashboard by Grafana dashboard ID
   */
  async findByGrafanaDashboardId(dashboardId: string): Promise<ApplicationDashboard | null> {
    return await this.findOne({
      where: { grafanaDashboardId: dashboardId }
    });
  }

  /**
   * Find application dashboard by dashboard UID
   */
  async findByDashboardUid(uid: string): Promise<ApplicationDashboard | null> {
    return await this.findOne({
      where: { dashboardUid: uid }
    });
  }

  /**
   * Find application dashboards by tags
   */
  async findByTags(tags: string[]): Promise<ApplicationDashboard[]> {
    try {
      return await withRequestEm(this.repository).createQueryBuilder('ad')
        .where('ad.tags && ARRAY[:...tags]::text[]', { tags })
        .orderBy('ad.dashboardLabel', 'ASC')
        .getMany();
    } catch (error) {
      this.logger.error('Failed to find application dashboards by tags:', error);
      throw new DatabaseException('Failed to retrieve application dashboards', error);
    }
  }

  /**
   * Search application dashboards by name or label
   */
  async search(searchTerm: string, limit = 50): Promise<ApplicationDashboard[]> {
    try {
      return await withRequestEm(this.repository).createQueryBuilder('ad')
        .where('ad.dashboardName ILIKE :search', { search: `%${searchTerm}%` })
        .orWhere('ad.dashboardLabel ILIKE :search', { search: `%${searchTerm}%` })
        .orderBy('ad.dashboardLabel', 'ASC')
        .limit(limit)
        .getMany();
    } catch (error) {
      this.logger.error('Failed to search application dashboards:', error);
      throw new DatabaseException('Failed to search application dashboards', error);
    }
  }

  /**
   * Get unique environments
   */
  async getUniqueEnvironments(): Promise<string[]> {
    try {
      const results = await withRequestEm(this.repository).createQueryBuilder('ad')
        .select('DISTINCT ad.testEnvironment', 'environment')
        .orderBy('ad.testEnvironment', 'ASC')
        .getRawMany();

      return results.map(r => r.environment);
    } catch (error) {
      this.logger.error('Failed to get unique environments:', error);
      throw new DatabaseException('Failed to retrieve unique environments', error);
    }
  }

  /**
   * Get dashboards grouped by system
   */
  async groupBySystem(): Promise<Map<string, ApplicationDashboard[]>> {
    try {
      const dashboards = await withRequestEm(this.repository).find({
        order: { systemUnderTestId: 'ASC', dashboardLabel: 'ASC' }
      });

      const grouped = new Map<string, ApplicationDashboard[]>();
      dashboards.forEach(dashboard => {
        const systemId = dashboard.systemUnderTestId;
        if (!grouped.has(systemId)) {
          grouped.set(systemId, []);
        }
        grouped.get(systemId)!.push(dashboard);
      });

      return grouped;
    } catch (error) {
      this.logger.error('Failed to group dashboards by system:', error);
      throw new DatabaseException('Failed to group application dashboards', error);
    }
  }

  /**
   * Delete dashboards by Grafana instance
   */
  async deleteByGrafanaInstance(instanceId: string): Promise<number> {
    try {
      const result = await withRequestEm(this.repository).createQueryBuilder()
        .delete()
        .where('grafanaInstanceId = :instanceId', { instanceId })
        .execute();

      this.logger.log(`Deleted ${result.affected} application dashboards for Grafana instance ${instanceId}`);
      return result.affected || 0;
    } catch (error) {
      this.logger.error('Failed to delete application dashboards:', error);
      throw new DatabaseException('Failed to delete application dashboards', error);
    }
  }

  /**
   * Delete dashboards by system
   */
  async deleteBySystem(systemId: string): Promise<number> {
    try {
      const result = await withRequestEm(this.repository).createQueryBuilder()
        .delete()
        .where('systemUnderTestId = :systemId', { systemId })
        .execute();

      this.logger.log(`Deleted ${result.affected} application dashboards for system ${systemId}`);
      return result.affected || 0;
    } catch (error) {
      this.logger.error('Failed to delete application dashboards:', error);
      throw new DatabaseException('Failed to delete application dashboards', error);
    }
  }
}
