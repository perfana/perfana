import { Injectable } from '@nestjs/common';
import { TestRunsQueryService } from './services/test-runs-query.service';
import { TestRunsMutationService } from './services/test-runs-mutation.service';
import { TestRunsConfigService } from './services/test-runs-config.service';
import { TestRunsAnomalyService } from './services/test-runs-anomaly.service';
import { TestRunsChangepointService } from './services/test-runs-changepoint.service';
import { TestRunsMetricsService } from './services/test-runs-metrics.service';
import { TestRunsApdexService } from './services/test-runs-apdex.service';
import { UpdateRunningTestDto } from './dto/update-running-test.dto';
import { AddTestRunConfigDto, AddTestRunConfigsDto, AddTestRunConfigJsonDto } from './dto/test-run-config.dto';
import { InitTestDto, InitTestResponse } from './dto/init-test.dto';
import { CreateExpectedConfigChangeDto, ExpectedConfigChangeDto } from './dto/expected-config-change.dto';
import { CreateSparseMetricExclusionDto, SparseMetricExclusionDto } from './dto/sparse-metric-exclusion.dto';
import { CreateMetricClassificationDto, MetricClassificationDto } from './dto/metric-classification.dto';
import { CreateDsCompareConfigDto, UpdateDsCompareConfigDto, DsCompareConfigDto } from './dto/ds-compare-config.dto';
import { DeleteAnomalyDto } from './dto/delete-anomaly.dto';
import { SetApdexThresholdDto, WorkloadApdexThresholdDto, WorkloadTransactionApdexThresholdDto } from './dto/apdex-threshold.dto';
import { PaginationQueryDto, PaginatedResponseDto } from '../../common/dto';
import {
  TestRunStatus,
  ConsolidatedResult,
  AdaptConfig,
  TestRunVariables,
  DeepLinksCollection
} from '../../types';

export interface TestRun {
  id: string;
  test_run_id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  start_time?: string;
  end_time?: string;
  duration?: number;
  planned_duration?: number;
  ramp_up?: number;
  completed: boolean;
  abort?: boolean;
  is_stale?: boolean;
  stale_detected_at?: string;
  completion_percentage?: number;
  status?: TestRunStatus;
  consolidated_result?: ConsolidatedResult;
  annotations?: string[];
  tags?: string[];
  application_release?: string;
  ci_build_results_url?: string;
  expires?: string;
  expired?: boolean;
  valid?: boolean;
  reasons_not_valid?: string[];
  data_warnings?: string[];
  adapt_config?: AdaptConfig;
  variables?: TestRunVariables;
  deep_links?: DeepLinksCollection;
  created_at: string;
  updated_at: string;
  systems_under_test?: {
    name: string;
    pyroscope_instance_id?: string;
    pyroscope_configurations?: Array<{ application: string; profiler: string }>;
    pyroscopeInstance?: {
      id: string;
      label: string;
      pyroscope_url: string;
      pyroscope_stand_alone: boolean;
    };
  };
  is_changepoint?: boolean;
  is_control_group?: boolean;
  system_name?: string;
}

/**
 * TestRunsService - Main facade for test run operations.
 *
 * Authorization:
 * - All methods accept userId and roles parameters for authorization
 * - Parameters are passed through to sub-services for filtering and permission checks
 * - Global admins bypass all authorization checks
 *
 * Sub-services:
 * - TestRunsQueryService: Query operations (list, find, search)
 * - TestRunsMutationService: Mutation operations (create, update, delete)
 * - TestRunsConfigService: Configuration management
 * - TestRunsAnomalyService: Anomaly detection results
 * - TestRunsChangepointService: Changepoint management
 * - TestRunsMetricsService: Metrics classification and comparison
 * - TestRunsApdexService: Apdex threshold management
 */
@Injectable()
export class TestRunsService {

  constructor(
    private queryService: TestRunsQueryService,
    private mutationService: TestRunsMutationService,
    private configService: TestRunsConfigService,
    private anomalyService: TestRunsAnomalyService,
    private changepointService: TestRunsChangepointService,
    private metricsService: TestRunsMetricsService,
    private apdexService: TestRunsApdexService,
  ) {}

  // ========== Authorization ==========

  /**
   * Verify the current user can access a test run.
   * Throws ForbiddenException if access denied.
   */
  async verifyTestRunAccess(testRunId: string, userId: string, roles: string[]): Promise<void> {
    return this.queryService.verifyTestRunAccess(testRunId, userId, roles);
  }

  // ========== Query Methods (delegated to QueryService) ==========

