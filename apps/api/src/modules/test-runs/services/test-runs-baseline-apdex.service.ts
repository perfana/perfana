import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRun, SystemUnderTest as SystemEntity } from '@perfana/shared';
import {
  BaselineApdexPreviewDto,
  BaselineApdexApplyDto,
  BaselinePreviewResponseDto,
  BaselinePreviewItemDto,
  BaselineApplyResponseDto,
  BaselineApdexScope,
} from '../dto/baseline-apdex.dto';
import { TestRunsApdexService } from './test-runs-apdex.service';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { AuthorizationService } from '../../../common/services/authorization.service';
import type { OwnedResource } from '@perfana/shared';

/**
 * Raw test run data from SQL query (snake_case)
 */
interface TestRunQueryResult {
  id: string;
  test_run_id: string;
  system_under_test_id: string;
  system_name: string; // Human-readable system name for display
  test_environment: string;
  workload: string;
  start_time?: Date;
  end_time?: Date;
}

/**
 * Transaction response times data for baseline calculation
 */
interface TransactionResponseTimes {
  transaction_name: string;
  scenario_name: string;
  response_times: number[];
  current_threshold: number | null;
  current_apdex: number | null;
}

/**
 * Result of binary search threshold calculation
 */
interface ThresholdCalculationResult {
  optimal_threshold: number | null;
  projected_apdex: number | null;
  achievable: boolean;
  message: string | null;
}

/**
 * Service for calculating baseline Apdex thresholds to achieve target scores
 * Uses binary search algorithm to find optimal thresholds
 */
@Injectable()
export class TestRunsBaselineApdexService {
  private readonly logger = new Logger(TestRunsBaselineApdexService.name);
  private readonly MIN_SAMPLES = 10; // Minimum samples required for calculation
  private readonly EPSILON = 0.001; // Precision for Apdex comparison
  private readonly MAX_ITERATIONS = 100; // Maximum binary search iterations

  constructor(
    @InjectRepository(TestRun)
    private testRunRepo: Repository<TestRun>,
    @InjectRepository(SystemEntity)
    private systemRepo: Repository<SystemEntity>,
    private apdexService: TestRunsApdexService,
    private authzService: AuthorizationService,
  ) {}

  /**
   * Validate that the user has access to the specified system under test
   * @throws ResourceNotFoundException if system not found or access is denied (hides resource existence)
   */
  private async validateSystemAccess(
    systemUnderTestId: string,
    userId: string,
    roles: string[],
  ): Promise<void> {
    const system = await this.systemRepo.findOne({ where: { id: systemUnderTestId } });
    if (!system) {
      throw new ResourceNotFoundException('System', systemUnderTestId);
    }

    const result = await this.authzService.canAccessResource(userId, roles, {
      organization_id: system.organization_id,
      created_by: system.created_by ?? '',
    } as OwnedResource);

    if (!result.allowed) {
      throw new ResourceNotFoundException('System', systemUnderTestId);
    }
  }

  /**
   * Preview baseline Apdex calculation without applying changes
   */
  async previewBaselineApdex(
    testRunId: string,
    dto: BaselineApdexPreviewDto,
    userId: string,
    roles: string[],
  ): Promise<BaselinePreviewResponseDto> {
    this.logger.log(`Preview baseline Apdex for test run ${testRunId}, target: ${dto.target_apdex}, scope: ${dto.scope}`);

    // Validate target Apdex
    if (dto.target_apdex < 0 || dto.target_apdex > 1) {
      throw new BadRequestException('Target Apdex must be between 0 and 1');
    }

    // Get test run details
    const testRun = await this.getTestRunDetails(testRunId);

    // Validate user has access to the system
    await this.validateSystemAccess(testRun.system_under_test_id, userId, roles);

    // Get transaction response times with current thresholds
    const transactionData = await this.getTransactionResponseTimes(testRun);

    if (transactionData.length === 0) {
      throw new NotFoundException(`No transaction data found for test run ${testRunId}`);
    }

    // Calculate optimal thresholds for each transaction
    const previewItems: BaselinePreviewItemDto[] = [];
    let totalSamples = 0;
    let weightedThresholdSum = 0;
    let achievableCount = 0;

    for (const txData of transactionData) {
      if (txData.response_times.length < this.MIN_SAMPLES) {
        previewItems.push({
          transaction_name: txData.transaction_name,
          scenario_name: txData.scenario_name,
          current_threshold: txData.current_threshold,
          calculated_threshold: null,
          current_apdex: txData.current_apdex,
          projected_apdex: null,
          sample_count: txData.response_times.length,
          achievable: false,
          message: `Insufficient samples (${txData.response_times.length} < ${this.MIN_SAMPLES})`,
        });
        continue;
      }

      // Calculate optimal threshold using binary search
      const result = this.findThresholdForTargetApdex(txData.response_times, dto.target_apdex);

      previewItems.push({
        transaction_name: txData.transaction_name,
        scenario_name: txData.scenario_name,
        current_threshold: txData.current_threshold,
        calculated_threshold: result.optimal_threshold,
        current_apdex: txData.current_apdex,
        projected_apdex: result.projected_apdex,
        sample_count: txData.response_times.length,
        achievable: result.achievable,
        message: result.message,
      });

      if (result.achievable && result.optimal_threshold !== null) {
        achievableCount++;
        weightedThresholdSum += result.optimal_threshold * txData.response_times.length;
        totalSamples += txData.response_times.length;
      }
    }

    // Build response
    const response: BaselinePreviewResponseDto = {
      scope: dto.scope,
      target_apdex: dto.target_apdex,
      items: previewItems,
    };

    // Add workload summary if scope is workload
    if (dto.scope === BaselineApdexScope.WORKLOAD) {
      const calculatedWorkloadThreshold = totalSamples > 0
        ? Math.round(weightedThresholdSum / totalSamples)
        : null;

      // Calculate current and projected workload Apdex
      const { current_apdex, projected_apdex } = this.calculateWorkloadApdex(
        transactionData,
        calculatedWorkloadThreshold,
      );

      response.workload_summary = {
        current_workload_threshold: transactionData[0]?.current_threshold || 500,
        calculated_workload_threshold: calculatedWorkloadThreshold,
        current_workload_apdex: current_apdex,
        projected_workload_apdex: projected_apdex,
        total_transactions: transactionData.length,
        achievable_count: achievableCount,
      };
    }

    return response;
  }

