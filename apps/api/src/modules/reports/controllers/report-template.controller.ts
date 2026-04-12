import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Param,
  Body,
  Logger,
  HttpException,
  HttpStatus,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { ReportTemplateService } from '../services/report-template.service';
import { CopyReportTemplatesDto } from '../dto/copy-report-templates.dto';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  AddSectionDto,
  ReorderSectionsDto,
  DuplicateTemplateDto,
  ListTemplatesQueryDto,
  TemplateListResponseDto,
  TemplateDetailDto,
  TemplateSummaryDto,
} from '../dto';
import { ReportSectionType } from '@perfana/shared';

/**
 * Controller for report template CRUD and management operations.
 *
 * All endpoints are protected by the global KeycloakEnhancedAuthGuard
 * which supports both Keycloak JWT and API Key authentication.
 */
@ApiTags('report-templates')
@ApiBearerAuth()
@Controller('report-templates')
export class ReportTemplateController {
  private readonly logger = new Logger(ReportTemplateController.name);

  constructor(private readonly reportTemplateService: ReportTemplateService) {}

  // ==================== Template Listing ====================

  @Get()
  @ApiOperation({ summary: 'Get all report templates with optional filtering' })
  @ApiQuery({ name: 'system_id', required: false, description: 'Filter by system ID' })
  @ApiQuery({ name: 'test_environment', required: false, description: 'Filter by test environment' })
  @ApiQuery({ name: 'workload', required: false, description: 'Filter by workload' })
  @ApiQuery({ name: 'default_only', required: false, description: 'Show only default templates' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or description' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum results (default: 50)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Pagination offset (default: 0)' })
  @ApiQuery({ name: 'sortBy', required: false, description: 'Sort field (default: created_at)' })
  @ApiQuery({ name: 'sortOrder', required: false, description: 'Sort order (default: desc)' })
  @ApiResponse({ status: 200, description: 'Return paginated list of templates', type: TemplateListResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  async findAll(@Query() query: ListTemplatesQueryDto, @UserCtx() _ctx: UserContext): Promise<TemplateListResponseDto> {
    try {
      const result = await this.reportTemplateService.findAll({
        systemId: query.system_id,
        testEnvironment: query.test_environment,
        workload: query.workload,
        isDefault: query.default_only,
        search: query.search,
        limit: query.limit,
        offset: query.offset,
        sortBy: query.sortBy as 'name' | 'created_at' | 'updated_at',
        sortOrder: query.sortOrder,
      });

      return {
        items: result.items.map((template) => {
          const sections = template.sections || [];
          const sectionTypes = [...new Set(sections.map((s) => s.type))];
          return {
            id: template.id,
            name: template.name,
            description: template.description,
            created_by: template.created_by || '',
            section_count: sections.length,
            section_types: sectionTypes as ReportSectionType[],
            is_default: template.is_default,
            created_at: template.created_at,
            updated_at: template.updated_at,
          };
        }),
        total: result.total,
        offset: result.offset,
        limit: result.limit,
      };
    } catch (error) {
      this.logger.error('Failed to fetch report templates:', error);
      throw new HttpException(
        'Failed to fetch report templates',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('summaries')
  @ApiOperation({ summary: 'Get template summaries for a specific scope (for dropdowns)' })
  @ApiQuery({ name: 'system_id', required: true, description: 'System ID' })
  @ApiQuery({ name: 'test_environment', required: true, description: 'Test environment' })
  @ApiQuery({ name: 'workload', required: true, description: 'Workload' })
  @ApiResponse({ status: 200, description: 'Return template summaries', type: [TemplateSummaryDto] })
  @ApiResponse({ status: 400, description: 'Missing required query parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  async getSummaries(
    @Query('system_id') systemId?: string,
    @Query('test_environment') testEnvironment?: string,
    @Query('workload') workload?: string,
    @UserCtx() _ctx?: UserContext,
  ): Promise<TemplateSummaryDto[]> {
    try {
      // Default to '*' if not provided for wildcard matching
      const effectiveSystemId = systemId || '*';
      const effectiveTestEnvironment = testEnvironment || '*';
      const effectiveWorkload = workload || '*';

      const summaries = await this.reportTemplateService.getSummaries(
        effectiveSystemId,
        effectiveTestEnvironment,
        effectiveWorkload,
      );

      return summaries.map((summary) => ({
        id: summary.id,
        name: summary.name,
        section_count: summary.sectionCount,
        is_default: summary.isDefault,
      }));
    } catch (error) {
      this.logger.error('Failed to fetch template summaries:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to fetch template summaries',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('default')
  @ApiOperation({ summary: 'Get the default template for a scope' })
  @ApiQuery({ name: 'system_id', required: true, description: 'System ID' })
  @ApiQuery({ name: 'test_environment', required: true, description: 'Test environment' })
  @ApiQuery({ name: 'workload', required: true, description: 'Workload' })
  @ApiResponse({ status: 200, description: 'Return the default template', type: TemplateDetailDto })
  @ApiResponse({ status: 400, description: 'Missing required query parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'No default template found for scope' })
  async getDefault(
    @Query('system_id') systemId?: string,
    @Query('test_environment') testEnvironment?: string,
    @Query('workload') workload?: string,
    @UserCtx() _ctx?: UserContext,
  ): Promise<TemplateDetailDto> {
    try {
      // Default to '*' if not provided for wildcard matching
      const effectiveSystemId = systemId || '*';
      const effectiveTestEnvironment = testEnvironment || '*';
      const effectiveWorkload = workload || '*';

      const template = await this.reportTemplateService.findDefault(
        effectiveSystemId,
        effectiveTestEnvironment,
        effectiveWorkload,
      );

      if (!template) {
        throw new HttpException(
          'No default template found for this scope',
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        system_id: template.system_id,
        test_environment: template.test_environment,
        workload: template.workload,
        sections: template.sections || [],
        styling: template.styling,
        is_default: template.is_default,
        created_by: template.created_by || '',
        created_at: template.created_at,
        updated_at: template.updated_at,
      };
    } catch (error) {
      this.logger.error('Failed to fetch default template:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to fetch default template',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== Template CRUD ====================

  @Post('copy')
  @ApiOperation({ summary: 'Copy report templates from one scope to another' })
  @ApiResponse({ status: 201, description: 'Report templates copied successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  async copyTemplates(
    @Body() dto: CopyReportTemplatesDto,
    @UserCtx() ctx: UserContext,
  ): Promise<{ copied: number; skipped: number; total: number }> {
    if (!ctx.organizationId) {
      throw new BadRequestException('User must belong to an organization to copy report templates');
    }

    try {
      return await this.reportTemplateService.copyToScope(dto, ctx.userId);
    } catch (error) {
      this.logger.error('Failed to copy report templates:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException('Failed to copy report templates', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a new report template' })
  @ApiResponse({ status: 201, description: 'Template created successfully', type: TemplateDetailDto })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 409, description: 'Template with same name already exists in scope' })
  async create(
    @Body() dto: CreateTemplateDto,
    @UserCtx() ctx: UserContext,
  ): Promise<TemplateDetailDto> {
    if (!ctx.organizationId) {
      throw new BadRequestException(
        'User must belong to an organization to create report templates',
      );
    }

    try {
      const createdBy = ctx.userId;

      const template = await this.reportTemplateService.create({
        name: dto.name,
        description: dto.description,
        createdBy,
        systemId: dto.system_id,
        testEnvironment: dto.test_environment,
        workload: dto.workload,
        sections: dto.sections.map((s) => ({
          type: s.type as ReportSectionType,
          order: s.order,
          title: s.title,
          config: s.config,
          comment: s.comment,
        })),
        styling: dto.styling
          ? {
              primaryColor: dto.styling.primaryColor,
              secondaryColor: dto.styling.secondaryColor,
              logo: dto.styling.logo,
              fontFamily: dto.styling.fontFamily,
              customCss: dto.styling.customCss,
            }
          : undefined,
        isDefault: dto.is_default,
      });

      this.logger.log(`Template '${template.name}' (${template.id}) created by ${createdBy}`);

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        system_id: template.system_id,
        test_environment: template.test_environment,
        workload: template.workload,
        sections: template.sections || [],
        styling: template.styling,
        is_default: template.is_default,
        created_by: template.created_by || '',
        created_at: template.created_at,
        updated_at: template.updated_at,
      };
    } catch (error) {
      this.logger.error('Failed to create report template:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('already exists')) {
        throw new HttpException(errorMessage, HttpStatus.CONFLICT);
      }
      if (errorMessage.includes('Invalid') || errorMessage.includes('must be')) {
        throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to create report template',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':templateId')
  @ApiOperation({ summary: 'Get a single report template by ID' })
  @ApiParam({ name: 'templateId', description: 'Template UUID' })
  @ApiResponse({ status: 200, description: 'Return the template', type: TemplateDetailDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async findOne(@Param('templateId') templateId: string, @UserCtx() _ctx?: UserContext): Promise<TemplateDetailDto> {
    try {
      const template = await this.reportTemplateService.findById(templateId);

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        system_id: template.system_id,
        test_environment: template.test_environment,
        workload: template.workload,
        sections: template.sections || [],
        styling: template.styling,
        is_default: template.is_default,
        created_by: template.created_by || '',
        created_at: template.created_at,
        updated_at: template.updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch template ${templateId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to fetch template',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':templateId')
  @ApiOperation({ summary: 'Update an existing report template' })
  @ApiParam({ name: 'templateId', description: 'Template UUID' })
  @ApiResponse({ status: 200, description: 'Template updated successfully', type: TemplateDetailDto })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  @ApiResponse({ status: 409, description: 'Template with same name already exists in scope' })
  async update(
    @Param('templateId') templateId: string,
    @Body() dto: UpdateTemplateDto,
    @UserCtx() ctx?: UserContext,
  ): Promise<TemplateDetailDto> {
    try {
      const template = await this.reportTemplateService.update(templateId, {
        name: dto.name,
        description: dto.description,
        sections: dto.sections?.map((s) => ({
          type: s.type as ReportSectionType,
          order: s.order,
          title: s.title,
          config: s.config,
          comment: s.comment,
        })),
        styling: dto.styling
          ? {
              primaryColor: dto.styling.primaryColor,
              secondaryColor: dto.styling.secondaryColor,
              logo: dto.styling.logo,
              fontFamily: dto.styling.fontFamily,
              customCss: dto.styling.customCss,
            }
          : undefined,
        isDefault: dto.is_default,
        updatedBy: ctx?.userId,
      });

      this.logger.log(`Template ${templateId} updated`);

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        system_id: template.system_id,
        test_environment: template.test_environment,
        workload: template.workload,
        sections: template.sections || [],
        styling: template.styling,
        is_default: template.is_default,
        created_by: template.created_by || '',
        created_at: template.created_at,
        updated_at: template.updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to update template ${templateId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }
      if (errorMessage.includes('already exists')) {
        throw new HttpException(errorMessage, HttpStatus.CONFLICT);
      }
      if (errorMessage.includes('Invalid') || errorMessage.includes('must be')) {
        throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to update template',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':templateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a report template' })
  @ApiParam({ name: 'templateId', description: 'Template UUID' })
  @ApiResponse({ status: 204, description: 'Template deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async delete(@Param('templateId') templateId: string, @UserCtx() _ctx?: UserContext): Promise<void> {
    try {
      await this.reportTemplateService.delete(templateId);
      this.logger.log(`Template ${templateId} deleted`);
    } catch (error) {
      this.logger.error(`Failed to delete template ${templateId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to delete template',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== Template Operations ====================

  @Post(':templateId/duplicate')
  @ApiOperation({ summary: 'Duplicate an existing template' })
  @ApiParam({ name: 'templateId', description: 'Template UUID to duplicate' })
  @ApiResponse({ status: 201, description: 'Template duplicated successfully', type: TemplateDetailDto })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  @ApiResponse({ status: 409, description: 'Template with same name already exists in target scope' })
  async duplicate(
    @Param('templateId') templateId: string,
    @Body() dto: DuplicateTemplateDto,
    @UserCtx() ctx: UserContext,
  ): Promise<TemplateDetailDto> {
    if (!ctx.organizationId) {
      throw new BadRequestException(
        'User must belong to an organization to duplicate report templates',
      );
    }

    try {
      const createdBy = ctx.userId;

      const template = await this.reportTemplateService.duplicate(
        templateId,
        dto.name,
        createdBy,
      );

      this.logger.log(`Template ${templateId} duplicated as '${template.name}' (${template.id})`);

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        system_id: template.system_id,
        test_environment: template.test_environment,
        workload: template.workload,
        sections: template.sections || [],
        styling: template.styling,
        is_default: template.is_default,
        created_by: template.created_by || '',
        created_at: template.created_at,
        updated_at: template.updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to duplicate template ${templateId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }
      if (errorMessage.includes('already exists')) {
        throw new HttpException(errorMessage, HttpStatus.CONFLICT);
      }
      throw new HttpException(
        'Failed to duplicate template',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':templateId/set-default')
  @ApiOperation({ summary: 'Set a template as the default for its scope' })
  @ApiParam({ name: 'templateId', description: 'Template UUID' })
  @ApiResponse({ status: 200, description: 'Template set as default', type: TemplateDetailDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async setAsDefault(@Param('templateId') templateId: string): Promise<TemplateDetailDto> {
    try {
      const template = await this.reportTemplateService.setAsDefault(templateId);

      this.logger.log(`Template ${templateId} set as default`);

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        system_id: template.system_id,
        test_environment: template.test_environment,
        workload: template.workload,
        sections: template.sections || [],
        styling: template.styling,
        is_default: template.is_default,
        created_by: template.created_by || '',
        created_at: template.created_at,
        updated_at: template.updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to set template ${templateId} as default:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to set template as default',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== Section Management ====================

  @Post(':templateId/sections')
  @ApiOperation({ summary: 'Add a section to a template' })
  @ApiParam({ name: 'templateId', description: 'Template UUID' })
  @ApiResponse({ status: 201, description: 'Section added successfully', type: TemplateDetailDto })
  @ApiResponse({ status: 400, description: 'Invalid section data' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async addSection(
    @Param('templateId') templateId: string,
    @Body() dto: AddSectionDto,
    @UserCtx() _ctx?: UserContext,
  ): Promise<TemplateDetailDto> {
    try {
      const template = await this.reportTemplateService.addSection(templateId, {
        type: dto.type as ReportSectionType,
        order: dto.order,
        title: dto.title,
        config: dto.config,
        comment: dto.comment,
      });

      this.logger.log(`Section added to template ${templateId}`);

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        system_id: template.system_id,
        test_environment: template.test_environment,
        workload: template.workload,
        sections: template.sections || [],
        styling: template.styling,
        is_default: template.is_default,
        created_by: template.created_by || '',
        created_at: template.created_at,
        updated_at: template.updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to add section to template ${templateId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }
      if (errorMessage.includes('Invalid') || errorMessage.includes('must be') || errorMessage.includes('Maximum')) {
        throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to add section to template',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':templateId/sections/:sectionIndex')
  @ApiOperation({ summary: 'Remove a section from a template' })
  @ApiParam({ name: 'templateId', description: 'Template UUID' })
  @ApiParam({ name: 'sectionIndex', description: 'Section order index (0-based)' })
  @ApiResponse({ status: 200, description: 'Section removed successfully', type: TemplateDetailDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Template or section not found' })
  async removeSection(
    @Param('templateId') templateId: string,
    @Param('sectionIndex') sectionIndex: string,
    @UserCtx() _ctx?: UserContext,
  ): Promise<TemplateDetailDto> {
    try {
      const sectionOrder = parseInt(sectionIndex, 10);
      if (isNaN(sectionOrder) || sectionOrder < 0) {
        throw new HttpException('Invalid section index', HttpStatus.BAD_REQUEST);
      }

      const template = await this.reportTemplateService.removeSection(templateId, sectionOrder);

      this.logger.log(`Section ${sectionOrder} removed from template ${templateId}`);

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        system_id: template.system_id,
        test_environment: template.test_environment,
        workload: template.workload,
        sections: template.sections || [],
        styling: template.styling,
        is_default: template.is_default,
        created_by: template.created_by || '',
        created_at: template.created_at,
        updated_at: template.updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to remove section from template ${templateId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to remove section from template',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':templateId/sections/reorder')
  @ApiOperation({ summary: 'Reorder sections in a template' })
  @ApiParam({ name: 'templateId', description: 'Template UUID' })
  @ApiResponse({ status: 200, description: 'Sections reordered successfully', type: TemplateDetailDto })
  @ApiResponse({ status: 400, description: 'Invalid order data' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async reorderSections(
    @Param('templateId') templateId: string,
    @Body() dto: ReorderSectionsDto,
    @UserCtx() _ctx?: UserContext,
  ): Promise<TemplateDetailDto> {
    try {
      const template = await this.reportTemplateService.reorderSections(
        templateId,
        dto.section_orders,
      );

      this.logger.log(`Sections reordered in template ${templateId}`);

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        system_id: template.system_id,
        test_environment: template.test_environment,
        workload: template.workload,
        sections: template.sections || [],
        styling: template.styling,
        is_default: template.is_default,
        created_by: template.created_by || '',
        created_at: template.created_at,
        updated_at: template.updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to reorder sections in template ${templateId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
      }
      if (errorMessage.includes('Invalid') || errorMessage.includes('Section with order')) {
        throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to reorder sections in template',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