  async findAllPaginated(userId: string, roles: string[], paginationDto?: PaginationQueryDto, organizationId?: string): Promise<PaginatedResponseDto<TestRun>> {
    return this.queryService.findAllPaginated(userId, roles, paginationDto, organizationId);
  }

  async findAll(userId: string, roles: string[]): Promise<TestRun[]> {
    return this.queryService.findAll(userId, roles);
  }

  async findByTestRunId(testRunId: string, userId: string, roles: string[]): Promise<TestRun> {
    return this.queryService.findByTestRunId(testRunId, userId, roles);
  }

  async findOne(id: string, userId: string, roles: string[]): Promise<TestRun> {
    return this.queryService.findOne(id, userId, roles);
  }

  async getTestRunByTestRunId(testRunId: string, userId: string, roles: string[]): Promise<TestRun | null> {
    return this.queryService.getTestRunByTestRunId(testRunId, userId, roles);
  }

  async findByTestRunIdAndParams(testRunId: string, systemName: string, environment: string, workload: string, userId: string, roles: string[], organizationId?: string): Promise<TestRun> {
    return this.queryService.findByTestRunIdAndParams(testRunId, systemName, environment, workload, userId, roles, organizationId);
  }

  async getRelatedTestRuns(testRunId: string, userId: string, roles: string[], system?: string, environment?: string, workload?: string): Promise<Array<{test_run_id: string; created_at: string}>> {
    return this.queryService.getRelatedTestRuns(testRunId, userId, roles, system, environment, workload);
  }

  async getSystemsSummary(userId: string, roles: string[], organizationId?: string): Promise<Array<{
    id: string;
    name: string;
    environments: Array<{
      environment: string;
      workloads: string[];
    }>;
    created_at: string;
  }>> {
    return this.queryService.getSystemsSummary(userId, roles, organizationId);
  }

  async getAllTags(userId: string, roles: string[]): Promise<string[]> {
    return this.queryService.getAllTags(userId, roles);
  }

  async getAllAnnotations(userId: string, roles: string[]): Promise<string[]> {
    return this.queryService.getAllAnnotations(userId, roles);
  }

  async getTransactionStats(testRunId: string, userId: string, roles: string[], excludeRampUp: boolean = false, sinceMinutes?: number): Promise<Array<{
    transaction_name: string;
    scenario_name?: string;
    avg_response_time: number;
    p95_response_time: number;
    p99_response_time: number;
    passed_count: number;
    failed_count: number;
    total_count: number;
    ranking: number;
    apdex_score: number;
    active_threshold: number;
  }>> {
    return this.queryService.getTransactionStats(testRunId, userId, roles, excludeRampUp, sinceMinutes);
  }

  async getTransactionSamples(testRunId: string, transactionName: string, userId: string, roles: string[], excludeRampUp: boolean = false, sinceMinutes?: number): Promise<Array<{
    sampler_name: string;
    scenario_name?: string;
    avg_response_time: number;
    min_response_time: number;
    max_response_time: number;
    p95_response_time: number;
    p99_response_time: number;
    passed_count: number;
    failed_count: number;
    total_count: number;
    avg_latency: number;
    avg_connect_time: number;
    total_request_size: number;
    total_response_size: number;
    apdex_score: number;
    active_threshold: number;
  }>> {
    return this.queryService.getTransactionSamples(testRunId, transactionName, userId, roles, excludeRampUp, sinceMinutes);
  }

  async getTransactionErrors(testRunId: string, userId: string, roles: string[], transactionName?: string, samplerName?: string): Promise<Array<{
    error_type: string;
    response_code: string;
    response_message: string;
    sampler_name: string;
    url: string;
    count: number;
    first_occurrence: string;
    last_occurrence: string;
    sample_response_data: string;
  }>> {
    return this.queryService.getTransactionErrors(testRunId, userId, roles, transactionName, samplerName);
  }

  async getTransactionTimeSeries(testRunId: string, transactionName: string, userId: string, roles: string[], aggregationSeconds: number = 1, excludeRampUp: boolean = false) {
    return this.queryService.getTransactionTimeSeries(testRunId, transactionName, userId, roles, aggregationSeconds, excludeRampUp);
  }

  async getSamplerTimeSeries(testRunId: string, transactionName: string, samplerName: string, userId: string, roles: string[], aggregationSeconds: number = 5, excludeRampUp: boolean = false) {
    return this.queryService.getSamplerTimeSeries(testRunId, transactionName, samplerName, userId, roles, aggregationSeconds, excludeRampUp);
  }

  async getVirtualUserStats(testRunId: string, userId: string, roles: string[], excludeRampUp: boolean = false) {
    return this.queryService.getVirtualUserStats(testRunId, userId, roles, excludeRampUp);
  }

