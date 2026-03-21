import { Injectable, Logger } from '@nestjs/common';
import { TempoService } from '../../tempo/tempo.service';
import {
  SearchTracesResponseDto,
  OTelTrace,
} from '../../tempo/dto/tempo.dto';

/**
 * Query parameters for searching traces in a test run
 */
export interface TraceSearchQuery {
  tracingInstanceId: string;
  serviceName: string;
  testRunId: string;
  scenario: string;
  transaction: string;
  sampler?: string;
  startTime: string;
  endTime: string;
  limit?: number;
}

/**
 * Result of a trace search operation
 */
export interface TraceSearchResult {
  searchResult: SearchTracesResponseDto;
  traces: OTelTrace[];
  warnings: string[];
}

/**
 * Combined results from searching current and baseline test runs
 */
export interface ComparisonTraceSearchResult {
  currentTraces: OTelTrace[];
  baselineTraces: OTelTrace[];
  warnings: string[];
}

/**
 * Service responsible for trace query operations.
 * Handles: searching for traces, fetching trace details, and managing query limits.
 */
@Injectable()
export class TraceQueryService {
  private readonly logger = new Logger(TraceQueryService.name);

  /**
   * Default limit for trace search results
   */
  private static readonly DEFAULT_SEARCH_LIMIT = 50;

  /**
   * Maximum number of traces to fetch for detailed analysis
   */
  private static readonly MAX_TRACES_TO_ANALYZE = 20;

  constructor(
    private readonly tempoService: TempoService,
  ) {}

  /**
   * Search for traces matching the given criteria
   */
  async searchTraces(query: TraceSearchQuery): Promise<SearchTracesResponseDto> {
    try {
      this.logger.debug(
        `Searching traces: service=${query.serviceName}, testRun=${query.testRunId}, ` +
        `scenario=${query.scenario}, transaction=${query.transaction}, sampler=${query.sampler || 'ALL'}`,
      );

      return await this.tempoService.searchTraces({
        tracingInstanceId: query.tracingInstanceId,
        serviceName: query.serviceName,
        testRunId: query.testRunId,
        scenario: query.scenario,
        transaction: query.transaction,
        sampler: query.sampler,
        startTime: query.startTime,
        endTime: query.endTime,
        limit: query.limit || TraceQueryService.DEFAULT_SEARCH_LIMIT,
      });
    } catch (error) {
      this.logger.error('Failed to search traces:', error);
      throw error;
    }
  }

  /**
   * Search for traces and fetch full trace details
   */
  async searchAndFetchTraces(query: TraceSearchQuery): Promise<TraceSearchResult> {
    const warnings: string[] = [];

    try {
      // Search for traces
      const searchResult = await this.searchTraces(query);

      this.logger.log(`Found ${searchResult.totalCount} traces for query`);

      if (searchResult.totalCount === 0) {
        return {
          searchResult,
          traces: [],
          warnings: ['No traces found for the specified criteria'],
        };
      }

      // Fetch full trace details (limit to first N traces for performance)
      const traceIds = searchResult.traces
        .slice(0, TraceQueryService.MAX_TRACES_TO_ANALYZE)
        .map((t) => t.traceId);

      const traces = await this.tempoService.getMultipleTraces(
        query.tracingInstanceId,
        traceIds,
      );

      this.logger.log(`Fetched ${traces.length} traces`);

      if (traces.length < searchResult.totalCount) {
        warnings.push(
          `Analyzed ${traces.length} of ${searchResult.totalCount} traces`,
        );
      }

      return {
        searchResult,
        traces,
        warnings,
      };
    } catch (error) {
      this.logger.error('Failed to search and fetch traces:', error);
      throw error;
    }
  }

