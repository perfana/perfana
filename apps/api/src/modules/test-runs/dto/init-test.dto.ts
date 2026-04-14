import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
    description: 'Test environment',
    example: 'production'
  })
  @IsString()
  testEnvironment!: string;
}

export interface InitTestResponse {
  testRunId: string;
}