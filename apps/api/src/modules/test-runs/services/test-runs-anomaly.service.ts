import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  TestRun as TestRunEntity,
  DsAdaptResults,
  DsAdaptTrackedResults,
  DsCompareConfig,
  DsControlGroupStatistics,
  DsMetrics,
  DsMetricStatistics,
  DsPanels,
} from '../../../entities';
import { DeleteAnomalyDto } from '../dto/delete-anomaly.dto';
import { ResourceNotFoundException, DatabaseException, ValidationException } from '../../../common/exceptions/business.exception';
import { BullMQClientService } from '../../data-science/services/bullmq-client.service';

@Injectable()
export class TestRunsAnomalyService {
  private readonly logger = new Logger(TestRunsAnomalyService.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private testRunRepo: Repository<TestRunEntity>,
    @InjectRepository(DsAdaptResults)
    private dsAdaptResultsRepo: Repository<DsAdaptResults>,
    @InjectRepository(DsCompareConfig)
    private dsCompareConfigRepo: Repository<DsCompareConfig>,
    private dataSource: DataSource,
    private bullmqClientService: BullMQClientService,
  ) {}

  /**
   * Get check results for a test run.
   * Authorization is enforced at the controller level via verifyTestRunAccess.
   */
  async getTestRunCheckResults(
    testRunId: string,
    _system?: string,
    _environment?: string,
    _workload?: string,
  ): Promise<any[]> {
    try {
      // Use raw SQL to query check_results table (no entity)
      const checkResults = await this.dataSource.query(
        `SELECT * FROM check_results WHERE test_run_id = $1 ORDER BY created_at ASC`,
        [testRunId]
      );

      // Parse JSONB fields if they were returned as strings
      const parsedResults = checkResults.map((result: any) => ({
        ...result,
        targets: typeof result.targets === 'string' ? JSON.parse(result.targets) : result.targets,
        requirement: typeof result.requirement === 'string' ? JSON.parse(result.requirement) : result.requirement,
      }));

      this.logger.log(`Retrieved ${parsedResults.length} check results for test run: ${testRunId}`);
      return parsedResults;
    } catch (error) {
      this.logger.error(`Failed to get check results for ${testRunId}:`, error);
      throw error;
    }
  }

