import { Controller, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { TempoService } from './tempo.service';
import {
  SearchTracesDto,
  GetTraceDto,
  SearchTracesResponseDto,
  TraceDetailsResponseDto,
} from './dto/tempo.dto';

@ApiTags('tempo')
@Controller('tempo')
export class TempoController {
  constructor(private readonly tempoService: TempoService) {}

  @Post('search')
  @ApiOperation({
    summary: 'Search for traces in Tempo',
    description:
      'Search for traces matching the given criteria using TraceQL. ' +
      'Requires scenario and transaction to filter by perfana-request-name tag.',
  })
  @ApiResponse({
    status: 200,
    description: 'Traces found successfully',
    type: SearchTracesResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 500, description: 'Failed to search Tempo' })
  async searchTraces(@Body() dto: SearchTracesDto): Promise<SearchTracesResponseDto> {
    return this.tempoService.searchTraces(dto);
  }

  @Post(':traceId')
  @ApiOperation({
    summary: 'Get trace details by trace ID',
    description: 'Fetch full trace details including all spans from Tempo',
  })
  @ApiParam({ name: 'traceId', description: 'Trace ID to fetch' })
  @ApiResponse({
    status: 200,
    description: 'Trace details retrieved successfully',
    type: TraceDetailsResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Trace not found' })
  @ApiResponse({ status: 500, description: 'Failed to fetch trace' })
  async getTraceDetails(
    @Param('traceId') traceId: string,
    @Body() dto: GetTraceDto,
  ): Promise<TraceDetailsResponseDto> {
    return this.tempoService.getTraceDetails(dto.tracingInstanceId, traceId);
  }

  @Post('health')
  @ApiOperation({
    summary: 'Check Tempo health',
    description: 'Test connectivity to a Tempo instance',
  })
  @ApiResponse({
    status: 200,
    description: 'Health check result',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  async healthCheck(
    @Body() dto: GetTraceDto,
  ): Promise<{ success: boolean; message: string }> {
    return this.tempoService.healthCheck(dto.tracingInstanceId);
  }
}
