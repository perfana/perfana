import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class InitTestDto {
  @ApiProperty({
    description: 'System under test name',
    example: 'PaymentService'
  })
  @IsString()
  systemUnderTest!: string;

  @ApiProperty({
    description: 'Workload type',
    example: 'loadTest'
  })
  @IsString()
  workload!: string;

  @ApiProperty({
    description: 'Legacy test type field (deprecated, use workload instead)',
    example: 'loadTest',
    required: false
  })
  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => {
    if (value && !obj.workload) {
      obj.workload = value;
    }
    return undefined;
  })
  testType?: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'production'
  })
  @IsString()
  testEnvironment!: string;
}

export interface InitTestResponse {
  testRunId: string;
}