import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmBaseRepository } from '../common/repositories/typeorm-base.repository';
import { TrendsFilterPreset } from '@perfana/shared/entities';
import { DatabaseException } from '../common/exceptions/business.exception';

@Injectable()
export class TrendsFilterPresetRepository extends TypeOrmBaseRepository<TrendsFilterPreset> {
  constructor(
    @InjectRepository(TrendsFilterPreset)
    repository: Repository<TrendsFilterPreset>,
  ) {
    super(repository, 'TrendsFilterPreset');
  }

  /**
   * Find all global presets
   */
  async findGlobal(): Promise<TrendsFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { isGlobal: true },
        order: { name: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find global trends filter presets:', error);
      throw new DatabaseException('Failed to retrieve global trends filter presets', error);
    }
  }

  /**
   * Find presets by user
   */
  async findByUser(userId: string): Promise<TrendsFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { createdBy: userId },
        order: { createdAt: 'DESC' }
      });
    } catch (error) {
      this.logger.error('Failed to find trends filter presets by user:', error);
      throw new DatabaseException('Failed to retrieve trends filter presets', error);
    }
  }

  /**
   * Find presets by application dashboard
   */
  async findByApplicationDashboard(dashboardId: string): Promise<TrendsFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { applicationDashboardId: dashboardId },
        relations: ['applicationDashboard'],
        order: { name: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find trends filter presets by dashboard:', error);
      throw new DatabaseException('Failed to retrieve trends filter presets', error);
    }
  }

  /**
   * Find presets by test run
   */
  async findByTestRun(testRunId: string): Promise<TrendsFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { createdForTestRunId: testRunId },
        order: { createdAt: 'DESC' }
      });
    } catch (error) {
      this.logger.error('Failed to find trends filter presets by test run:', error);
      throw new DatabaseException('Failed to retrieve trends filter presets', error);
    }
  }

  /**
   * Find presets by type
   */
  async findByType(presetType: string): Promise<TrendsFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { presetType },
        order: { name: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find trends filter presets by type:', error);
      throw new DatabaseException('Failed to retrieve trends filter presets', error);
    }
  }

  /**
   * Find presets by panel
   */
  async findByPanel(panelId: number, panelTitle?: string): Promise<TrendsFilterPreset[]> {
    try {
      const where: { panelId: number; panelTitle?: string } = { panelId };
      if (panelTitle) {
        where.panelTitle = panelTitle;
      }

      return await this.repository.find({
        where,
        order: { name: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find trends filter presets by panel:', error);
      throw new DatabaseException('Failed to retrieve trends filter presets', error);
    }
  }

  /**
   * Find accessible presets for a user (global + user-created)
   */
  async findAccessibleByUser(userId: string): Promise<TrendsFilterPreset[]> {
    try {
      return await this.repository.createQueryBuilder('preset')
        .where('preset.isGlobal = :isGlobal', { isGlobal: true })
        .orWhere('preset.createdBy = :userId', { userId })
        .orderBy('preset.name', 'ASC')
        .getMany();
    } catch (error) {
      this.logger.error('Failed to find accessible trends filter presets:', error);
      throw new DatabaseException('Failed to retrieve accessible trends filter presets', error);
    }
  }

  /**
   * Search presets by name
   */
  async searchByName(searchTerm: string, limit = 50): Promise<TrendsFilterPreset[]> {
    try {
      return await this.repository.createQueryBuilder('preset')
        .where('preset.name ILIKE :search', { search: `%${searchTerm}%` })
        .orderBy('preset.name', 'ASC')
        .limit(limit)
        .getMany();
    } catch (error) {
      this.logger.error('Failed to search trends filter presets:', error);
      throw new DatabaseException('Failed to search trends filter presets', error);
    }
  }

  /**
   * Delete all presets for a user
   */
  async deleteByUser(userId: string): Promise<number> {
    try {
      const result = await this.repository.createQueryBuilder()
        .delete()
        .where('createdBy = :userId', { userId })
        .execute();

      this.logger.log(`Deleted ${result.affected} trends filter presets for user ${userId}`);
      return result.affected || 0;
    } catch (error) {
      this.logger.error('Failed to delete trends filter presets:', error);
      throw new DatabaseException('Failed to delete trends filter presets', error);
    }
  }
}
