import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import {
  AnalyzeFlamegraphDto,
  FlamegraphAnalysisResponseDto,
  FlamegraphDiffDto,
} from './dto/pyroscope-analysis.dto';
import { validateExternalUrl } from '../../common/security/url-validator';

/**
 * Pyroscope profile structure (flamebearer format)
 */
interface PyroscopeProfile {
  flamebearer: {
    names: string[];
    levels: number[][];
    numTicks: number;
    maxSelf: number;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Service for analyzing Pyroscope flamegraphs
 * Provides functionality to fetch profiles from Pyroscope API and perform differential analysis
 */
@Injectable()
export class PyroscopeAnalysisService {
  private readonly logger = new Logger(PyroscopeAnalysisService.name);

  /**
   * Analyze flamegraphs between baseline and current test runs
   *
   * @param params - Analysis parameters including Pyroscope URL, application, time ranges
   * @returns Flamegraph analysis with function-level differences
   */
  async analyzeFlamegraphs(params: AnalyzeFlamegraphDto): Promise<FlamegraphAnalysisResponseDto> {
    const {
      backendUrl,
      application,
      profilerLabel,
      baselineStartTime,
      baselineEndTime,
      currentStartTime,
      currentEndTime,
      significanceThreshold = 100,
    } = params;

    try {
      // Check if backend URL is provided
      if (!backendUrl) {
        this.logger.warn('Backend URL is required for flamegraph analysis');
        return {
          summary: {
            baselineTotal: 0,
            currentTotal: 0,
            totalDelta: 0,
            totalDeltaPercent: 0,
          },
          topFunctionChanges: [],
          regressions: [],
          improvements: [],
          newHotspots: [],
          improvedFunctions: [],
          tableReport: '',
          error: 'Backend URL is required for flamegraph analysis. Please configure the backend API URL for this Pyroscope instance.',
        };
      }

      // Validate time ranges
      if (baselineStartTime >= baselineEndTime) {
        throw new HttpException(
          'Baseline start time must be before baseline end time',
          HttpStatus.BAD_REQUEST
        );
      }
      if (currentStartTime >= currentEndTime) {
        throw new HttpException(
          'Current start time must be before current end time',
          HttpStatus.BAD_REQUEST
        );
      }

      // Fetch both profiles in parallel
      this.logger.log(
        `Fetching flamegraphs for ${application} with profiler ${profilerLabel}`
      );

      const [baselineProfile, currentProfile] = await Promise.all([
        this.fetchPyroscopeFlamegraph(
          backendUrl,
          application,
          profilerLabel,
          baselineStartTime,
          baselineEndTime
        ),
        this.fetchPyroscopeFlamegraph(
          backendUrl,
          application,
          profilerLabel,
          currentStartTime,
          currentEndTime
        ),
      ]);

      // Parse profiles to function samples
      const baselineSamples = this.parseFlamebearerToSamples(baselineProfile);
      const currentSamples = this.parseFlamebearerToSamples(currentProfile);

      // Compare profiles
      const analysis = this.compareFlamegraphs(
        baselineSamples,
        currentSamples,
        baselineProfile.flamebearer.numTicks,
        currentProfile.flamebearer.numTicks,
        significanceThreshold
      );

      this.logger.log(
        `Analysis complete: ${analysis.topFunctionChanges.length} function changes detected`
      );

      return analysis;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error during flamegraph analysis';

      this.logger.error('Failed to analyze flamegraphs:', errorMessage);

      // Return error in response instead of throwing
      return {
        summary: {
          baselineTotal: 0,
          currentTotal: 0,
          totalDelta: 0,
          totalDeltaPercent: 0,
        },
        topFunctionChanges: [],
        regressions: [],
        improvements: [],
        newHotspots: [],
        improvedFunctions: [],
        tableReport: '',
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch flamegraph data from Pyroscope API
   *
   * @param pyroscopeUrl - Pyroscope instance URL
   * @param application - Application name
   * @param profilerLabel - Profiler type label
   * @param from - Start time (Unix timestamp in milliseconds)
   * @param until - End time (Unix timestamp in milliseconds)
   * @returns Pyroscope profile data
   */
  private async fetchPyroscopeFlamegraph(
    pyroscopeUrl: string,
    application: string,
    profilerLabel: string,
    from: number,
    until: number
  ): Promise<PyroscopeProfile> {
    // Map profilerLabel back to full profile type
    // profilerLabel is like "process_cpu/cpu", need to convert to full type
    const profileTypeMap: Record<string, string> = {
      'process_cpu/cpu': 'process_cpu:cpu:nanoseconds:cpu:nanoseconds',
      'memory/alloc_in_new_tlab_bytes': 'memory:alloc_in_new_tlab_bytes:bytes:space:bytes',
      'memory/alloc_in_new_tlab_objects': 'memory:alloc_in_new_tlab_objects:count:space:bytes',
      'mutex/contentions': 'mutex:contentions:count:mutex:count',
      'mutex/delay': 'mutex:delay:nanoseconds:mutex:count',
      'block/contentions': 'block:contentions:count:block:count',
      'block/delay': 'block:delay:nanoseconds:block:count',
    };

    const profileType = profileTypeMap[profilerLabel] || profilerLabel;

    // Build Pyroscope query: profile-type{label-matchers}
    const query = `${profileType}{service_name="${application}"}`;

    // Convert milliseconds to seconds for Pyroscope API
    const fromSeconds = Math.floor(from / 1000);
    const untilSeconds = Math.floor(until / 1000);

    // Validate URL to prevent SSRF
    const urlValidation = validateExternalUrl(pyroscopeUrl);
    if (!urlValidation.isValid) {
      throw new HttpException(
        `Invalid Pyroscope URL: ${urlValidation.error}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Normalize the base URL (remove trailing slash)
    const baseUrl = pyroscopeUrl.replace(/\/$/, '');

    // Build API URL
    const url = `${baseUrl}/pyroscope/render?query=${encodeURIComponent(
      query
    )}&from=${fromSeconds}&until=${untilSeconds}&format=json`;

    this.logger.debug(`Fetching profile from: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new HttpException(
          `Pyroscope API error: ${response.status} ${response.statusText} - ${errorText}`,
          HttpStatus.BAD_GATEWAY
        );
      }

      const data = await response.json();
      return data as PyroscopeProfile;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error fetching from Pyroscope API';

      throw new HttpException(
        `Failed to fetch Pyroscope profile: ${errorMessage}`,
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  /**
   * Parse Pyroscope flamebearer format to function sample counts
   *
   * @param profile - Pyroscope profile data
   * @returns Map of function names to sample counts
   */
  private parseFlamebearerToSamples(profile: PyroscopeProfile): Map<string, number> {
    const { names, levels } = profile.flamebearer;
    const samples = new Map<string, number>();

    this.logger.debug(`Parsing flamebearer: ${names.length} names, ${levels.length} levels`);

    // The first name is usually "total" which is the root aggregation node - get its index
    const totalIndex = names.indexOf('total');
    this.logger.debug(`Total function index: ${totalIndex}`);

    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalWithSamples = 0;

    // Flamebearer format: levels array contains arrays of [offset, total, self, nameIndex]
    // Each entry is 4 values: offset, total samples, self samples, name index
    // We care about 'self' samples which represent CPU time in that specific function
    for (const level of levels) {
      for (let i = 0; i < level.length; i += 4) {
        // Skip offset and total for now (may be used in future enhancements)
        // const offset = level[i];
        // const total = level[i + 1];
        const self = level[i + 2];
        const nameIndex = level[i + 3]; // Name index is the 4th value

        totalProcessed++;

        // Skip the root "total" aggregation node (nameIndex equals totalIndex)
        if (nameIndex === totalIndex) {
          if (self !== undefined && self > 0) {
            totalSkipped++;
          }
          continue;
        }

        if (
          nameIndex !== undefined &&
          self !== undefined &&
          nameIndex < names.length &&
          self > 0
        ) {
          totalWithSamples++;
          const functionName = names[nameIndex];

          if (functionName) {
            const currentSamples = samples.get(functionName) || 0;
            samples.set(functionName, currentSamples + self);
          }
        }
      }
    }

    this.logger.log(
      `Parsed flamegraph: processed=${totalProcessed}, withSamples=${totalWithSamples}, ` +
      `skippedTotal=${totalSkipped}, unique functions=${samples.size}`
    );

    // Log top 5 functions for debugging
    const topFunctions = Array.from(samples.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    this.logger.log(`Top 5 functions: ${JSON.stringify(topFunctions.map(([name, count]) => [name.substring(0, 50), count]))}`);

    return samples;
  }

  /**
   * Compare flamegraphs and identify significant function-level changes
   *
   * @param baselineSamples - Function samples from baseline
   * @param currentSamples - Function samples from current test
   * @param baselineTotal - Total samples in baseline
   * @param currentTotal - Total samples in current test
   * @param significanceThreshold - Minimum absolute delta to be considered significant
   * @returns Flamegraph analysis with differences
   */
  private compareFlamegraphs(
    baselineSamples: Map<string, number>,
    currentSamples: Map<string, number>,
    baselineTotal: number,
    currentTotal: number,
    significanceThreshold: number
  ): FlamegraphAnalysisResponseDto {
    // Calculate total delta
    const totalDelta = currentTotal - baselineTotal;
    const totalDeltaPercent = baselineTotal > 0 ? (totalDelta / baselineTotal) * 100 : 0;

    // Collect all function names
    const allFunctions = new Set([...baselineSamples.keys(), ...currentSamples.keys()]);

    // Calculate per-function deltas
    const functionDiffs: FlamegraphDiffDto[] = [];

    for (const func of allFunctions) {
      const baselineCount = baselineSamples.get(func) || 0;
      const currentCount = currentSamples.get(func) || 0;
      const delta = currentCount - baselineCount;

      // Skip if delta is too small (unless it's a new or removed function)
      if (Math.abs(delta) < 10 && baselineCount > 0 && currentCount > 0) {
        continue;
      }

      const deltaPercent = baselineCount > 0 ? (delta / baselineCount) * 100 : 0;
      const baselinePercent = baselineTotal > 0 ? (baselineCount / baselineTotal) * 100 : 0;
      const currentPercent = currentTotal > 0 ? (currentCount / currentTotal) * 100 : 0;

      // Classify significance based on absolute delta
      let significance: 'high' | 'medium' | 'low';
      const absDelta = Math.abs(delta);

      if (absDelta >= significanceThreshold * 2) {
        significance = 'high';
      } else if (absDelta >= significanceThreshold) {
        significance = 'medium';
      } else {
        significance = 'low';
      }

      // Classify change type (Differential Flame Graph classification)
      let changeType: 'regression' | 'improvement' | 'new' | 'removed' | 'stable';

      if (baselineCount === 0 && currentCount >= significanceThreshold) {
        // NEW: Completely new hot path (red in DFG)
        changeType = 'new';
        significance = 'high'; // New hotspots are always significant
      } else if (currentCount === 0 && baselineCount >= significanceThreshold) {
        // REMOVED: Function completely removed (blue in DFG)
        changeType = 'removed';
        significance = 'high'; // Removed hotspots are always significant
      } else if (delta > 0 && (significance !== 'low' || deltaPercent > 20)) {
        // REGRESSION: Widened hot path (red in DFG)
        // Function is taking more CPU time
        changeType = 'regression';
      } else if (delta < 0 && (significance !== 'low' || Math.abs(deltaPercent) > 20)) {
        // IMPROVEMENT: Narrowed path (blue in DFG)
        // Function is taking less CPU time
        changeType = 'improvement';
      } else {
        // STABLE: Minor change
        changeType = 'stable';
      }

      functionDiffs.push({
        function: func,
        baselineSamples: baselineCount,
        currentSamples: currentCount,
        delta,
        deltaPercent,
        significance,
        changeType,
        baselinePercent,
        currentPercent,
      });
    }

    // Sort by absolute delta (largest first)
    functionDiffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    // Extract regressions (red - widened or new hot paths)
    const regressions = functionDiffs
      .filter(diff => diff.changeType === 'regression' || diff.changeType === 'new')
      .filter(diff => diff.significance !== 'low')
      .slice(0, 20); // Top 20 regressions

    // Extract improvements (blue - narrowed or removed paths)
    const improvements = functionDiffs
      .filter(diff => diff.changeType === 'improvement' || diff.changeType === 'removed')
      .filter(diff => diff.significance !== 'low')
      .slice(0, 20); // Top 20 improvements

    // Identify new hotspots (new wide towers)
    const newHotspots = functionDiffs
      .filter(diff => diff.changeType === 'new')
      .slice(0, 10)
      .map(diff => diff.function);

    // Identify improved functions (significantly narrowed)
    const improvedFunctions = functionDiffs
      .filter(diff =>
        (diff.changeType === 'improvement' || diff.changeType === 'removed') &&
        diff.significance !== 'low'
      )
      .slice(0, 10)
      .map(diff => diff.function);

    // Take top 20 changes for the report (prioritize regressions and improvements)
    const topFunctionChanges = functionDiffs
      .filter(diff => diff.changeType !== 'stable')
      .slice(0, 20);

    // Generate markdown table
    const tableReport = this.generateMarkdownTable(topFunctionChanges);

    return {
      summary: {
        baselineTotal,
        currentTotal,
        totalDelta,
        totalDeltaPercent,
      },
      topFunctionChanges,
      regressions,
      improvements,
      newHotspots,
      improvedFunctions,
      tableReport,
    };
  }

  /**
   * Generate markdown table from function differences
   *
   * @param diffs - Function differences
   * @returns Formatted markdown table
   */
  private generateMarkdownTable(diffs: FlamegraphDiffDto[]): string {
    const header =
      '| Function | Type | Baseline | Current | Delta | % Change | Significance |\n' +
      '|----------|------|----------|---------|-------|----------|--------------|';

    const rows = diffs.map((diff) => {
      const funcName = diff.function.length > 50 ? diff.function.substring(0, 47) + '...' : diff.function;
      const deltaStr = diff.delta > 0 ? `+${diff.delta}` : diff.delta.toString();
      const percentStr = diff.deltaPercent > 0 ? `+${diff.deltaPercent.toFixed(1)}%` : `${diff.deltaPercent.toFixed(1)}%`;

      // Color-code change types: 🔴 regression/new (red), 🔵 improvement/removed (blue)
      const typeEmoji =
        diff.changeType === 'regression' ? '🔴 Wider' :
        diff.changeType === 'new' ? '🔴 New' :
        diff.changeType === 'improvement' ? '🔵 Narrower' :
        diff.changeType === 'removed' ? '🔵 Removed' :
        '⚪ Stable';

      return `| ${funcName} | ${typeEmoji} | ${diff.baselineSamples} | ${diff.currentSamples} | ${deltaStr} | ${percentStr} | ${diff.significance} |`;
    });

    return `${header}\n${rows.join('\n')}`;
  }
}
