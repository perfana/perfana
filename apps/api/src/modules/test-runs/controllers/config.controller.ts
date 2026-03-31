import { Controller, Get, Post, Body, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { TestRunsService } from '../test-runs.service';
import { AddTestRunConfigDto, AddTestRunConfigsDto, AddTestRunConfigJsonDto } from '../dto/test-run-config.dto';

@ApiTags('config')
@ApiBearerAuth()
@Controller('config')
export class ConfigController {
  private readonly logger = new Logger(ConfigController.name);

  constructor(private readonly testRunsService: TestRunsService) {}

  @Get('/systems')
  @ApiOperation({ summary: 'Get all systems under test with their environments and workloads' })
  @ApiResponse({ status: 200, description: 'Systems summary retrieved successfully' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getSystemsSummary(
    @Query('organizationId') organizationId: string | undefined,
    @UserCtx() ctx: UserContext,
  ) {
    this.logger.debug('Fetching systems summary');
    return await this.testRunsService.getSystemsSummary(ctx.userId, ctx.roles, organizationId);
  }

  @Post('/key')
  @ApiOperation({ summary: 'Add a single test run configuration key-value pair' })
  @ApiResponse({ status: 200, description: 'Test run config key value pair added' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async addTestRunConfig(@Body() configDto: AddTestRunConfigDto) {
    this.logger.debug('Adding test run config', { configDto });

    await this.testRunsService.addTestRunConfig(configDto);

    return {
      message: 'Test run config key value pair added'
    };
  }

  @Post('/keys')
  @ApiOperation({ summary: 'Add multiple test run configuration key-value pairs' })
  @ApiResponse({ status: 200, description: 'Test run config key value pairs added' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async addTestRunConfigs(@Body() configsDto: AddTestRunConfigsDto) {
    this.logger.debug('Adding multiple test run configs', { count: configsDto.configItems?.length });

    await this.testRunsService.addTestRunConfigs(configsDto);

    return {
      message: 'Test run config key value pairs added'
    };
  }

  @Post('/json')
  @ApiOperation({ summary: 'Add test run configuration from JSON with include/exclude patterns' })
  @ApiResponse({ status: 200, description: 'Test run config json added' })
  @ApiResponse({ status: 400, description: 'Validation error or malicious regex detected' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async addTestRunConfigJson(@Body() configJsonDto: AddTestRunConfigJsonDto) {
    this.logger.debug('Adding test run config from JSON', {
      testRunId: configJsonDto.testRunId,
      includePatterns: configJsonDto.includes?.length,
      excludePatterns: configJsonDto.excludes?.length
    });

    await this.testRunsService.addTestRunConfigJson(configJsonDto);

    return {
      message: 'Test run config json added'
    };
  }
}