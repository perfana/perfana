import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class MarkChangepointDto {
  @ApiProperty({
    description: 'System under test ID',
    example: 'my-system'
  })
  @IsString()
  @IsNotEmpty()
  systemUnderTestId!: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'production'
  })
  @IsString()
  @IsNotEmpty()
  testEnvironment!: string;

  @ApiProperty({
    description: 'Workload type',
    example: 'load-test'
  })
  @IsString()
  @IsNotEmpty()
  workload!: string;

  @ApiProperty({
    description: 'Test run ID',
    example: 'test-run-001'
  })
  @IsString()
  @IsNotEmpty()
  testRunId!: string;
}