import { ApiProperty } from '@nestjs/swagger';

export class CorrelationGroupDriverDto {
  @ApiProperty() resultId!: string;
  @ApiProperty() metricName!: string;
  @ApiProperty() panelTitle!: string;
}

export class CorrelationGroupMemberDto {
  @ApiProperty() resultId!: string;
  @ApiProperty() metricName!: string;
  @ApiProperty() dashboardLabel!: string;
  @ApiProperty() panelTitle!: string;
  @ApiProperty({ nullable: true }) conclusionLabel!: string | null;
  @ApiProperty() correlationToDriver!: number;
}

export class CorrelationGroupDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() size!: number;
  @ApiProperty() avgCorrelation!: number;
  @ApiProperty({ type: CorrelationGroupDriverDto }) driver!: CorrelationGroupDriverDto;
  @ApiProperty({ type: [CorrelationGroupMemberDto] }) members!: CorrelationGroupMemberDto[];
}

export class UngroupedRegressionDto {
  @ApiProperty() resultId!: string;
  @ApiProperty() metricName!: string;
  @ApiProperty() dashboardLabel!: string;
  @ApiProperty() panelTitle!: string;
  @ApiProperty({ nullable: true }) conclusionLabel!: string | null;
}

export class CorrelationGroupsResponseDto {
  @ApiProperty() testRunId!: string;
  @ApiProperty() threshold!: number;
  @ApiProperty({ type: [CorrelationGroupDto] }) groups!: CorrelationGroupDto[];
  @ApiProperty({ type: [UngroupedRegressionDto] }) ungrouped!: UngroupedRegressionDto[];
}
