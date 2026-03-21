import { Controller, Get, Param, Logger, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
// import { BenchmarksService } from '../benchmarks/benchmarks.service';
import { BenchmarkResultResponseDto } from '../benchmarks/dto/benchmark-result.dto';

@ApiTags('benchmark-results')
@Controller('benchmark-results')
export class BenchmarkResultsController {
  private readonly logger = new Logger(BenchmarkResultsController.name);

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
    try {
      // TODO: Implement getTestRunBenchmarkResults in BenchmarksService
      throw new HttpException('Not implemented yet', 501);
      // return await this.benchmarksService.getTestRunBenchmarkResults(
      //   systemUnderTestId,
      //   testRunId,
      // );
    } catch (error) {
      // Re-throw HttpExceptions (202, 404, 500) as-is
      if (error instanceof HttpException) {
        throw error;
      }

      // Log and re-throw other errors
      this.logger.error('Failed to get benchmark results:', error);
      throw error;
    }
  }
}
