import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsObject, IsUUID } from 'class-validator';

/**
 * Response interface for host properties fetched from Dynatrace
 */
export interface HostPropertiesResponse {
  entityId: string;
  displayName: string;
  properties: {
    cpuCores?: number;
    osType?: string;
    osArchitecture?: string;
    bitness?: string;
    monitoringMode?: string;
    hostName?: string;
    ipAddresses?: string[];
    cloudType?: string;
    memoryTotal?: number;
  };
  lastSeenTimestamp?: number;
}

/**
 * Time series data point structure
 */
export interface TimeSeriesData {
  metricName: string;
  unit: string;
  dataPoints: { timestamp: string; value: number }[];
}

/**
 * Response interface for host metrics (CPU, memory, disk, network)
 */
export interface HostMetricsResponse {
  entityId: string;
  metrics: {
    cpu: TimeSeriesData[];
    memory: TimeSeriesData[];
    /** Disk series are folded across every disk on the host — see HOST_METRICS. */
    diskReadTime: TimeSeriesData[];
    diskWriteTime: TimeSeriesData[];
    diskReadOps: TimeSeriesData[];
    diskWriteOps: TimeSeriesData[];
    diskQueueLength: TimeSeriesData[];
    network: TimeSeriesData[];
  };
}

/**
 * Response interface for host problems from Dynatrace
 */
export interface HostProblemResponse {
  problemId: string;
  title: string;
  status: 'OPEN' | 'RESOLVED';
  severityLevel: string;
  startTime: string;
  endTime?: string;
  impactLevel?: string;
}

/**
 * One row of the Hosts-tab overview table: average CPU/mem over the test-run
 * window plus a problem flag. `null` metric = no data returned for that host.
 */
export interface HostOverviewRow {
  hostId: string;
  displayName: string;
  dynatraceConfigId: string;
  cpuAvg: number | null;
  memAvg: number | null;
  problemCount: number;
  worstSeverity: string | null;
}

/**
 * One row of the report's Dynatrace Hosts section: the Hosts-tab row plus the
 * optional columns the host detail page shows. A column that was not requested
 * stays `undefined`; one that was requested but got no data is `null`.
 */
export interface HostReportRow {
  hostId: string;
  displayName: string;
  labels: string[];
  cpuAvg?: number | null;
  cpuCores?: number | null;
  memAvg?: number | null;
  /** Bytes. */
  memoryTotal?: number | null;
  /**
   * `builtin:host.disk.utilTime`, averaged across the host's disks. Kept for report
   * templates that already selected the `disk` column; see DYNATRACE_HOST_COLUMNS for
   * why it is a poor performance signal and what to use instead.
   */
  diskAvg?: number | null;
  /** Milliseconds, averaged across the host's disks — see the unit caveat on HOST_METRICS. */
  diskReadTimeAvg?: number | null;
  diskWriteTimeAvg?: number | null;
  /** Operations per second, summed across the host's disks. */
  diskReadOpsAvg?: number | null;
  diskWriteOpsAvg?: number | null;
  /** Bytes per second, averaged over the window. */
  networkAvg?: number | null;
  problemCount?: number;
  worstSeverity?: string | null;
}

/**
 * DTO for storing host properties as test run configuration
 */
export class StoreHostPropertiesDto {
  @ApiProperty({
    description: 'Test run ID to store properties for',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  testRunId!: string;

  @ApiProperty({
    description: 'Display name of the host',
    example: 'prod-server-01',
  })
  @IsString()
  @IsNotEmpty()
  hostDisplayName!: string;

  @ApiProperty({
    description: 'Host properties object',
    example: {
      cpuCores: 8,
      osType: 'LINUX',
      memoryTotal: 16777216000,
    },
  })
  @IsObject()
  @IsNotEmpty()
  properties!: Record<string, unknown>;
}