  /**
   * Get anomaly detection results for a test run.
   * Authorization is enforced at the controller level via verifyTestRunAccess.
   */
  async getAnomalyDetectionResults(
    testRunId: string,
    _system?: string,
    _environment?: string,
    _workload?: string,
  ) {
    try {
      this.logger.log(`Getting anomaly detection results for test run: ${testRunId}`);

      // Get test run details
      const testRun = await this.testRunRepo.findOne({
        where: { testRunId },
        select: ['systemUnderTestId', 'testEnvironment', 'workload']
      });

      if (!testRun) {
        throw new ResourceNotFoundException('Test run', testRunId);
      }

      const { systemUnderTestId: system_under_test_id, testEnvironment: test_environment, workload } = testRun;

      // Get ds_adapt_results
      const adaptResults = await this.dsAdaptResultsRepo.find({
        where: { test_run_id: testRunId },
        select: [
          'dashboard_label',
          'panel_title',
          'metric_name',
          'unit',
          'conclusion',
          'statistic',
          'application_dashboard_id',
          'panel_id',
          'is_stale',
          'stale_reason',
          'stale_at',
          'config_hash_used'
        ],
        order: {
          dashboard_label: 'ASC',
          panel_title: 'ASC',
          metric_name: 'ASC'
        }
      });

      // Get all ds_compare_config entries for this system/environment/workload
      const configEntries = await this.dsCompareConfigRepo.find({
        where: {
          system_under_test_id,
          test_environment,
          workload
        },
        select: ['application_dashboard_id', 'panel_id', 'metric_name', 'config_data']
      });

      // Helper function to extract classification using inheritance hierarchy
      const getClassification = (adaptResult: any): string => {
        // 1. Most specific: exact match (application_dashboard_id + panel_id + metric_name)
        let match = configEntries?.find((config: any) =>
          config.application_dashboard_id === adaptResult.application_dashboard_id &&
          config.panel_id === adaptResult.panel_id &&
          config.metric_name === adaptResult.metric_name
        );

        if (match?.config_data?.metricClassification?.classification) {
          return match.config_data.metricClassification.classification;
        }

        // 2. Panel-level: application_dashboard_id + panel_id, metric_name = null
        match = configEntries?.find((config: any) =>
          config.application_dashboard_id === adaptResult.application_dashboard_id &&
          config.panel_id === adaptResult.panel_id &&
          config.metric_name === null
        );

        if (match?.config_data?.metricClassification?.classification) {
          return match.config_data.metricClassification.classification;
        }

        // 3. Dashboard-level: application_dashboard_id only, panel_id = null, metric_name = null
        match = configEntries?.find((config: any) =>
          config.application_dashboard_id === adaptResult.application_dashboard_id &&
          config.panel_id === null &&
          config.metric_name === null
        );

        if (match?.config_data?.metricClassification?.classification) {
          return match.config_data.metricClassification.classification;
        }

        // 4. Environment-level
        match = configEntries?.find((config: any) =>
          config.application_dashboard_id === null &&
          config.panel_id === null &&
          config.metric_name === null
        );

        if (match?.config_data?.metricClassification?.classification) {
          return match.config_data.metricClassification.classification;
        }

        return 'unclassified';
      };

      // Helper function to get the complete compare_config
      const getCompareConfig = (adaptResult: any): any => {
        // 1. Most specific: exact match
        let match = configEntries?.find((config: any) =>
          config.application_dashboard_id === adaptResult.application_dashboard_id &&
          config.panel_id === adaptResult.panel_id &&
          config.metric_name === adaptResult.metric_name
        );

        if (match?.config_data) {
          return match.config_data;
        }

        // 2. Panel-level
        match = configEntries?.find((config: any) =>
          config.application_dashboard_id === adaptResult.application_dashboard_id &&
          config.panel_id === adaptResult.panel_id &&
          config.metric_name === null
        );

        if (match?.config_data) {
          return match.config_data;
        }

        // 3. Dashboard-level
        match = configEntries?.find((config: any) =>
          config.application_dashboard_id === adaptResult.application_dashboard_id &&
          config.panel_id === null &&
          config.metric_name === null
        );

        if (match?.config_data) {
          return match.config_data;
        }

        // 4. Environment-level
        match = configEntries?.find((config: any) =>
          config.application_dashboard_id === null &&
          config.panel_id === null &&
          config.metric_name === null
        );

        if (match?.config_data) {
          return match.config_data;
        }

        return null;
      };

      const results = adaptResults.map((row: any) => ({
        dashboard_label: row.dashboard_label,
        panel_title: row.panel_title,
        metric_name: row.metric_name,
        unit: row.unit || null,
        classification: getClassification(row),
        conclusion_label: (row.conclusion && row.conclusion.label) || 'unknown',
        test_value: row.statistic?.test || null,
        control_group_value: row.statistic?.control || null,
        difference: row.statistic?.diff || null,
        application_dashboard_id: row.application_dashboard_id,
        panel_id: row.panel_id,
        compare_config: getCompareConfig(row),
        is_stale: row.is_stale || false,
        stale_reason: row.stale_reason || null,
        stale_at: row.stale_at || null,
        config_hash_used: row.config_hash_used || null
      }));

      this.logger.log(`Retrieved ${results?.length || 0} anomaly detection results for test run: ${testRunId}`);
      return results;
    } catch (error) {
      this.logger.error(`Failed to get anomaly detection results for ${testRunId}:`, error);
      throw error;
    }
  }

