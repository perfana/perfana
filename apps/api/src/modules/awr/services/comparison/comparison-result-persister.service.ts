/**
 * Comparison Result Persister Service
 *
 * Handles persistence of comparison results to the database.
 * Responsible for:
 * - Saving comparison analysis to database
 * - Retrieving existing comparisons
 * - Checking comparison existence
 * - Deleting comparisons
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AwrAnalysis, SeveritySummary, type AwrInsight as EntityAwrInsight } from '../../entities/awr-analysis.entity';
import {
  DatabaseException,
} from '../../../../common/exceptions/business.exception';
import type { AwrInsight } from '../../types/insights.types';

/**
 * Data to save for a comparison analysis
 */
export interface ComparisonSaveData {
  insights: AwrInsight[];
  severitySummary: SeveritySummary;
  comparisonVersion: string;
}

/**
 * Service for persisting comparison results
 */
@Injectable()
export class ComparisonResultPersisterService {
  private readonly logger = new Logger(ComparisonResultPersisterService.name);

  constructor(
    @InjectRepository(AwrAnalysis)
    private readonly awrAnalysisRepo: Repository<AwrAnalysis>,
  ) {}

  /**
   * Save comparison analysis to database
   *
   * @param currentReportId - Current report ID
   * @param baselineReportId - Baseline report ID
   * @param data - Comparison data to save
   * @returns Saved analysis entity
   */
  async saveComparisonAnalysis(
    currentReportId: string,
    baselineReportId: string,
    data: ComparisonSaveData,
  ): Promise<AwrAnalysis> {
    try {
      const analysis = this.awrAnalysisRepo.create({
        id: uuidv4(),
        awrReportId: currentReportId,
        baselineReportId,
        analysisType: 'comparison',
        insights: data.insights as unknown as EntityAwrInsight[],
        severitySummary: data.severitySummary,
        analysisVersion: data.comparisonVersion,
        analyzedAt: new Date(),
      });

      const savedAnalysis = await this.awrAnalysisRepo.save(analysis);

      this.logger.log(
        `Saved comparison analysis ${savedAnalysis.id} for reports ` +
          `${currentReportId} vs ${baselineReportId}`,
      );

      return savedAnalysis;
    } catch (error) {
      this.logger.error(`Failed to save comparison: ${this.extractErrorMessage(error)}`);
      throw new DatabaseException('Failed to save comparison analysis', error);
    }
  }

  /**
   * Get existing comparison analysis between two reports
   *
   * @param currentReportId - Current report ID
   * @param baselineReportId - Baseline report ID
   * @returns Existing analysis or null
   */
  async getExistingComparison(
    currentReportId: string,
    baselineReportId: string,
  ): Promise<AwrAnalysis | null> {
    try {
      return await this.awrAnalysisRepo.findOne({
        where: {
          awrReportId: currentReportId,
          baselineReportId: baselineReportId,
          analysisType: 'comparison',
        },
        order: { analyzedAt: 'DESC' },
      });
    } catch (error) {
      this.logger.error(`Failed to get comparison: ${this.extractErrorMessage(error)}`);
      return null;
    }
  }

  /**
   * Check if comparison exists between two reports
   *
   * @param currentReportId - Current report ID
   * @param baselineReportId - Baseline report ID
   * @returns True if comparison exists
   */
  async hasComparison(currentReportId: string, baselineReportId: string): Promise<boolean> {
    try {
      const count = await this.awrAnalysisRepo.count({
        where: {
          awrReportId: currentReportId,
          baselineReportId: baselineReportId,
          analysisType: 'comparison',
        },
      });
      return count > 0;
    } catch (error) {
      this.logger.error(`Failed to check comparison: ${this.extractErrorMessage(error)}`);
      return false;
    }
  }

  /**
   * Delete comparison analyses for a report
   *
   * @param reportId - Report ID (either as current or baseline)
   * @returns Number of deleted analyses
   */
  async deleteComparisonsForReport(reportId: string): Promise<number> {
    try {
      const result = await this.awrAnalysisRepo
        .createQueryBuilder()
        .delete()
        .where('analysisType = :type', { type: 'comparison' })
        .andWhere('(awrReportId = :id OR baselineReportId = :id)', { id: reportId })
        .execute();

      const deletedCount = result.affected || 0;

      if (deletedCount > 0) {
        this.logger.log(`Deleted ${deletedCount} comparisons for report ${reportId}`);
      }

      return deletedCount;
    } catch (error) {
      this.logger.error(`Failed to delete comparisons: ${this.extractErrorMessage(error)}`);
      throw new DatabaseException('Failed to delete comparisons', error);
    }
  }

  /**
   * Safely extract error message
   */
  private extractErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
      return (error as Error).message;
    }
    return 'An unexpected error occurred';
  }
}
