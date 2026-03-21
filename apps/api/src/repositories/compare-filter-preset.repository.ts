import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmBaseRepository } from '../common/repositories/typeorm-base.repository';
import { CompareFilterPreset } from '@perfana/shared/entities';
import { DatabaseException } from '../common/exceptions/business.exception';

@Injectable()
export class CompareFilterPresetRepository extends TypeOrmBaseRepository<CompareFilterPreset> {
  constructor(
    @InjectRepository(CompareFilterPreset)
    repository: Repository<CompareFilterPreset>,
  ) {
    super(repository, 'CompareFilterPreset');
  }

  /**
   * Find all global presets
   */
  async findGlobal(): Promise<CompareFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { isGlobal: true },
        order: { name: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find global compare filter presets:', error);
      throw new DatabaseException('Failed to retrieve global compare filter presets', error);
    }
  }

  /**
   * Find presets by user
   */
  async findByUser(userId: string): Promise<CompareFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { createdBy: userId },
        order: { createdAt: 'DESC' }
      });
    } catch (error) {
      this.logger.error('Failed to find compare filter presets by user:', error);
      throw new DatabaseException('Failed to retrieve compare filter presets', error);
    }
  }

  /**
   * Find presets by application dashboard
   */
  async findByApplicationDashboard(dashboardId: string): Promise<CompareFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { applicationDashboardId: dashboardId },
        relations: ['applicationDashboard'],
        order: { name: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find compare filter presets by dashboard:', error);
      throw new DatabaseException('Failed to retrieve compare filter presets', error);
    }
  }

  /**
   * Find presets by test run
   */
  async findByTestRun(testRunId: string): Promise<CompareFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { createdForTestRunId: testRunId },
        order: { createdAt: 'DESC' }
      });
    } catch (error) {
      this.logger.error('Failed to find compare filter presets by test run:', error);
      throw new DatabaseException('Failed to retrieve compare filter presets', error);
    }
  }

  /**
   * Find presets by type
   */
  async findByType(presetType: string): Promise<CompareFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { presetType },
        order: { name: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find compare filter presets by type:', error);
      throw new DatabaseException('Failed to retrieve compare filter presets', error);
    }
  }

  /**
   * Find presets by panel
   */
  async findByPanel(panelId: number, panelTitle?: string): Promise<CompareFilterPreset[]> {
    try {
      const where: any = { panelId };
      if (panelTitle) {
        where.panelTitle = panelTitle;
      }

      return await this.repository.find({
        where,
        order: { name: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find compare filter presets by panel:', error);
      throw new DatabaseException('Failed to retrieve compare filter presets', error);
    }
  }

  /**
   * Find presets by baseline test run
   */
  async findByBaselineTestRun(testRunId: string): Promise<CompareFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { baselineTestRunId: testRunId },
        order: { createdAt: 'DESC' }
      });
    } catch (error) {
      this.logger.error('Failed to find compare filter presets by baseline test run:', error);
      throw new DatabaseException('Failed to retrieve compare filter presets', error);
    }
  }

  /**
   * Find accessible presets for a user (global + user-created)
   */
  async findAccessibleByUser(userId: string): Promise<CompareFilterPreset[]> {
    try {
      return await this.repository.createQueryBuilder('preset')
        .where('preset.isGlobal = :isGlobal', { isGlobal: true })
        .orWhere('preset.createdBy = :userId', { userId })
        .orderBy('preset.name', 'ASC')
        .getMany();
    } catch (error) {
      this.logger.error('Failed to find accessible compare filter presets:', error);
      throw new DatabaseException('Failed to retrieve accessible compare filter presets', error);
    }
  }

  /**
   * Search presets by name or series search text
   */
  async search(searchTerm: string, limit = 50): Promise<CompareFilterPreset[]> {
    try {
      return await this.repository.createQueryBuilder('preset')
        .where('preset.name ILIKE :search', { search: `%${searchTerm}%` })
        .orWhere('preset.seriesSearchText ILIKE :search', { search: `%${searchTerm}%` })
        .orderBy('preset.name', 'ASC')
        .limit(limit)
        .getMany();
    } catch (error) {
      this.logger.error('Failed to search compare filter presets:', error);
      throw new DatabaseException('Failed to search compare filter presets', error);
    }
  }

  /**
   * Find presets with percentiles enabled
   */
  async findWithPercentiles(): Promise<CompareFilterPreset[]> {
    try {
      return await this.repository.find({
        where: { showPercentiles: true },
        order: { name: 'ASC' }
      });
    } catch (error) {
      this.logger.error('Failed to find compare filter presets with percentiles:', error);
      throw new DatabaseException('Failed to retrieve compare filter presets', error);
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

      this.logger.log(`Deleted ${result.affected} compare filter presets for user ${userId}`);
      return result.affected || 0;
    } catch (error) {
      this.logger.error('Failed to delete compare filter presets:', error);
      throw new DatabaseException('Failed to delete compare filter presets', error);
    }
  }
}