  /**
   * Delete anomaly data for a test run.
   * Authorization is enforced at the controller level via verifyTestRunAccess.
   */
  async deleteAnomalyData(
    testRunId: string,
    deleteDto: DeleteAnomalyDto,
  ): Promise<{ deletedCount: number }> {
    try {
      this.logger.log(`Deleting anomaly data for test run: ${testRunId}, scope: ${deleteDto.scope}, range: ${deleteDto.range}`);

      if (deleteDto.scope === 'metric' && !deleteDto.metricName) {
        throw new ValidationException('Metric name is required when scope is "metric"');
      }

      let deletedCount = 0;
      let affectedTestRunIds: string[] = [];

      if (deleteDto.range === 'current-test-run') {
        // Delete only for the current test run
        affectedTestRunIds = [testRunId];
        deletedCount = await this.cascadeDeleteAnomalyData([testRunId], deleteDto);
      } else {
        // Delete for all test runs with same system/environment/workload
        const testRun = await this.testRunRepo.findOne({
          where: { testRunId },
          select: ['systemUnderTestId', 'testEnvironment', 'workload']
        });

        if (!testRun) {
          throw new ResourceNotFoundException('Test run', testRunId);
        }

        // Get all test run IDs for this combination
        const testRuns = await this.testRunRepo.find({
          where: {
            systemUnderTestId: testRun.systemUnderTestId,
            testEnvironment: testRun.testEnvironment,
            workload: testRun.workload
          },
          select: ['testRunId']
        });

        if (!testRuns || testRuns.length === 0) {
          this.logger.log('No test runs found for deletion');
          return { deletedCount: 0 };
        }

        affectedTestRunIds = testRuns.map(tr => tr.testRunId);
        deletedCount = await this.cascadeDeleteAnomalyData(affectedTestRunIds, deleteDto);
      }

      // Create BullMQ job to re-evaluate ADAPT conclusions
      if (affectedTestRunIds.length > 0) {
        await this.bullmqClientService.addJob('re-evaluate-adapt-conclusion', {
          testRunIds: affectedTestRunIds
        });
        this.logger.log(`Created BullMQ job to re-evaluate ADAPT conclusions for ${affectedTestRunIds.length} test runs`);
      }

      this.logger.log(`Successfully deleted ${deletedCount} anomaly data records and related cascade data`);
      return { deletedCount };

    } catch (error) {
      this.logger.error(`Failed to delete anomaly data for ${testRunId}:`, error);
      throw error;
    }
  }

