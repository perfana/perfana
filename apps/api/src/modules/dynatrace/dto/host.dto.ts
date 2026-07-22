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
    disk: TimeSeriesData[];
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
