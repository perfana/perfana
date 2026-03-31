import { Controller, Post, Body, Logger, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { TestRunsService } from '../test-runs.service';
import { InitTestDto, InitTestResponse } from '../dto/init-test.dto';
import { ValidationException } from '../../../common/exceptions/business.exception';

@ApiTags('init')
@ApiBearerAuth()
@Controller('init')
export class InitController {
  private readonly logger = new Logger(InitController.name);

  constructor(private readonly testRunsService: TestRunsService) {}

  @Post()
  @ApiOperation({ summary: 'Initialize a new test and generate unique test run ID' })
  @ApiResponse({ status: 200, description: 'Test run ID generated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error or malicious regex detected' })
  @ApiResponse({ status: 404, description: 'System under test not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async initTest(
    @Body() initDto: InitTestDto,
    @UserCtx() ctx: UserContext,
  ): Promise<InitTestResponse> {
    this.logger.debug('Initializing test', {
      systemUnderTest: initDto.systemUnderTest,
      testEnvironment: initDto.testEnvironment,
      workload: initDto.workload,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
    });

    // Validation
    if (!initDto.systemUnderTest || !initDto.testEnvironment || !initDto.workload) {
      throw new ValidationException('systemUnderTest, testEnvironment, and workload are required');
    }

    // Organization is required for RBAC - works with both API keys and JWT tokens
    if (!ctx.organizationId) {
      throw new BadRequestException(
        'User must belong to an organization to initialize test runs. API keys must have an organization_id.',
      );
    }

    return await this.testRunsService.initTest(
      initDto,
      ctx.userId,
      ctx.roles,
      ctx.organizationId,
    );
  }
}