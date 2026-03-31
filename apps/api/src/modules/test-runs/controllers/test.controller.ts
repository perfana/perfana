import { Controller, Post, Body, Logger, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { TestRunsService } from '../test-runs.service';
import { UpdateRunningTestDto } from '../dto/update-running-test.dto';
import { ValidationException } from '../../../common/exceptions/business.exception';
import { ThrottleConfig } from '../../../decorators/throttle-config.decorator';

@ApiTags('test')
@ApiBearerAuth()
@Controller('test')
export class TestController {
  private readonly logger = new Logger(TestController.name);

  constructor(private readonly testRunsService: TestRunsService) {}

  @Post()
  @ThrottleConfig(200, 60000) // 200 requests per minute for test submission (high volume expected)
  @ApiOperation({ summary: 'Create or update a test run' })
  @ApiResponse({ status: 200, description: 'Test run created/updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Test run already exists' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async createOrUpdateTest(
    @Body() updateDto: UpdateRunningTestDto,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Creating or updating test run', { testRunId: updateDto.testRunId });

    // Validation
    if (!updateDto.testRunId) {
      throw new ValidationException('testRunId is required');
    }

    if (!ctx.organizationId) {
      throw new BadRequestException(
        'User must belong to an organization to create test runs',
      );
    }

    // Service call - let exceptions bubble up to GlobalExceptionFilter
    return await this.testRunsService.updateRunningTest(
      updateDto,
      ctx.userId,
      ctx.roles,
      ctx.organizationId,
    );
  }
}