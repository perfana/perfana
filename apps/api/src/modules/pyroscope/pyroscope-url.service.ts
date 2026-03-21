import { Injectable, Logger } from '@nestjs/common';
import {
  GenerateSingleViewUrlDto,
  GenerateCompareUrlDto,
  PyroscopeUrlResponseDto,
  ProfilerTypeDto,
  PyroscopeViewMode,
  PyroscopeTheme
} from './dto/pyroscope-url.dto';

/**
 * Service for generating Pyroscope profiling URLs
 * Supports both standalone and Grafana-embedded Pyroscope instances
 */
@Injectable()
export class PyroscopeUrlService {
  private readonly logger = new Logger(PyroscopeUrlService.name);

  /**
   * Hardcoded profiler types based on legacy implementation
   * These represent common Java profiling metrics
   */
  private readonly PROFILER_TYPES: ProfilerTypeDto[] = [
    { value: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds', label: 'process_cpu/cpu' },
    { value: 'memory:alloc_in_new_tlab_bytes:bytes:space:bytes', label: 'memory/alloc_in_new_tlab_bytes' },
    { value: 'memory:alloc_in_new_tlab_objects:count:space:bytes', label: 'memory/alloc_in_new_tlab_objects' },
    { value: 'mutex:contentions:count:mutex:count', label: 'mutex/contentions' },
    { value: 'mutex:delay:nanoseconds:mutex:count', label: 'mutex/delay' },
    { value: 'block:contentions:count:block:count', label: 'block/contentions' },
    { value: 'block:delay:nanoseconds:block:count', label: 'block/delay' },
  ];

  /**
   * Get list of available profiler types
   */
  getProfilerTypes(): ProfilerTypeDto[] {
    return this.PROFILER_TYPES;
  }

  /**
   * Generate URL for single test run view
   *
   * @param params - Parameters for single view URL generation
   * @returns Generated Pyroscope URL with metadata
   */
  generateSingleViewUrl(params: GenerateSingleViewUrlDto): PyroscopeUrlResponseDto {
    const {
      pyroscopeUrl,
      isStandalone,
      application,
      profilerValue,
      startTime,
      endTime,
      theme = PyroscopeTheme.DARK
    } = params;

    let url: string;

    if (isStandalone) {
      // Standalone Pyroscope URL format (no URLSearchParams — Pyroscope
      // doesn't decode %3A-encoded colons in profiler metric IDs)
      url = `${pyroscopeUrl}/?from=${startTime}&until=${endTime}&var-profileMetricId=${profilerValue}&var-serviceName=${encodeURIComponent(application)}`;
    } else {
      // Grafana-embedded Pyroscope URL format
      const searchParams = new URLSearchParams({
        searchText: '',
        panelType: 'time-series',
        layout: 'grid',
        hideNoData: 'off',
        explorationType: 'flame-graph',
        'var-serviceName': application,
        'var-profileMetricId': profilerValue,
        'var-groupBy': 'all',
        'var-filters': '',
        maxNodes: '16384',
        from: startTime.toString(),
        to: endTime.toString(),
        theme: theme,
        kiosk: 'true'
      });

      url = `${pyroscopeUrl}?${searchParams.toString()}`;
    }

    this.logger.log(`Generated single view URL for application=${application}, profiler=${profilerValue}`);

    return {
      url,
      isStandalone,
      application,
      profilerValue
    };
  }

  /**
   * Generate URL for comparison/diff view between two test runs
   *
   * @param params - Parameters for comparison URL generation
   * @returns Generated Pyroscope comparison URL with metadata
   */
  generateCompareUrl(params: GenerateCompareUrlDto): PyroscopeUrlResponseDto {
    const {
      pyroscopeUrl,
      isStandalone,
      application,
      profilerValue,
      profilerLabel,
      leftStartTime,
      leftEndTime,
      rightStartTime,
      rightEndTime,
      viewMode = PyroscopeViewMode.COMPARISON,
      theme = PyroscopeTheme.DARK
    } = params;

    let url: string;

    if (isStandalone) {
      // Standalone Pyroscope comparison URL format (no URLSearchParams —
      // Pyroscope doesn't decode %3A-encoded colons in profiler labels)
      const query = `${profilerLabel}{service_name="${application}"}`;
      url = `${pyroscopeUrl}/${viewMode}?from=${leftStartTime}&until=${rightEndTime}&leftFrom=${leftStartTime}&leftUntil=${leftEndTime}&rightFrom=${rightStartTime}&rightUntil=${rightEndTime}&query=${encodeURIComponent(query)}`;
    } else {
      // Grafana-embedded Pyroscope comparison URL format
      const searchParams = new URLSearchParams({
        searchText: '',
        panelType: 'time-series',
        layout: 'grid',
        hideNoData: 'off',
        explorationType: 'diff-flame-graph',
        'var-serviceName': application,
        'var-profileMetricId': profilerValue,
        'var-groupBy': 'all',
        'var-filters': '',
        maxNodes: '16384',
        diffFrom: this.timestampToDate(leftStartTime),
        diffTo: this.timestampToDate(leftEndTime),
        'diffFrom-2': this.timestampToDate(rightStartTime),
        'diffTo-2': this.timestampToDate(rightEndTime),
        'from-2': this.timestampToDate(leftStartTime),
        'to-2': this.timestampToDate(leftEndTime),
        'from-3': this.timestampToDate(rightStartTime),
        'to-3': this.timestampToDate(rightEndTime),
        theme: theme,
        kiosk: 'true'
      });

      url = `${pyroscopeUrl}?${searchParams.toString()}`;
    }

    this.logger.log(`Generated ${viewMode} URL for application=${application}, profiler=${profilerValue}`);

    return {
      url,
      isStandalone,
      application,
      profilerValue
    };
  }

  /**
   * Helper method to convert date string to Unix timestamp in milliseconds
   *
   * @param dateString - ISO date string
   * @returns Unix timestamp in milliseconds
   */
  dateToTimestamp(dateString: string): number {
    return new Date(dateString).getTime();
  }

  /**
   * Helper method to format Unix timestamp to ISO date string
   *
   * @param timestamp - Unix timestamp in milliseconds
   * @returns ISO date string
   */
  timestampToDate(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }
}