  async getThroughputStats(testRunId: string, userId: string, roles: string[], excludeRampUp: boolean = false) {
    return this.queryService.getThroughputStats(testRunId, userId, roles, excludeRampUp);
  }

  // ========== Dashboard Methods (delegated to QueryService) ==========

  async getDashboardStatistics(userId: string, roles: string[], timePeriod: '24h' | '7d' | '30d' | 'all' | 'custom' = '7d', from?: string, to?: string, organizationId?: string) {
    return this.queryService.getDashboardStatistics(userId, roles, timePeriod, from, to, organizationId);
  }

  async getRecentFailures(userId: string, roles: string[], limit: number = 5, timePeriod: '24h' | '7d' | '30d' | 'all' | 'custom' = '7d', from?: string, to?: string, organizationId?: string) {
    return this.queryService.getRecentFailures(userId, roles, limit, timePeriod, from, to, organizationId);
  }

  async recordTestRunView(userId: string, testRunId: string): Promise<void> {
    return this.queryService.recordTestRunView(userId, testRunId);
  }

  async getDashboardSystemsSummary(userId: string, roles: string[], organizationId?: string) {
    return this.queryService.getDashboardSystemsSummary(userId, roles, organizationId);
  }

  async getBaselineCandidates(systemUnderTestId: string, testEnvironment: string, workload: string, userId: string, roles: string[], excludeTestRunId?: string, limit?: number): Promise<TestRun[]> {
    return this.queryService.getBaselineCandidates(systemUnderTestId, testEnvironment, workload, userId, roles, excludeTestRunId, limit);
  }

  // ========== Mutation Methods (delegated to MutationService) ==========

  async updateRunningTest(
    updateDto: UpdateRunningTestDto,
    userId: string,
    roles: string[],
    organizationId: string,
  ): Promise<TestRun> {
    const testRun = await this.mutationService.updateRunningTest(
      updateDto,
      userId,
      roles,
      organizationId,
    );

    // Associate string-based configs if this is a new test run
    if (testRun) {
      await this.configService.associateStringBasedConfigs(updateDto.testRunId, testRun.id);
    }

    return testRun;
  }

  async initTest(initDto: InitTestDto, userId: string, roles: string[], organizationId: string): Promise<InitTestResponse> {
    return this.mutationService.initTest(initDto, userId, roles, organizationId);
  }

  async deleteTestRun(id: string, userId: string, roles: string[]): Promise<void> {
    return this.mutationService.deleteTestRun(id, userId, roles);
  }

  async updateTags(id: string, tags: string[], userId: string, roles: string[]): Promise<TestRun> {
    return this.mutationService.updateTags(id, tags, userId, roles);
  }

  async updateAnnotations(id: string, annotations: string[], userId: string, roles: string[]): Promise<TestRun> {
    return this.mutationService.updateAnnotations(id, annotations, userId, roles);
  }

  async updateRampUp(id: string, rampUp: number, userId: string, roles: string[]): Promise<TestRun> {
    return this.mutationService.updateRampUp(id, rampUp, userId, roles);
  }

  async updateAdaptConfig(testRunId: string, differencesAccepted: 'ACCEPTED' | 'DENIED' | 'TBD', userId: string, roles: string[], systemUnderTestId?: string, environment?: string, workload?: string): Promise<TestRun> {
    return this.mutationService.updateAdaptConfig(testRunId, differencesAccepted, userId, roles, systemUnderTestId, environment, workload);
  }

  // ========== Config Methods (delegated to ConfigService) ==========

  async getTestRunConfigs(
    testRunId: string,
    system?: string,
    environment?: string,
    workload?: string,
    userId?: string,
    roles: string[] = [],
    _organizationId?: string, // Deprecated - no longer used, kept for backward compatibility
  ): Promise<Array<{key: string; value: string; tags: string[]}>> {
    return this.configService.getTestRunConfigs(testRunId, system, environment, workload, userId, roles);
  }

  async addTestRunConfig(configDto: AddTestRunConfigDto): Promise<void> {
    return this.configService.addTestRunConfig(configDto);
  }

  async addTestRunConfigs(configsDto: AddTestRunConfigsDto): Promise<void> {
    return this.configService.addTestRunConfigs(configsDto);
  }

  async addTestRunConfigJson(configJsonDto: AddTestRunConfigJsonDto): Promise<void> {
    return this.configService.addTestRunConfigJson(configJsonDto);
  }

