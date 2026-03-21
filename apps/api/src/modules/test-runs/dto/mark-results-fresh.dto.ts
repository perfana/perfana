import { IsUUID, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MarkResultsFreshDto {
  @ApiProperty({
    description: 'Application dashboard ID',
    example: '550e8400-e29b-41d4-a716-446655440001'
  })
  @IsUUID()
  applicationDashboardId!: string;

  @ApiProperty({
    description: 'Panel ID',
    example: '1'
  })
  @IsString()
  panelId!: string;

  @ApiProperty({
    description: 'Metric name (optional, for metric-specific updates)',
    example: 'response_time_p90',
    required: false
  })
  @IsString()
  @IsOptional()
  metricName?: string;

  @ApiProperty({
    description: 'Configuration hash used for this result',
    example: 'a1b2c3d4',
    required: false
  })
  @IsString()
  @IsOptional()
  configHashUsed?: string;
}