  /**
   * Apply baseline Apdex thresholds to database
   */
  async applyBaselineApdex(
    testRunId: string,
    dto: BaselineApdexApplyDto,
    userId: string,
    roles: string[],
  ): Promise<BaselineApplyResponseDto> {
    this.logger.log(`Apply baseline Apdex for test run ${testRunId}, target: ${dto.target_apdex}, scope: ${dto.scope}`);

    // First get preview to calculate thresholds (access validation happens inside previewBaselineApdex)
    const preview = await this.previewBaselineApdex(testRunId, {
      target_apdex: dto.target_apdex,
      scope: dto.scope,
    }, userId, roles);

    // Get test run details
    const testRun = await this.getTestRunDetails(testRunId);

    let transactionsUpdated = 0;
    let workloadThresholdUpdated = false;

    if (dto.scope === BaselineApdexScope.TRANSACTION) {
      // Apply transaction-level thresholds
      for (const item of preview.items) {
        if (item.achievable && item.calculated_threshold !== null) {
          try {
            await this.apdexService.setWorkloadTransactionApdexThreshold(
              testRun.system_under_test_id,
              testRun.test_environment,
              testRun.workload,
              item.transaction_name,
              { apdex_threshold: item.calculated_threshold },
              userId,
              roles,
            );
            transactionsUpdated++;
            this.logger.log(
              `Set transaction threshold for ${item.transaction_name}: ${item.calculated_threshold}ms`
            );
          } catch (error) {
            this.logger.error(
              `Failed to set threshold for ${item.transaction_name}: ${error}`
            );
          }
        }
      }
    } else if (dto.scope === BaselineApdexScope.WORKLOAD) {
      // Apply workload-level threshold
      if (preview.workload_summary?.calculated_workload_threshold) {
        await this.apdexService.setWorkloadApdexThreshold(
          testRun.system_under_test_id,
          testRun.test_environment,
          testRun.workload,
          { apdex_threshold: preview.workload_summary.calculated_workload_threshold },
          userId,
          roles,
        );
        workloadThresholdUpdated = true;
        this.logger.log(
          `Set workload threshold: ${preview.workload_summary.calculated_workload_threshold}ms`
        );
      }
    }

    return {
      message: 'Baseline Apdex thresholds applied successfully',
      transactions_updated: transactionsUpdated,
      workload_threshold_updated: workloadThresholdUpdated,
      scope: dto.scope,
    };
  }

