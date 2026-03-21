import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, ArrayMaxSize } from 'class-validator';

export class BatchRefreshDto {
  @ApiProperty({
    description: 'Array of test run IDs to refresh',
    example: ['test-1', 'test-2', 'test-3'],
    maxItems: 100,
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100, { message: 'Maximum 100 test runs can be processed at once' })
  testRunIds!: string[];

  @ApiProperty({
    description: 'Whether to run ADAPT analysis after metrics collection',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  adapt?: boolean = true;
}

export interface TaskResponse {
  taskId: string;
  status: 'QUEUED' | 'ACTIVE' | 'COMPLETED' | 'FAILED';
  testRunIds?: string[];
}