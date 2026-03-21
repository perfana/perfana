import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SeriesConfigDto } from './create-graph-preset.dto';

export class GraphPresetResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the preset',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  id!: string;

  @ApiProperty({
    description: 'Name of the graph preset',
    example: 'My Custom Graph'
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional description of the preset',
    example: 'Shows response time and throughput metrics from multiple dashboards'
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'Test run ID associated with this preset',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  testRunId?: string;

  @ApiProperty({
    description: 'ID of the user who created this preset',
    example: '660e8400-e29b-41d4-a716-446655440000'
  })
  userId!: string;

  @ApiProperty({
    description: 'Array of series configurations',
    type: [SeriesConfigDto]
  })
  seriesConfig!: SeriesConfigDto[];

  @ApiPropertyOptional({
    description: 'Chart customization options',
    example: { showLegend: true, lineWidth: 2 }
  })
  chartOptions?: Record<string, any>;

  @ApiProperty({
    description: 'Whether this preset is available to all users',
    example: false
  })
  isGlobal!: boolean;

  @ApiProperty({
    description: 'When the preset was created',
    example: '2024-01-15T10:30:00Z'
  })
  createdAt!: string;

  @ApiProperty({
    description: 'When the preset was last updated',
    example: '2024-01-15T10:30:00Z'
  })
  updatedAt!: string;
}