  /**
   * Binary search algorithm to find optimal threshold for target Apdex
   *
   * Algorithm:
   * 1. Sort response times (if not already sorted)
   * 2. Binary search on range [min_time, max_time]
   * 3. For each candidate threshold T, calculate Apdex(T)
   * 4. If Apdex(T) >= target, try lower T (better UX, same score)
   * 5. If Apdex(T) < target, try higher T (need more lenient threshold)
   * 6. Return lowest T that achieves target
   */
  private findThresholdForTargetApdex(
    responseTimes: number[],
    targetApdex: number,
  ): ThresholdCalculationResult {
    if (responseTimes.length === 0) {
      return {
        optimal_threshold: null,
        projected_apdex: null,
        achievable: false,
        message: 'No response time data available',
      };
    }

    // Sort response times ascending
    const sortedTimes = [...responseTimes].sort((a, b) => a - b);
    const total = sortedTimes.length;

    // Edge case: check if target is achievable with max possible threshold
    const lastResponseTime = sortedTimes[sortedTimes.length - 1];
    if (lastResponseTime === undefined) {
      return {
        optimal_threshold: null,
        projected_apdex: null,
        achievable: false,
        message: 'No valid response time data available',
      };
    }
    const maxThreshold = Math.ceil(lastResponseTime);
    const maxApdex = this.calculateApdexForThreshold(sortedTimes, maxThreshold, total);

    if (maxApdex < targetApdex - this.EPSILON) {
      return {
        optimal_threshold: null,
        projected_apdex: maxApdex,
        achievable: false,
        message: `Target ${targetApdex.toFixed(3)} not achievable (max possible: ${maxApdex.toFixed(3)})`,
      };
    }

    // Binary search for optimal threshold
    let left = 1; // Minimum 1ms
    let right = maxThreshold;
    let optimalThreshold = right;
    let optimalApdex = maxApdex;
    let iterations = 0;

    while (left <= right && iterations < this.MAX_ITERATIONS) {
      iterations++;
      const mid = Math.floor((left + right) / 2);
      const apdex = this.calculateApdexForThreshold(sortedTimes, mid, total);

      if (Math.abs(apdex - targetApdex) < this.EPSILON) {
        // Found exact match (within epsilon)
        optimalThreshold = mid;
        optimalApdex = apdex;
        // Try to find even lower threshold
        right = mid - 1;
      } else if (apdex >= targetApdex) {
        // Target achieved, try lower threshold for better UX
        optimalThreshold = mid;
        optimalApdex = apdex;
        right = mid - 1;
      } else {
        // Target not achieved, need higher threshold
        left = mid + 1;
      }
    }

    // Verify final result
    if (optimalApdex >= targetApdex - this.EPSILON) {
      return {
        optimal_threshold: optimalThreshold,
        projected_apdex: optimalApdex,
        achievable: true,
        message: `Target achievable with threshold ${optimalThreshold}ms`,
      };
    }

    return {
      optimal_threshold: null,
      projected_apdex: optimalApdex,
      achievable: false,
      message: `Target ${targetApdex.toFixed(3)} not achievable with available data`,
    };
  }

  /**
   * Calculate Apdex score for a given threshold and sorted response times
   *
   * Apdex = (Satisfied + 0.5 * Tolerating) / Total
   * - Satisfied: response_time <= T
   * - Tolerating: T < response_time <= 4T
   * - Frustrated: response_time > 4T
   */
  private calculateApdexForThreshold(
    sortedTimes: number[],
    threshold: number,
    total: number,
  ): number {
    const toleratingThreshold = threshold * 4;
    let satisfied = 0;
    let tolerating = 0;

    for (const time of sortedTimes) {
      if (time <= threshold) {
        satisfied++;
      } else if (time <= toleratingThreshold) {
        tolerating++;
      }
      // Frustrated items are implicitly counted (total - satisfied - tolerating)
    }

    return Math.round(((satisfied + tolerating * 0.5) / total) * 1000) / 1000;
  }

  /**
   * Get test run details
   */
  private async getTestRunDetails(testRunId: string): Promise<TestRunQueryResult> {
    // Join with systems_under_test to get the human-readable system name
    // The system_under_test_id (UUID) is used for threshold lookups
    // Support both UUID (id) and test_run_id string lookup
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(testRunId);

    const query = `
      SELECT
        tr.id,
        tr.test_run_id,
        tr.system_under_test_id,
        sut.name as system_name,
        tr.test_environment,
        tr.workload,
        tr.start_time,
        tr.end_time
      FROM test_runs tr
      JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
      WHERE ${isUuid ? 'tr.id = $1::uuid' : 'tr.test_run_id = $1'}
      LIMIT 1
    `;

    const result = await this.testRunRepo.query(query, [testRunId]);

    if (!result || result.length === 0) {
      throw new NotFoundException(`Test run not found: ${testRunId}`);
    }

    return result[0] as TestRunQueryResult;
  }

