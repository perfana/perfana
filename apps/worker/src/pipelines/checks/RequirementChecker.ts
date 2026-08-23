import { PoolClient } from 'pg';
import type { Logger } from 'pino';
import { validateRegexPattern } from '@perfana/shared/utils';
import { BaseCheckService, RequirementCheckError } from './BaseCheckService.js';
import { TestRun, Benchmark } from './BenchmarkMatcher.js';
import { AggregationResult, MetricTarget } from './DataAggregator.js';

export interface CheckResultTarget {
  target: string;
  value: number | null;
  meets_requirement: boolean | null;
  is_artificial: boolean;
}

export interface CheckResult {
  system_under_test_id: string;
  organization_id: string;
  team_id?: string | null;
  test_environment: string;
  workload: string;
  test_run_id: string;
  dashboard_label: string;
  dashboard_uid: string;
  application_dashboard_id: string;
  panel_title: string;
  panel_id: number | null;
  panel_type: string;
  panel_y_axes_format: string | null;
  metric_name: string | null;
  metric_unit: string | null;
  benchmark_id: string;
  status: string;
  message: string;
  average_all: boolean;
  evaluate_type: string;
  exclude_ramp_up_time: boolean;
  ramp_up: number | null;
  match_pattern: string | null;
  requirement: unknown;
  panel_average: number | null;
  meets_requirement: boolean | null;
  targets: CheckResultTarget[];
  validate_with_default_if_no_data: boolean;
  validate_with_default_if_no_data_value: number;
  tags: string[];
}

/**
 * Service to check requirements against aggregated metric data
 * Based on requirement_checker.py:39-418
 */
export class RequirementChecker extends BaseCheckService {
  constructor(
    logger: Logger,
    private client: PoolClient
  ) {
    super(logger);
  }

