import { Injectable } from '@nestjs/common';
import {
  BenchmarkCalculatorService,
  BenchmarkQueryService,
  BenchmarkMutationService,
  ApdexPreviewResult,
  ApdexThresholdResult,
  CreateBenchmarkDto,
  UpdateBenchmarkDto,
  CreateApdexSloDto,
  UpdateApdexSloDto,
} from './services';
import { CopyBenchmarksDto } from './dto/copy-benchmarks.dto';

// Re-export types from sub-services for backwards compatibility
export {
  Benchmark,
  BenchmarkQuery,
  BenchmarkType,
  BenchmarkRequirement,
  BenchmarkConfiguration,
  BenchmarkTagSyncStatus,
} from './services';

// Re-export mutation DTOs for convenience
export type {
  CreateBenchmarkDto,
  UpdateBenchmarkDto,
  CreateApdexSloDto,
  UpdateApdexSloDto,
} from './services';

// Import types for internal use
import type {
  Benchmark,
  BenchmarkQuery,
  BenchmarkTagSyncStatus,
} from './services';

/**
 * Facade service that coordinates benchmark operations.
 * Delegates to specialized sub-services for query, mutation, and calculation operations.
 *
 * Authorization:
 * - All methods accept userId and roles parameters for authorization
 * - Parameters are passed through to sub-services for filtering and permission checks
 * - Global admins bypass all authorization checks
 *
 * Sub-services:
 * - BenchmarkQueryService: Query, filtering, and validation operations
 * - BenchmarkMutationService: Create, update, delete operations
 * - BenchmarkCalculatorService: Apdex calculations and thresholds
 */
@Injectable()
export class BenchmarksService {
  constructor(
    private readonly queryService: BenchmarkQueryService,
    private readonly mutationService: BenchmarkMutationService,
    private readonly calculatorService: BenchmarkCalculatorService,
  ) {}

  // ============================================================================
  // Query Operations (delegated to BenchmarkQueryService)
  // ============================================================================

  async findAll(userId: string, roles: string[], query: BenchmarkQuery = {}): Promise<Benchmark[]> {
    return this.queryService.findAll(userId, roles, query);
  }

  async getSystemEnvironmentsAndWorkloads(
    systemUnderTestId: string,
    userId: string,
    roles: string[],
  ): Promise<{
    environments: string[];
    workloads: string[];
  }> {
    return this.queryService.getSystemEnvironmentsAndWorkloads(systemUnderTestId, userId, roles);
  }

  async findOne(id: string, userId: string, roles: string[]): Promise<Benchmark | null> {
    return this.queryService.findOne(id, userId, roles);
  }

  async syncTagsWithApplicationDashboards(userId: string, roles: string[]): Promise<void> {
    return this.queryService.syncTagsWithApplicationDashboards(userId, roles);
  }

  async getBenchmarkTagSyncStatus(userId: string, roles: string[]): Promise<BenchmarkTagSyncStatus[]> {
    return this.queryService.getBenchmarkTagSyncStatus(userId, roles);
  }

  // ============================================================================
  // Mutation Operations (delegated to BenchmarkMutationService)
  // ============================================================================

  async create(userId: string, roles: string[], createBenchmarkDto: CreateBenchmarkDto): Promise<Benchmark> {
    return this.mutationService.create(userId, roles, createBenchmarkDto);
  }

  async update(
    id: string,
    userId: string,
    roles: string[],
    updateBenchmarkDto: UpdateBenchmarkDto,
  ): Promise<Benchmark | null> {
    return this.mutationService.update(id, userId, roles, updateBenchmarkDto);
  }

  async delete(id: string, userId: string, roles: string[]): Promise<boolean> {
    return this.mutationService.delete(id, userId, roles);
  }

  async copyToScope(
    userId: string,
    roles: string[],
    dto: CopyBenchmarksDto,
  ): Promise<{ copied: number; skipped: number; total: number }> {
    return this.mutationService.copyToScope(userId, roles, dto);
  }

  async createApdexSlo(userId: string, roles: string[], createDto: CreateApdexSloDto): Promise<Benchmark> {
    return this.mutationService.createApdexSlo(userId, roles, createDto);
  }

  async updateApdexSlo(
    id: string,
    userId: string,
    roles: string[],
    updateDto: UpdateApdexSloDto,
  ): Promise<Benchmark | null> {
    return this.mutationService.updateApdexSlo(id, userId, roles, updateDto);
  }

  // ============================================================================
  // Calculation Operations (delegated to BenchmarkCalculatorService)
  // ============================================================================

  /**
   * Get available transactions for a test run (for Apdex SLO configuration UI)
   *
   * Note: This method doesn't need authorization as it operates on test run data
   * which has its own authorization in the test runs module.
   */
  async getAvailableTransactions(testRunId: string): Promise<string[]> {
    return this.calculatorService.getAvailableTransactions(testRunId);
  }

  /**
   * Preview Apdex calculation for a test run (for Apdex SLO configuration UI)
   *
   * Note: This method doesn't need authorization as it operates on test run data
   * which has its own authorization in the test runs module.
   */
  async previewApdex(params: {
    testRunId: string;
    transactionName?: string;
    thresholdMs: number;
    includeFailedRequests?: boolean;
    excludeRampUp?: boolean;
  }): Promise<ApdexPreviewResult> {
    return this.calculatorService.previewApdex(params);
  }

  /**
   * Get configured Apdex threshold for a transaction/workload
   * Falls back through: transaction-specific → workload-level → default (500ms)
   *
   * Note: This method doesn't need authorization as it retrieves configuration
   * based on system/environment/workload context. Authorization should be
   * checked at the calling endpoint level.
   */
  async getApdexThreshold(params: {
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    transactionName?: string;
  }): Promise<ApdexThresholdResult> {
    return this.calculatorService.getApdexThreshold(params);
  }
}
