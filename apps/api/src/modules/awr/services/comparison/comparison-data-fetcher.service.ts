/**
 * Comparison Data Fetcher Service
 *
 * Handles fetching and validating AWR reports for comparison.
 * Responsible for:
 * - Retrieving reports from database
 * - Finding latest reports for test runs
 * - Discovering available baseline reports
 * - Validating reports are ready for comparison
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AwrReport } from '../../entities/awr-report.entity';
import {
  ResourceNotFoundException,
  ValidationException,
} from '../../../../common/exceptions/business.exception';
import { AvailableBaselinesResponseDto, AvailableBaselineDto } from '../../dto';

/**
 * Service for fetching and validating AWR reports for comparison
 */
@Injectable()
export class ComparisonDataFetcherService {
  private readonly logger = new Logger(ComparisonDataFetcherService.name);

  constructor(
    @InjectRepository(AwrReport)
    private readonly awrReportRepo: Repository<AwrReport>,
  ) {}

  /**
   * Get reports for comparison with validation
   *
   * @param currentReportId - Current report ID
   * @param baselineReportId - Baseline report ID
   * @returns Validated reports ready for comparison
   * @throws ResourceNotFoundException if report not found
   * @throws ValidationException if report not parsed
   */
  async getReportsForComparison(
    currentReportId: string,
    baselineReportId: string,
  ): Promise<[AwrReport, AwrReport]> {
    const [currentReport, baselineReport] = await Promise.all([
      this.awrReportRepo.findOne({ where: { id: currentReportId } }),
      this.awrReportRepo.findOne({ where: { id: baselineReportId } }),
    ]);

    if (!currentReport) {
      throw new ResourceNotFoundException('AWR Report', currentReportId);
    }

    if (!baselineReport) {
      throw new ResourceNotFoundException('AWR Report', baselineReportId);
    }

    if (!currentReport.parsedData) {
      throw new ValidationException(
        `Current report ${currentReportId} has not been parsed yet`,
      );
    }

    if (!baselineReport.parsedData) {
      throw new ValidationException(
        `Baseline report ${baselineReportId} has not been parsed yet`,
      );
    }

    return [currentReport, baselineReport];
  }

  /**
   * Get latest completed report ID for test run
   *
   * @param testRunId - Test run ID
   * @returns Report ID or null if none found
   */
  async getLatestReportId(testRunId: string): Promise<string | null> {
    const report = await this.awrReportRepo.findOne({
      where: { testRunId, parseStatus: 'completed' },
      order: { uploadedAt: 'DESC' },
      select: ['id'],
    });
    return report?.id ?? null;
  }

  /**
   * Get available baselines for comparison with a report
   *
   * Returns reports from other test runs that can be used as baselines.
   *
   * @param reportId - Current report ID
   * @param limit - Maximum baselines to return
   * @returns Available baselines
   */
  async getAvailableBaselines(
    reportId: string,
    limit: number = 20,
  ): Promise<AvailableBaselinesResponseDto> {
    this.logger.debug(`[getAvailableBaselines] Called with reportId: ${reportId}`);

    // Get current report to exclude its test run
    const currentReport = await this.awrReportRepo.findOne({
      where: { id: reportId },
      select: ['id', 'testRunId', 'dbName'],
    });

    if (!currentReport) {
      this.logger.warn(`[getAvailableBaselines] Report not found: ${reportId}`);
      throw new ResourceNotFoundException('AWR Report', reportId);
    }

    this.logger.debug(
      `[getAvailableBaselines] Found current report. testRunId: ${currentReport.testRunId}, dbName: ${currentReport.dbName}`,
    );

    return this.findBaselineReports(currentReport.testRunId, currentReport.dbName, limit);
  }

  /**
   * Get available baselines for a test run
   *
   * Returns reports from other test runs that can be used as baselines.
   *
   * @param testRunId - Current test run ID
   * @param limit - Maximum baselines to return
   * @returns Available baselines
   */
  async getAvailableBaselinesForTestRun(
    testRunId: string,
    limit: number = 20,
  ): Promise<AvailableBaselinesResponseDto> {
    // Get dbName from any report in this test run
    const currentReport = await this.awrReportRepo.findOne({
      where: { testRunId, parseStatus: 'completed' },
      select: ['dbName'],
    });

    return this.findBaselineReports(testRunId, currentReport?.dbName, limit);
  }

  /**
   * Find baseline reports from other test runs
   *
   * @param excludeTestRunId - Test run ID to exclude
   * @param dbName - Optional database name for filtering
   * @param limit - Maximum results to return
   * @returns Available baselines
   */
  async findBaselineReports(
    excludeTestRunId: string,
    dbName?: string,
    limit: number = 20,
  ): Promise<AvailableBaselinesResponseDto> {
    try {
      this.logger.debug(
        `[findBaselineReports] Searching for baselines. excludeTestRunId: ${excludeTestRunId}, dbName: ${dbName}, limit: ${limit}`,
      );

      const queryBuilder = this.awrReportRepo
        .createQueryBuilder('awr')
        .leftJoin('awr.testRun', 'testRun')
        .select([
          'awr.id',
          'awr.testRunId',
          'awr.dbName',
          'awr.beginTime',
          'awr.endTime',
          'awr.uploadedAt',
          'testRun.testRunId',
        ])
        .where('awr.testRunId != :excludeId', { excludeId: excludeTestRunId })
        .andWhere('awr.parseStatus = :status', { status: 'completed' });

      // Prefer same database if known
      if (dbName) {
        queryBuilder.orderBy('CASE WHEN awr.dbName = :dbName THEN 0 ELSE 1 END', 'ASC');
        queryBuilder.setParameter('dbName', dbName);
      }

      queryBuilder
        .addOrderBy('awr.uploadedAt', 'DESC')
        .take(limit);

      const [reports, total] = await queryBuilder.getManyAndCount();

      this.logger.debug(`[findBaselineReports] Found ${reports.length} reports (total: ${total})`);

      const baselines: AvailableBaselineDto[] = reports.map((report) => ({
        testRunId: report.testRunId,
        testRunName: report.testRun?.testRunId,
        awrReportId: report.id,
        dbName: report.dbName,
        beginTime: report.beginTime,
        endTime: report.endTime,
        uploadedAt: report.uploadedAt,
      }));

      this.logger.debug(
        `[findBaselineReports] Returning ${baselines.length} baselines:`,
        JSON.stringify(baselines, null, 2),
      );

      return { baselines, total };
    } catch (error) {
      this.logger.error(
        `[findBaselineReports] ERROR: ${this.extractErrorMessage(error)}`,
      );
      this.logger.error(`[findBaselineReports] Error stack:`, error);
      return { baselines: [], total: 0 };
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