  async cascadeDeleteAnomalyData(testRunIds: string[], deleteDto: DeleteAnomalyDto): Promise<number> {
    let totalDeletedCount = 0;

    this.logger.log(`Cascade delete parameters: applicationDashboardId=${deleteDto.applicationDashboardId}, panelId=${deleteDto.panelId}, metricName=${deleteDto.metricName}, scope=${deleteDto.scope}, testRunIds=${JSON.stringify(testRunIds)}`);

    try {
      await this.dataSource.transaction(async (transactionalEntityManager) => {
        // Count records to be deleted from ds_adapt_results
        const countQuery = this.dsAdaptResultsRepo.createQueryBuilder('dar')
          .where('dar.test_run_id IN (:...testRunIds)', { testRunIds })
          .andWhere('dar.application_dashboard_id = :appDashId', { appDashId: deleteDto.applicationDashboardId })
          .andWhere('dar.panel_id = :panelId', { panelId: deleteDto.panelId });

        if (deleteDto.scope === 'metric' && deleteDto.metricName) {
          countQuery.andWhere('dar.metric_name = :metricName', { metricName: deleteDto.metricName });
        }

        const expectedDeleteCount = await countQuery.getCount();
        this.logger.log(`Found ${expectedDeleteCount} ds_adapt_results records to delete`);

        // Delete from ds_adapt_results
        const deleteQuery = transactionalEntityManager.createQueryBuilder()
          .delete()
          .from(DsAdaptResults)
          .where('test_run_id IN (:...testRunIds)', { testRunIds })
          .andWhere('application_dashboard_id = :appDashId', { appDashId: deleteDto.applicationDashboardId })
          .andWhere('panel_id = :panelId', { panelId: deleteDto.panelId });

        if (deleteDto.scope === 'metric' && deleteDto.metricName) {
          deleteQuery.andWhere('metric_name = :metricName', { metricName: deleteDto.metricName });
        }

        const adaptResult = await deleteQuery.execute();
        totalDeletedCount += adaptResult.affected || 0;
        this.logger.log(`Deleted ${adaptResult.affected || 0} records from ds_adapt_results`);

        // Delete from cascade tables
        // ds_control_group_statistics
        const cgStatsDelete = transactionalEntityManager.createQueryBuilder()
          .delete()
          .from(DsControlGroupStatistics)
          .where('application_dashboard_id = :appDashId', { appDashId: deleteDto.applicationDashboardId })
          .andWhere('panel_id = :panelId', { panelId: deleteDto.panelId });

        if (deleteDto.scope === 'metric' && deleteDto.metricName) {
          cgStatsDelete.andWhere('metric_name = :metricName', { metricName: deleteDto.metricName });
        }

        const cgStatsResult = await cgStatsDelete.execute();
        this.logger.log(`Deleted ${cgStatsResult.affected || 0} records from ds_control_group_statistics`);

        // ds_adapt_tracked_results
        const trackedDelete = transactionalEntityManager.createQueryBuilder()
          .delete()
          .from(DsAdaptTrackedResults)
          .where('test_run_id IN (:...testRunIds)', { testRunIds })
          .andWhere('application_dashboard_id = :appDashId', { appDashId: deleteDto.applicationDashboardId })
          .andWhere('panel_id = :panelId', { panelId: deleteDto.panelId });

        if (deleteDto.scope === 'metric' && deleteDto.metricName) {
          trackedDelete.andWhere('metric_name = :metricName', { metricName: deleteDto.metricName });
        }

        const trackedResult = await trackedDelete.execute();
        this.logger.log(`Deleted ${trackedResult.affected || 0} records from ds_adapt_tracked_results`);

        // ds_metrics
        const metricsDelete = transactionalEntityManager.createQueryBuilder()
          .delete()
          .from(DsMetrics)
          .where('test_run_id IN (:...testRunIds)', { testRunIds })
          .andWhere('application_dashboard_id = :appDashId', { appDashId: deleteDto.applicationDashboardId })
          .andWhere('panel_id = :panelId', { panelId: deleteDto.panelId });

        if (deleteDto.scope === 'metric' && deleteDto.metricName) {
          metricsDelete.andWhere('metric_name = :metricName', { metricName: deleteDto.metricName });
        }

        const metricsResult = await metricsDelete.execute();
        this.logger.log(`Deleted ${metricsResult.affected || 0} records from ds_metrics`);

        // ds_metric_statistics
        const metricStatsDelete = transactionalEntityManager.createQueryBuilder()
          .delete()
          .from(DsMetricStatistics)
          .where('test_run_id IN (:...testRunIds)', { testRunIds })
          .andWhere('application_dashboard_id = :appDashId', { appDashId: deleteDto.applicationDashboardId })
          .andWhere('panel_id = :panelId', { panelId: deleteDto.panelId });

        if (deleteDto.scope === 'metric' && deleteDto.metricName) {
          metricStatsDelete.andWhere('metric_name = :metricName', { metricName: deleteDto.metricName });
        }

        const metricStatsResult = await metricStatsDelete.execute();
        this.logger.log(`Deleted ${metricStatsResult.affected || 0} records from ds_metric_statistics`);

        // ds_panels (only if scope is panel)
        if (deleteDto.scope === 'panel') {
          const panelsDelete = transactionalEntityManager.createQueryBuilder()
            .delete()
            .from(DsPanels)
            .where('test_run_id IN (:...testRunIds)', { testRunIds })
            .andWhere('application_dashboard_id = :appDashId', { appDashId: deleteDto.applicationDashboardId })
            .andWhere('panel_id = :panelId', { panelId: deleteDto.panelId });

          const panelsResult = await panelsDelete.execute();
          this.logger.log(`Deleted ${panelsResult.affected || 0} records from ds_panels`);
        }
      });

      return totalDeletedCount;
    } catch (error) {
      this.logger.error(`Failed to cascade delete anomaly data:`, error);
      throw error;
    }
  }

  /**
   * Get a specific ds_adapt_result.
   * Authorization is enforced at the controller level via verifyTestRunAccess.
   */
  async getDsAdaptResult(
    testRunId: string,
    applicationDashboardId: string,
    panelId: string,
    metricName: string,
  ) {
    try {
      this.logger.log(`Getting ds_adapt_result for test run: ${testRunId}, metric: ${metricName}`);

      const result = await this.dsAdaptResultsRepo.findOne({
        where: {
          test_run_id: testRunId,
          application_dashboard_id: applicationDashboardId,
          panel_id: parseInt(panelId, 10),
          metric_name: metricName
        }
      });

      if (!result) {
        throw new ResourceNotFoundException(`DS adapt result not found for test run: ${testRunId}, metric: ${metricName}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to get ds_adapt_result for ${testRunId}:`, error);
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      throw new DatabaseException(`Failed to fetch ds_adapt_result: ${(error as Error).message}`);
    }
  }
}
