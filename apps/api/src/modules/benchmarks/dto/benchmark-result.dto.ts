import { ApiProperty } from '@nestjs/swagger';

/**
 * Individual benchmark result item
 * Contains pass/fail status and deeplink to test run
 */
export class BenchmarkResultItemDto {
  @ApiProperty({
    description: 'Whether the benchmark check passed',
    example: true,
  })
  result!: boolean;

  @ApiProperty({
    description: 'Deeplink URL to the test run details',
    example: 'http://localhost:4001/test-run/loadTest-00008?systemUnderTest=my-system&workload=load&testEnvironment=test',
  })
  deeplink!: string;
}

/**
 * Consolidated benchmark results response
 * Contains results for different benchmark types (requirements, comparisons, ADAPT)
 */
export class BenchmarkResultResponseDto {
  @ApiProperty({
    description: 'Requirements check results (SLO validation)',
    type: BenchmarkResultItemDto,
    required: false,
  })
  requirements?: BenchmarkResultItemDto;

  @ApiProperty({
    description: 'Benchmark comparison with previous test run',
    type: BenchmarkResultItemDto,
    required: false,
  })
  benchmarkPreviousTestRun?: BenchmarkResultItemDto;

  @ApiProperty({
    description: 'Benchmark comparison with baseline test run',
    type: BenchmarkResultItemDto,
    required: false,
  })
  benchmarkBaselineTestRun?: BenchmarkResultItemDto;

  @ApiProperty({
    description: 'ADAPT analysis results (automated performance regression detection)',
    type: BenchmarkResultItemDto,
    required: false,
  })
  adaptTestRunOK?: BenchmarkResultItemDto;
}