  /**
   * Get transaction response times with current thresholds
   */
  private async getTransactionResponseTimes(
    testRun: TestRunQueryResult,
  ): Promise<TransactionResponseTimes[]> {
    // Get all transactions with response times
    // Use system_under_test_id (UUID) for threshold lookups
    const query = `
      SELECT
        t.transaction_name,
        COALESCE(t.scenario_name, 'default') as scenario_name,
        ARRAY_AGG(t.response_time ORDER BY t.response_time) as response_times,
        wat.apdex_threshold as workload_threshold,
        wtat.apdex_threshold as transaction_threshold
      FROM transactions t
      LEFT JOIN workload_apdex_thresholds wat
        ON wat.system_under_test_id = $1
        AND wat.test_environment = $2
        AND wat.workload = $3
      LEFT JOIN workload_transaction_apdex_thresholds wtat
        ON wtat.system_under_test_id = $1
        AND wtat.test_environment = $2
        AND wtat.workload = $3
        AND wtat.transaction_name = t.transaction_name
      WHERE t.test_run_id = $4
        AND t.response_time IS NOT NULL
        AND t.success = true
      GROUP BY t.transaction_name, t.scenario_name, wat.apdex_threshold, wtat.apdex_threshold
      ORDER BY t.scenario_name, t.transaction_name
    `;

    const result = await this.testRunRepo.query(query, [
      testRun.system_under_test_id,
      testRun.test_environment,
      testRun.workload,
      testRun.test_run_id,
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.map((row: any) => {
      const currentThreshold = row.transaction_threshold || row.workload_threshold || 500;
      const responseTimes: number[] = row.response_times.map((t: string | number) =>
        typeof t === 'string' ? parseFloat(t) : t
      );
      const sortedTimes = [...responseTimes].sort((a, b) => a - b);
      const currentApdex = this.calculateApdexForThreshold(
        sortedTimes,
        currentThreshold,
        responseTimes.length,
      );

      return {
        transaction_name: row.transaction_name,
        scenario_name: row.scenario_name,
        response_times: responseTimes,
        current_threshold: currentThreshold,
        current_apdex: currentApdex,
      };
    });
  }

  /**
   * Preview Apdex score for a single transaction with a new threshold
   */
  async previewTransactionApdex(
    testRunId: string,
    transactionName: string,
    newThreshold: number,
    userId: string,
    roles: string[],
  ): Promise<{ transaction_name: string; threshold: number; apdex_score: number; sample_count: number }> {
    this.logger.log(`Preview Apdex for transaction ${transactionName} with threshold ${newThreshold}ms`);

    // Get test run details
    const testRun = await this.getTestRunDetails(testRunId);

    // Validate user has access to the system
    await this.validateSystemAccess(testRun.system_under_test_id, userId, roles);

    // Get response times for this specific transaction
    const query = `
      SELECT
        t.transaction_name,
        ARRAY_AGG(t.response_time ORDER BY t.response_time) as response_times
      FROM transactions t
      WHERE t.test_run_id = $1
        AND t.transaction_name = $2
        AND t.response_time IS NOT NULL
        AND t.success = true
      GROUP BY t.transaction_name
    `;

    const result = await this.testRunRepo.query(query, [testRun.test_run_id, transactionName]);

    if (!result || result.length === 0) {
      throw new NotFoundException(`Transaction ${transactionName} not found in test run ${testRunId}`);
    }

    const responseTimes: number[] = result[0].response_times.map((t: string | number) =>
      typeof t === 'string' ? parseFloat(t) : t
    );

    if (responseTimes.length === 0) {
      throw new NotFoundException(`No response time data for transaction ${transactionName}`);
    }

    const sortedTimes = [...responseTimes].sort((a, b) => a - b);
    const apdexScore = this.calculateApdexForThreshold(sortedTimes, newThreshold, sortedTimes.length);

    return {
      transaction_name: transactionName,
      threshold: newThreshold,
      apdex_score: apdexScore,
      sample_count: responseTimes.length,
    };
  }

  /**
   * Calculate current and projected workload-level Apdex
   */
  private calculateWorkloadApdex(
    transactionData: TransactionResponseTimes[],
    projectedThreshold: number | null,
  ): { current_apdex: number | null; projected_apdex: number | null } {
    // Aggregate all response times
    const allResponseTimes: number[] = [];
    for (const tx of transactionData) {
      allResponseTimes.push(...tx.response_times);
    }

    if (allResponseTimes.length === 0) {
      return { current_apdex: null, projected_apdex: null };
    }

    const sortedTimes = allResponseTimes.sort((a, b) => a - b);
    const currentThreshold = transactionData[0]?.current_threshold || 500;

    const currentApdex = this.calculateApdexForThreshold(
      sortedTimes,
      currentThreshold,
      sortedTimes.length,
    );

    const projectedApdex = projectedThreshold
      ? this.calculateApdexForThreshold(sortedTimes, projectedThreshold, sortedTimes.length)
      : null;

    return {
      current_apdex: currentApdex,
      projected_apdex: projectedApdex,
    };
  }
}