  /**
   * Create a CheckResult document from aggregated data
   * Based on requirement_checker.py:64-241
   */
  async createCheckResult(
    testRun: TestRun,
    benchmark: Benchmark,
    aggregationResult: AggregationResult,
    _grafanaInfo?: string,
    _snapshotId?: string
  ): Promise<CheckResult | null> {
    try {
      // Check if requirement config exists
      // Based on requirement_checker.py:88-124
      const hasRequirement = this.hasValidRequirement(benchmark);
      const config = benchmark.configuration as Record<string, unknown> | null | undefined;

      if (!hasRequirement) {
        const panelId = config?.panelId;
        this.logger.warn(
          `No valid requirement config for benchmark ${benchmark.id}, panel ${panelId}, skipping CheckResults creation`
        );
        return null;
      }

      this.logger.info(`Valid requirement found for benchmark ${benchmark.id}, proceeding with CheckResults creation`);

      // Prepare regex for matchPattern from configuration if set
      // Based on requirement_checker.py:134-141
      // Using safe-regex validation to prevent ReDoS attacks
      let regex: RegExp | null = null;
      const matchPattern = config?.matchPattern as string | null | undefined;
      if (matchPattern) {
        const result = validateRegexPattern(matchPattern);
        if (result.safe && result.regex) {
          regex = result.regex;
        } else {
          this.logger.warn(`Invalid or unsafe matchPattern regex: ${matchPattern}${result.error ? ` - ${result.error}` : ''}`);
        }
      }

      // Process targets and check requirements
      // Based on requirement_checker.py:142-160
      const targetResults: CheckResultTarget[] = [];
      let overallMeetsRequirement = true;

      for (const targetData of aggregationResult.targets) {
        const isArtificial = targetData.isArtificial || false;
        const targetName = targetData.target;

        let targetResult: CheckResultTarget;

        // If matchPattern is set and does not match, set meets_requirement=null
        if (regex && !regex.test(targetName)) {
          targetResult = this.createTargetResult(targetData, benchmark);
          targetResult.meets_requirement = null;
        } else {
          targetResult = this.createTargetResult(targetData, benchmark);
        }

        if (isArtificial) {
          targetResult.is_artificial = true;
        }

        targetResults.push(targetResult);

        // Update overall requirement status
        if (targetResult.meets_requirement === false) {
          overallMeetsRequirement = false;
        }
      }

      // Check panel average requirement if available
      // Based on requirement_checker.py:162-171
      // Note: Panel average should only be checked when averageAll is true
      let panelMeetsRequirement: boolean | null = null;
      if (benchmark.average_all && aggregationResult.panel_average !== null && this.hasValidRequirement(benchmark)) {
        panelMeetsRequirement = this.checkRequirement(
          aggregationResult.panel_average,
          benchmark
        );
        if (panelMeetsRequirement === false) {
          overallMeetsRequirement = false;
        }
      }

      // Determine final status and message
      // Based on requirement_checker.py:172-176
      const status = targetResults.length === 0 ? 'ERROR' : 'COMPLETE';
      const message = this.generateStatusMessage(
        overallMeetsRequirement,
        targetResults.length,
        aggregationResult
      );

      // Extract panel configuration
      const panelId = (config?.id as number | null | undefined) ?? null;
      const panelType = (config?.type as string | undefined) || 'graph';
      const panelTitle = this.stripPanelTitlePrefix(benchmark.panel_title || '');
      const panelYAxesFormat = (config?.yAxesFormat as string | null | undefined) ?? null;

      // Create CheckResult document
      // Based on requirement_checker.py:187-231
      // check_results.organization_id is NOT NULL; a run without one means legacy data the
      // 1796 backfill refused to constrain — name the run instead of surfacing a bare 23502.
      if (!testRun.organization_id) {
        throw new RequirementCheckError(
          `test run ${testRun.test_run_id} has no organization_id — backfill test_runs before re-evaluating checks`
        );
      }

      const checkResult: CheckResult = {
        system_under_test_id: testRun.system_under_test_id,
        organization_id: testRun.organization_id,
        team_id: testRun.team_id ?? null,
        test_environment: testRun.test_environment,
        workload: testRun.workload,
        test_run_id: testRun.test_run_id,
        dashboard_label: benchmark.dashboard_label,
        dashboard_uid: benchmark.dashboard_uid,
        application_dashboard_id: benchmark.application_dashboard_id,
        panel_title: panelTitle,
        panel_id: panelId,
        panel_type: panelType,
        panel_y_axes_format: panelYAxesFormat,
        metric_name: null, // This would come from benchmark if available
        metric_unit: benchmark.metric_unit || null,
        benchmark_id: benchmark.id,
        status: status,
        message: message,
        average_all: benchmark.average_all,
        evaluate_type: benchmark.evaluate_type || 'mean',
        exclude_ramp_up_time: benchmark.exclude_ramp_up_time,
        ramp_up: testRun.ramp_up || 0,
        match_pattern: matchPattern || null,
        requirement: this.convertRequirement(benchmark),
        panel_average: aggregationResult.panel_average,
        meets_requirement: targetResults.length > 0 ? overallMeetsRequirement : null,
        targets: targetResults,
        validate_with_default_if_no_data: benchmark.validate_with_default_if_no_data,
        validate_with_default_if_no_data_value: benchmark.validate_with_default_if_no_data_value || 0.0,
        tags: [] // Would come from benchmark if available
      };

      this.logger.info(`Successfully created CheckResult for benchmark ${benchmark.id}`);
      return checkResult;

    } catch (error) {
      this.logger.error(`Exception during check result creation for benchmark ${benchmark.id}: ${error}`);
      throw new RequirementCheckError(`Failed to create check result for benchmark ${benchmark.id}: ${error}`);
    }
  }

  /**
   * Save check result to database
   * This is separate from createCheckResult to allow for batch operations
   */
  async saveCheckResult(checkResult: CheckResult): Promise<void> {
    const insertSql = `
      INSERT INTO check_results (
        system_under_test_id, test_environment, workload, test_run_id,
        dashboard_label, dashboard_uid, application_dashboard_id, panel_title, panel_id, panel_type,
        panel_y_axes_format, metric_name, metric_unit, benchmark_id, status, message,
        average_all, evaluate_type, exclude_ramp_up_time, ramp_up,
        match_pattern, requirement, panel_average, meets_requirement,
        targets, validate_with_default_if_no_data, validate_with_default_if_no_data_value,
        tags, organization_id, team_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, NOW(), NOW()
      )
    `;

    await this.client.query(insertSql, [
      checkResult.system_under_test_id,
      checkResult.test_environment,
      checkResult.workload,
      checkResult.test_run_id,
      checkResult.dashboard_label,
      checkResult.dashboard_uid,
      checkResult.application_dashboard_id,
      checkResult.panel_title,
      checkResult.panel_id,
      checkResult.panel_type,
      checkResult.panel_y_axes_format,
      checkResult.metric_name,
      checkResult.metric_unit,
      checkResult.benchmark_id,
      checkResult.status,
      checkResult.message,
      checkResult.average_all,
      checkResult.evaluate_type,
      checkResult.exclude_ramp_up_time,
      checkResult.ramp_up,
      checkResult.match_pattern,
      JSON.stringify(checkResult.requirement),
      checkResult.panel_average,
      checkResult.meets_requirement,
      JSON.stringify(checkResult.targets),
      checkResult.validate_with_default_if_no_data,
      checkResult.validate_with_default_if_no_data_value,
      checkResult.tags,
      checkResult.organization_id,
      checkResult.team_id ?? null
    ]);
  }