  /**
   * Search and fetch traces for both current and baseline test runs
   * Used for trace comparison operations
   */
  async searchAndFetchComparisonTraces(
    currentQuery: TraceSearchQuery,
    baselineQuery: TraceSearchQuery,
  ): Promise<ComparisonTraceSearchResult> {
    const warnings: string[] = [];

    try {
      this.logger.log(
        `Comparing traces: current=${currentQuery.testRunId}, baseline=${baselineQuery.testRunId}`,
      );
      this.logger.log(
        `Current time range: ${currentQuery.startTime} to ${currentQuery.endTime}`,
      );
      this.logger.log(
        `Baseline time range: ${baselineQuery.startTime} to ${baselineQuery.endTime}`,
      );
      this.logger.log(
        `Filter: service=${currentQuery.serviceName}, scenario=${currentQuery.scenario}, ` +
        `transaction=${currentQuery.transaction}, sampler=${currentQuery.sampler || 'ALL'}`,
      );

      // Search for traces in both test runs concurrently
      const [currentSearchResult, baselineSearchResult] = await Promise.all([
        this.searchTraces(currentQuery),
        this.searchTraces(baselineQuery),
      ]);

      this.logger.log(
        `Found ${currentSearchResult.totalCount} current traces, ` +
        `${baselineSearchResult.totalCount} baseline traces`,
      );

      if (currentSearchResult.totalCount === 0) {
        warnings.push('No traces found for current test run');
      }
      if (baselineSearchResult.totalCount === 0) {
        warnings.push('No traces found for baseline test run');
      }

      // If either has no traces, return early with empty traces
      if (currentSearchResult.totalCount === 0 || baselineSearchResult.totalCount === 0) {
        return {
          currentTraces: [],
          baselineTraces: [],
          warnings,
        };
      }

      // Fetch full trace details (limit to first N traces for performance)
      const currentTraceIds = currentSearchResult.traces
        .slice(0, TraceQueryService.MAX_TRACES_TO_ANALYZE)
        .map((t) => t.traceId);
      const baselineTraceIds = baselineSearchResult.traces
        .slice(0, TraceQueryService.MAX_TRACES_TO_ANALYZE)
        .map((t) => t.traceId);

      const [currentTraces, baselineTraces] = await Promise.all([
        this.tempoService.getMultipleTraces(currentQuery.tracingInstanceId, currentTraceIds),
        this.tempoService.getMultipleTraces(baselineQuery.tracingInstanceId, baselineTraceIds),
      ]);

      this.logger.log(
        `Fetched ${currentTraces.length} current traces, ${baselineTraces.length} baseline traces`,
      );

      if (currentTraces.length < currentSearchResult.totalCount) {
        warnings.push(
          `Analyzed ${currentTraces.length} of ${currentSearchResult.totalCount} current traces`,
        );
      }
      if (baselineTraces.length < baselineSearchResult.totalCount) {
        warnings.push(
          `Analyzed ${baselineTraces.length} of ${baselineSearchResult.totalCount} baseline traces`,
        );
      }

      return {
        currentTraces,
        baselineTraces,
        warnings,
      };
    } catch (error) {
      this.logger.error('Failed to search and fetch comparison traces:', error);
      throw error;
    }
  }

  /**
   * Get multiple trace details by their IDs
   */
  async getTracesByIds(
    tracingInstanceId: string,
    traceIds: string[],
  ): Promise<OTelTrace[]> {
    try {
      this.logger.debug(`Fetching ${traceIds.length} traces`);
      return await this.tempoService.getMultipleTraces(tracingInstanceId, traceIds);
    } catch (error) {
      this.logger.error('Failed to fetch traces by IDs:', error);
      throw error;
    }
  }

  /**
   * Get the maximum number of traces that will be analyzed
   */
  getMaxTracesToAnalyze(): number {
    return TraceQueryService.MAX_TRACES_TO_ANALYZE;
  }

  /**
   * Get the default search limit
   */
  getDefaultSearchLimit(): number {
    return TraceQueryService.DEFAULT_SEARCH_LIMIT;
  }
}