  async getLatestConfigKeys(system: string, environment: string, workload: string, _userId?: string, _roles?: string[]): Promise<string[]> {
    return this.configService.getLatestConfigKeys(system, environment, workload);
  }

  async getExpectedConfigChanges(system: string, environment: string, workload: string, userId?: string, roles: string[] = []): Promise<ExpectedConfigChangeDto[]> {
    return this.configService.getExpectedConfigChanges(system, environment, workload, userId, roles);
  }

  async createExpectedConfigChange(createDto: CreateExpectedConfigChangeDto, _userId?: string, _roles?: string[]): Promise<ExpectedConfigChangeDto> {
    return this.configService.createExpectedConfigChange(createDto);
  }

  async deleteExpectedConfigChange(system: string, environment: string, workload: string, configKey: string, _userId?: string, _roles?: string[]): Promise<void> {
    return this.configService.deleteExpectedConfigChange(system, environment, workload, configKey);
  }

  // ========== Sparse Metric Exclusion Methods (delegated to ConfigService) ==========

  async getSparseMetricExclusions(system: string, environment: string, workload: string, _userId?: string, _roles?: string[]): Promise<SparseMetricExclusionDto[]> {
    return this.configService.getSparseMetricExclusions(system, environment, workload);
  }

  async createSparseMetricExclusion(createDto: CreateSparseMetricExclusionDto, _userId?: string, _roles?: string[]): Promise<SparseMetricExclusionDto> {
    return this.configService.createSparseMetricExclusion(createDto);
  }

  async deleteSparseMetricExclusion(system: string, environment: string, workload: string, dashboardLabel: string, metricName: string, _userId?: string, _roles?: string[]): Promise<void> {
    return this.configService.deleteSparseMetricExclusion(system, environment, workload, dashboardLabel, metricName);
  }

  // ========== Anomaly Methods (delegated to AnomalyService) ==========
  // Note: Anomaly methods don't require authorization yet (will be added when entity has org_id)

  async getTestRunCheckResults(testRunId: string, system?: string, environment?: string, workload?: string): Promise<any[]> {
    return this.anomalyService.getTestRunCheckResults(testRunId, system, environment, workload);
  }

  async getAnomalyDetectionResults(testRunId: string, system?: string, environment?: string, workload?: string) {
    return this.anomalyService.getAnomalyDetectionResults(testRunId, system, environment, workload);
  }

  async deleteAnomalyData(testRunId: string, deleteDto: DeleteAnomalyDto): Promise<{ deletedCount: number }> {
    return this.anomalyService.deleteAnomalyData(testRunId, deleteDto);
  }

  async getDsAdaptResult(testRunId: string, applicationDashboardId: string, panelId: string, metricName: string) {
    return this.anomalyService.getDsAdaptResult(testRunId, applicationDashboardId, panelId, metricName);
  }

  // ========== Changepoint Methods (delegated to ChangepointService) ==========
  // Note: Changepoint methods don't require authorization yet (will be added when entity has org_id)

  async isTestRunChangepoint(systemUnderTestId: string, testEnvironment: string, workload: string, testRunId: string): Promise<boolean> {
    return this.changepointService.isTestRunChangepoint(systemUnderTestId, testEnvironment, workload, testRunId);
  }

  async getTestRunsMoreRecentThan(systemUnderTestId: string, testEnvironment: string, workload: string, baseTestRunId: string, _userId?: string, _roles?: string[]): Promise<{ testRunIds: string[] }> {
    return this.changepointService.getTestRunsMoreRecentThan(systemUnderTestId, testEnvironment, workload, baseTestRunId);
  }

  async markAsChangepoint(systemUnderTestId: string, testEnvironment: string, workload: string, testRunId: string): Promise<{ message: string; jobId?: string; jobDetails?: any }> {
    return this.changepointService.markAsChangepoint(systemUnderTestId, testEnvironment, workload, testRunId);
  }

  async removeChangepoint(systemUnderTestId: string, testEnvironment: string, workload: string, testRunId: string): Promise<{ message: string; jobId?: string; jobDetails?: any }> {
    return this.changepointService.removeChangepoint(systemUnderTestId, testEnvironment, workload, testRunId);
  }

  async getTestRunsAfterMostRecentChangepoint(systemUnderTestId: string, testEnvironment: string, workload: string, _userId?: string, _roles?: string[]): Promise<{ changepointTestRunId?: string; testRunIds: string[] }> {
    return this.changepointService.getTestRunsAfterMostRecentChangepoint(systemUnderTestId, testEnvironment, workload);
  }

  // ========== Metrics Methods (delegated to MetricsService) ==========

