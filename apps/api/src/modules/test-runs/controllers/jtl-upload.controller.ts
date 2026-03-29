import {
  Controller,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { JtlUploadDto, JtlUploadResult } from '../dto/jtl-upload.dto';
import { JtlImportService } from '../services/jtl-import.service';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

@ApiTags('test-runs')
@ApiBearerAuth()
@Controller('test-runs')
export class JtlUploadController {
  private readonly logger = new Logger(JtlUploadController.name);

  constructor(
    private readonly jtlImportService: JtlImportService,
    private readonly authzService: AuthorizationService,
  ) {}

  @Post('jtl-upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  @ApiOperation({
    summary: 'Upload JTL results zip file',
    description:
      'Upload a zip archive containing JMeter JTL result files. Each scenario folder becomes a separate test run.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'JTL zip file upload with metadata',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'Zip archive containing JTL files' },
        systemUnderTest: { type: 'string', description: 'System under test name' },
        testEnvironment: { type: 'string', description: 'Test environment name' },
        workload: { type: 'string', description: 'Workload name' },
        rampUp: { type: 'string', description: 'Ramp-up time in seconds' },
        configs: { type: 'string', description: 'Optional JSON: [{key, value}]' },
      },
      required: ['file', 'systemUnderTest', 'testEnvironment', 'workload'],
    },
  })
  @ApiResponse({ status: 201, description: 'JTL results imported successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file or request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async uploadJtl(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: JtlUploadDto,
    @UserCtx() ctx: UserContext,
  ): Promise<JtlUploadResult> {
    // Validate file
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      throw new BadRequestException('File must be a .zip archive');
    }

    // Resolve organization: ctx.organizationId may be empty for JWT users.
    // Load orgs via AuthorizationService.
    let organizationId = ctx.organizationId;
    if (!organizationId) {
      const accessibleOrgs = await this.authzService.getAccessibleOrganizations(ctx.userId);
      organizationId = accessibleOrgs[0];
    }

    if (!organizationId) {
      throw new BadRequestException(
        'User must belong to an organization to upload test results.',
      );
    }

    // Parse optional configs
    let configs: Array<{ key: string; value: string }> | undefined;
    if (dto.configs) {
      try {
        configs = JSON.parse(dto.configs);
        if (!Array.isArray(configs)) {
          throw new Error('configs must be an array');
        }
      } catch {
        throw new BadRequestException(
          'configs must be a valid JSON array of {key, value} objects',
        );
      }
    }

    this.logger.log(
      `JTL upload: ${file.originalname} (${(file.size / 1024 / 1024).toFixed(1)}MB) ` +
        `for ${dto.systemUnderTest}/${dto.testEnvironment}/${dto.workload} by user ${ctx.userId}`,
    );

    const rampUp = dto.rampUp ? parseInt(dto.rampUp, 10) : 0;

    const result = await this.jtlImportService.importJtl(file.buffer, {
      systemUnderTest: dto.systemUnderTest,
      testEnvironment: dto.testEnvironment,
      workload: dto.workload,
      rampUp: isNaN(rampUp) ? 0 : rampUp,
      configs,
      userId: ctx.userId,
      roles: ctx.roles,
      organizationId,
    });

    return {
      testRunId: result.testRunId,
      scenarioCount: result.scenarioCount,
      message: `Successfully imported ${result.scenarioCount} scenario(s) into test run ${result.testRunId}`,
    };
  }
}
