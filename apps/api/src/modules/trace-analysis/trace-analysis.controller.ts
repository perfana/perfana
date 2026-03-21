import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TraceAnalysisService } from './trace-analysis.service';
import {
  CompareTracesDto,
  TraceAnalysisResponseDto,
} from './dto/trace-analysis.dto';

@ApiTags('trace-analysis')
@Controller('trace-analysis')
export class TraceAnalysisController {
  constructor(private readonly traceAnalysisService: TraceAnalysisService) {}

  @Post('compare')
  @ApiOperation({
    summary: 'Compare traces between two test runs',
    description:
      'Performs comprehensive trace comparison including span-level analysis, ' +
      'root cause detection, contention analysis, and error comparison. ' +
      'Requires scenario and transaction to filter traces for the same request type.',
  })
  @ApiResponse({
    status: 200,
    description: 'Trace comparison completed successfully',
    type: TraceAnalysisResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 500, description: 'Analysis failed' })
  async compareTraces(
    @Body() dto: CompareTracesDto,
  ): Promise<TraceAnalysisResponseDto> {
    return this.traceAnalysisService.compareTraces(dto);
  }
}
