import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PyroscopeUrlService } from './pyroscope-url.service';
import { PyroscopeAnalysisService } from './pyroscope-analysis.service';
import {
  GenerateSingleViewUrlDto,
  GenerateCompareUrlDto,
  PyroscopeUrlResponseDto,
  ProfilerTypeDto
} from './dto/pyroscope-url.dto';
import {
  AnalyzeFlamegraphDto,
  FlamegraphAnalysisResponseDto,
} from './dto/pyroscope-analysis.dto';

/**
 * Controller for Pyroscope URL generation and flamegraph analysis
 * Provides endpoints to generate Pyroscope profiling URLs and analyze flamegraph differences
 */
@ApiTags('pyroscope')
@Controller('pyroscope')
export class PyroscopeUrlController {
  private readonly logger = new Logger(PyroscopeUrlController.name);

  constructor(
    private readonly pyroscopeUrlService: PyroscopeUrlService,
    private readonly pyroscopeAnalysisService: PyroscopeAnalysisService,
  ) {}

  /**
   * Get list of available profiler types
   */
  @Get('profiler-types')
  @ApiOperation({
    summary: 'Get list of available profiler types',
    description: 'Returns the list of supported profiler types for Pyroscope profiling, including CPU, memory, mutex, and block profilers'
  })
  @ApiResponse({
    status: 200,
    description: 'Profiler types retrieved successfully',
    type: [ProfilerTypeDto]
  })
  getProfilerTypes(): ProfilerTypeDto[] {
    try {
      return this.pyroscopeUrlService.getProfilerTypes();
    } catch (error) {
      this.logger.error('Failed to get profiler types:', error);
      throw new HttpException(
        'Failed to get profiler types',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Generate URL for single test run profiling view
   */
  @Post('generate-url')
  @ApiOperation({
    summary: 'Generate Pyroscope URL for single test run view',
    description: 'Generates a Pyroscope URL for viewing profiling data from a single test run. Supports both standalone Pyroscope and Grafana-embedded modes.'
  })
  @ApiResponse({
    status: 200,
    description: 'URL generated successfully',
    type: PyroscopeUrlResponseDto
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data'
  })
  generateSingleViewUrl(
    @Body() generateDto: GenerateSingleViewUrlDto
  ): PyroscopeUrlResponseDto {
    try {
      // Validate timestamps
      if (generateDto.startTime >= generateDto.endTime) {
        throw new HttpException(
          'Start time must be before end time',
          HttpStatus.BAD_REQUEST
        );
      }

      return this.pyroscopeUrlService.generateSingleViewUrl(generateDto);
    } catch (error) {
      this.logger.error('Failed to generate single view URL:', error);

      // Re-throw HttpException as-is
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to generate Pyroscope URL',
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Generate URL for comparison/diff view between two test runs
   */
  @Post('generate-compare-url')
  @ApiOperation({
    summary: 'Generate Pyroscope URL for comparison/diff view',
    description: 'Generates a Pyroscope URL for comparing profiling data between two test runs (baseline vs current). Supports both standalone Pyroscope and Grafana-embedded modes.'
  })
  @ApiResponse({
    status: 200,
    description: 'Comparison URL generated successfully',
    type: PyroscopeUrlResponseDto
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data'
  })
  generateCompareUrl(
    @Body() generateDto: GenerateCompareUrlDto
  ): PyroscopeUrlResponseDto {
    try {
      // Validate timestamps
      if (generateDto.leftStartTime >= generateDto.leftEndTime) {
        throw new HttpException(
          'Left start time must be before left end time',
          HttpStatus.BAD_REQUEST
        );
      }

      if (generateDto.rightStartTime >= generateDto.rightEndTime) {
        throw new HttpException(
          'Right start time must be before right end time',
          HttpStatus.BAD_REQUEST
        );
      }

      return this.pyroscopeUrlService.generateCompareUrl(generateDto);
    } catch (error) {
      this.logger.error('Failed to generate compare URL:', error);

      // Re-throw HttpException as-is
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to generate Pyroscope comparison URL',
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Analyze flamegraphs and compare CPU profiling between baseline and current test runs
   */
  @Post('analyze-flamegraphs')
  @ApiOperation({
    summary: 'Analyze and compare Pyroscope flamegraphs',
    description: 'Fetches flamegraph data from Pyroscope API for baseline and current test runs, performs differential analysis to identify significant function-level CPU changes, and returns a detailed comparison report with new hotspots and improvements.'
  })
  @ApiResponse({
    status: 200,
    description: 'Flamegraph analysis completed successfully',
    type: FlamegraphAnalysisResponseDto
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data or time range validation failed'
  })
  @ApiResponse({
    status: 502,
    description: 'Failed to fetch data from Pyroscope API'
  })
  async analyzeFlamegraphs(
    @Body() analyzeDto: AnalyzeFlamegraphDto
  ): Promise<FlamegraphAnalysisResponseDto> {
    return await this.pyroscopeAnalysisService.analyzeFlamegraphs(analyzeDto);
  }
}