  /**
   * Check if benchmark has valid requirement configuration
   * Based on requirement_checker.py:100-124
   */
  private hasValidRequirement(benchmark: Benchmark): boolean {
    const hasOperator = benchmark.requirement_operator !== null && benchmark.requirement_operator !== undefined;
    const hasValue = benchmark.requirement_value !== null && benchmark.requirement_value !== undefined;
    return hasOperator || hasValue;
  }

  /**
   * Create a CheckResultTarget from target aggregation data
   * Based on requirement_checker.py:242-266
   */
  private createTargetResult(
    targetData: MetricTarget,
    benchmark: Benchmark
  ): CheckResultTarget {
    const targetName = targetData.target;
    const targetValue = targetData.value;

    let meetsRequirement: boolean | null = null;
    if (targetValue !== null && this.hasValidRequirement(benchmark)) {
      meetsRequirement = this.checkRequirement(targetValue, benchmark);
    }

    return {
      target: targetName,
      value: targetValue,
      meets_requirement: meetsRequirement,
      is_artificial: false // Will be set later if needed
    };
  }

  /**
   * Check if a value meets the requirement
   * Based on requirement_checker.py:268-306
   */
  private checkRequirement(value: number, benchmark: Benchmark): boolean {
    if (!this.hasValidRequirement(benchmark)) {
      return true;
    }

    const operator = benchmark.requirement_operator;
    const threshold = benchmark.requirement_value;

    if (!operator || threshold === null || threshold === undefined) {
      return true;
    }

    // Ensure threshold is a number
    const thresholdFloat = parseFloat(threshold.toString());
    if (isNaN(thresholdFloat)) {
      this.logger.warn(`Invalid threshold value: ${threshold}, cannot convert to float`);
      return true;
    }

    const operatorStr = operator.toLowerCase();

    if (operatorStr === 'lt') {
      return value < thresholdFloat;
    } else if (operatorStr === 'gt') {
      return value > thresholdFloat;
    } else {
      this.logger.warn(`Unknown requirement operator: ${operatorStr}`);
      return true;
    }
  }

  /**
   * Convert benchmark requirement config to requirement object
   * Based on requirement_checker.py:308-338
   */
  private convertRequirement(benchmark: Benchmark): { operator: string; value: number } | null {
    if (!this.hasValidRequirement(benchmark)) {
      return null;
    }

    const operator = benchmark.requirement_operator;
    const value = benchmark.requirement_value;

    if (!operator || value === null || value === undefined) {
      return null;
    }

    try {
      return {
        operator: operator,
        value: parseFloat(value.toString())
      };
    } catch (error) {
      this.logger.warn(`Failed to convert requirement: ${error}`);
      return null;
    }
  }

  /**
   * Generate a status message for the check result
   * Based on requirement_checker.py:380-398
   */
  private generateStatusMessage(
    meetsRequirement: boolean,
    targetCount: number,
    aggregationResult: AggregationResult
  ): string {
    if (targetCount === 0) {
      return 'No targets found for processing';
    }

    if (meetsRequirement) {
      return `All ${targetCount} targets meet requirements`;
    } else {
      const failedCount = aggregationResult.targets.filter(
        target => target.value !== null // This would be more sophisticated in the real implementation
      ).length;
      return `${failedCount} of ${targetCount} targets failed requirements`;
    }
  }

  /**
   * Strip panel title prefix
   * Based on requirement_checker.py:400-405
   */
  private stripPanelTitlePrefix(title: string): string {
    if (!title) {
      return title;
    }
    if (title.includes('-')) {
      return title.split('-', 2)[1]?.trim() || title;
    }
    return title;
  }
}