  async classifyMetric(testRunId: string, createDto: CreateMetricClassificationDto, system?: string, environment?: string, workload?: string, userId?: string, roles?: string[]): Promise<MetricClassificationDto> {
    return this.metricsService.classifyMetric(testRunId, createDto, system, environment, workload, userId, roles);
  }

  async createOrUpdateDsCompareConfig(createDto: CreateDsCompareConfigDto, userId: string, roles: string[]): Promise<DsCompareConfigDto> {
    return this.metricsService.createOrUpdateDsCompareConfig(createDto, userId, roles);
  }

  async getDsCompareConfig(systemUnderTestId: string, testEnvironment: string, workload: string, applicationDashboardId: string, panelId: string, metricName?: string, userId?: string, roles?: string[]): Promise<DsCompareConfigDto> {
    return this.metricsService.getDsCompareConfig(systemUnderTestId, testEnvironment, workload, applicationDashboardId, panelId, metricName, userId, roles);
  }

  async updateDsCompareConfig(id: string, updateDto: UpdateDsCompareConfigDto, userId: string, roles: string[]): Promise<DsCompareConfigDto> {
    return this.metricsService.updateDsCompareConfig(id, updateDto, userId, roles);
  }

  async deleteDsCompareConfig(id: string, userId: string, roles: string[]): Promise<void> {
    return this.metricsService.deleteDsCompareConfig(id, userId, roles);
  }

  // ========== Apdex Methods (workload-scoped, delegated to ApdexService) ==========

  async getTestApdexThreshold(testRunId: string, userId: string, roles: string[]): Promise<WorkloadApdexThresholdDto> {
    // Fetch test run to extract workload properties
    const testRun = await this.queryService.findByTestRunId(testRunId, userId, roles);

    if (!testRun.system_under_test_id) {
      throw new Error('System under test ID not found for test run');
    }

    return this.apdexService.getWorkloadApdexThreshold(
      testRun.system_under_test_id,
      testRun.test_environment,
      testRun.workload,
      userId,
      roles,
    );
  }

  async setTestApdexThreshold(testRunId: string, dto: SetApdexThresholdDto, userId: string, roles: string[]): Promise<WorkloadApdexThresholdDto> {
    // Fetch test run to extract workload properties
    const testRun = await this.queryService.findByTestRunId(testRunId, userId, roles);

    if (!testRun.system_under_test_id) {
      throw new Error('System under test ID not found for test run');
    }

    return this.apdexService.setWorkloadApdexThreshold(
      testRun.system_under_test_id,
      testRun.test_environment,
      testRun.workload,
      dto,
      userId,
      roles,
    );
  }

  async getTransactionApdexThresholds(testRunId: string, userId: string, roles: string[]): Promise<WorkloadTransactionApdexThresholdDto[]> {
    // Fetch test run to extract workload properties
    const testRun = await this.queryService.findByTestRunId(testRunId, userId, roles);

    if (!testRun.system_under_test_id) {
      throw new Error('System under test ID not found for test run');
    }

    return this.apdexService.getWorkloadTransactionApdexThresholds(
      testRun.system_under_test_id,
      testRun.test_environment,
      testRun.workload,
      userId,
      roles,
    );
  }

  async setTransactionApdexThreshold(testRunId: string, transactionName: string, dto: SetApdexThresholdDto, userId: string, roles: string[]): Promise<WorkloadTransactionApdexThresholdDto> {
    // Fetch test run to extract workload properties
    const testRun = await this.queryService.findByTestRunId(testRunId, userId, roles);

    if (!testRun.system_under_test_id) {
      throw new Error('System under test ID not found for test run');
    }

    return this.apdexService.setWorkloadTransactionApdexThreshold(
      testRun.system_under_test_id,
      testRun.test_environment,
      testRun.workload,
      transactionName,
      dto,
      userId,
      roles,
    );
  }

  async deleteTransactionApdexThreshold(testRunId: string, transactionName: string, userId: string, roles: string[]): Promise<{ message: string }> {
    // Fetch test run to extract workload properties
    const testRun = await this.queryService.findByTestRunId(testRunId, userId, roles);

    if (!testRun.system_under_test_id) {
      throw new Error('System under test ID not found for test run');
    }

    return this.apdexService.deleteWorkloadTransactionApdexThreshold(
      testRun.system_under_test_id,
      testRun.test_environment,
      testRun.workload,
      transactionName,
      userId,
      roles,
    );
  }

  async getRequestNames(testRunId: string, userId: string, roles: string[], panelDescription?: string): Promise<string[]> {
    return this.queryService.getRequestNames(testRunId, userId, roles, panelDescription);
  }
}
