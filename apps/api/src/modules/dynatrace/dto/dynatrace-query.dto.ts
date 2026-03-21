import { ApiProperty } from '@nestjs/swagger';

export class DynatraceQueryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  dynatraceConfigId!: string;

  @ApiProperty()
  systemUnderTestId!: string;

  @ApiProperty()
  testEnvironment!: string;

  @ApiProperty()
  workload!: string;

  @ApiProperty()
  dashboardLabel!: string;

  @ApiProperty()
  applicationDashboardId!: string;

  @ApiProperty()
  panelTitle!: string;

  @ApiProperty({ required: false })
  panelId?: number;

  @ApiProperty()
  query!: string;

  @ApiProperty({ required: false })
  matchMetricPattern?: string;

  @ApiProperty({ required: false, type: [String] })
  omitGroupByVariableFromMetricName?: string[];

  @ApiProperty({ required: false, type: Object })
  templateVariables?: Record<string, string>;

  @ApiProperty({ required: false })
  metricUnit?: string;

  @ApiProperty({ required: false, description: 'Explicit metric name for storage (e.g., "CPU Usage")' })
  metricName?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}