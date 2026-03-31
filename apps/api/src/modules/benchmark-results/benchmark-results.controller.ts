import { Controller, Get, Param, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BenchmarkResultResponseDto } from '../benchmarks/dto/benchmark-result.dto';

@ApiTags('benchmark-results')
@ApiBearerAuth()
@Controller('benchmark-results')
export class BenchmarkResultsController {
  @Get(':systemUnderTestId/:testRunId')
  @ApiOperation({
    summary: 'Get consolidated benchmark results for a test run',
    description: 'Returns consolidated benchmark/check results used by CI/CD pipelines to determine test pass/fail status. This endpoint requires API key authentication for CI/CD access.',
  })
  @ApiParam({
    name: 'systemUnderTestId',
    description: 'System under test identifier (name)',
    example: 'MyAfterburner',
  })
  @ApiParam({
    name: 'testRunId',
    description: 'Test run identifier',
    example: 'MyAfterburner-acc-loadTest-00008',
  })
  @ApiResponse({
    status: 200,
    description: 'Evaluation complete, returns consolidated results',
    type: BenchmarkResultResponseDto,
  })
  @ApiResponse({
    status: 202,
    description: 'Evaluation still in progress',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Test run evaluation in progress ...' }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'Test run not found OR no benchmarks configured',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'array',
          items: { type: 'string' },
          example: ['Test run not found']
        }
      }
    }
  })
  @ApiResponse({
    status: 500,
    description: 'Test run is invalid',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'array',
          items: { type: 'string' },
          example: ['Reason 1', 'Reason 2']
        }
      }
    }
  })
  async getTestRunBenchmarkResults(
    @Param('systemUnderTestId') _systemUnderTestId: string,
    @Param('testRunId') _testRunId: string,
  ): Promise<BenchmarkResultResponseDto> {
    throw new HttpException(
      'Benchmark results endpoint is not yet implemented. Use GET /benchmarks/:systemUnderTestId for benchmark configuration.',
      501,
    );
  }
}
