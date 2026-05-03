import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import {
  ReportTemplate,
  ReportSectionConfig,
  ReportStyling,
  SystemUnderTest,
} from '@perfana/shared';
import {
  ResourceNotFoundException,
  DatabaseException,
  ValidationException,
  ResourceExistsException,
} from '../../../common/exceptions/business.exception';
import { CopyReportTemplatesDto } from '../dto/copy-report-templates.dto';

// ==================== Interfaces ====================

/**
 * Options for creating a new report template
 */
export interface CreateTemplateOptions {
  name: string;
  description?: string;
  createdBy: string;
  systemId: string;
  testEnvironment: string;
  workload: string;
  sections: ReportSectionConfig[];
  styling?: ReportStyling;
  isDefault?: boolean;
}

/**
 * Options for updating a report template
 */
export interface UpdateTemplateOptions {
  name?: string;
  description?: string;
  sections?: ReportSectionConfig[];
  styling?: ReportStyling;
  isDefault?: boolean;
  updatedBy?: string;
}

/**
 * Query options for listing templates
 */
export interface TemplateQueryOptions {
  systemId?: string;
  testEnvironment?: string;
  workload?: string;
  isDefault?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'name' | 'created_at' | 'updated_at';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated template list response
 */
export interface TemplateListResponse {
  items: ReportTemplate[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Template summary for dropdown/selection UI
 */
export interface TemplateSummary {
  id: string;
  name: string;
  description?: string;
  sectionCount: number;
  isDefault: boolean;
  createdAt: Date;
}

// ==================== Service ====================

/**
 * Service for report template CRUD operations.
 *
 * Templates are scoped by system_id/test_environment/workload and have
 * a unique constraint on (name, system_id, test_environment, workload).
 *
 * This service provides:
 * - CRUD operations for report templates
 * - Filtering and pagination for template queries
 * - Validation for section configuration
 * - Default template management
 */
@Injectable()
export class ReportTemplateService {
  private readonly logger = new Logger(ReportTemplateService.name);

  constructor(
    @InjectRepository(ReportTemplate)
    private readonly templateRepo: Repository<ReportTemplate>,
    @InjectRepository(SystemUnderTest)
    private readonly systemRepo: Repository<SystemUnderTest>,
  ) {}

  // ==================== Create Operations ====================

  /**
   * Create a new report template
   * @param options - Template creation options
   * @returns Created template entity
   * @throws ResourceExistsException if template with same name/scope exists
   * @throws ValidationException if sections are invalid
   */
  async create(options: CreateTemplateOptions): Promise<ReportTemplate> {
    try {
      // Validate sections
      this.validateSections(options.sections);

      // Check for existing template with same name in scope
      const existing = await this.templateRepo.findOne({
        where: {
          name: options.name,
          system_id: options.systemId,
          test_environment: options.testEnvironment,
          workload: options.workload,
        },
      });

      if (existing) {
        throw new ResourceExistsException(
          'Report Template',
          `name '${options.name}' in scope ${options.systemId}/${options.testEnvironment}/${options.workload}`,
        );
      }

      // If this is a default template, unset other defaults in scope
      if (options.isDefault) {
        await this.clearDefaultInScope(
          options.systemId,
          options.testEnvironment,
          options.workload,
        );
      }

      // Inherit org/team from the parent SUT — ReportTemplate.organization_id
      // is NOT NULL and the camelCase property key is required.
      const system = await this.systemRepo.findOne({ where: { id: options.systemId } });
      if (!system) {
        throw new ResourceNotFoundException('SystemUnderTest', options.systemId);
      }

      // Create the template entity
      const template = this.templateRepo.create({
        name: options.name,
        description: options.description,
        created_by: options.createdBy,
        system_id: options.systemId,
        test_environment: options.testEnvironment,
        workload: options.workload,
        sections: options.sections,
        styling: options.styling,
        is_default: options.isDefault || false,
        organizationId: system.organization_id,
        teamId: system.team_id,
      });

      const savedTemplate = await this.templateRepo.save(template);

      this.logger.log(
        `Created report template '${savedTemplate.name}' (${savedTemplate.id}) for ${options.systemId}/${options.testEnvironment}/${options.workload}`,
      );

      return savedTemplate;
    } catch (error) {
      if (
        error instanceof ResourceExistsException ||
        error instanceof ValidationException
      ) {
        throw error;
      }
      this.logger.error(`Failed to create report template: ${(error as Error).message}`);
      throw new DatabaseException('Failed to create report template', error);
    }
  }

  // ==================== Read Operations ====================

  /**
   * Find template by ID
   * @param templateId - Template UUID
   * @returns Template entity
   * @throws ResourceNotFoundException if not found
   */
  async findById(templateId: string): Promise<ReportTemplate> {
    try {
      const template = await this.templateRepo.findOne({
        where: { id: templateId },
      });

      if (!template) {
        throw new ResourceNotFoundException('Report Template', templateId);
      }

      return template;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to find template ${templateId}: ${(error as Error).message}`);
      throw new DatabaseException('Failed to retrieve template', error);
    }
  }

  /**
   * Find templates with filtering and pagination
   * @param queryOptions - Query parameters for filtering and pagination
   * @returns Paginated list of templates
   */
  async findAll(queryOptions?: TemplateQueryOptions): Promise<TemplateListResponse> {
    try {
      const {
        systemId,
        testEnvironment,
        workload,
        isDefault,
        search,
        limit = 50,
        offset = 0,
        sortBy = 'created_at',
        sortOrder = 'desc',
      } = queryOptions || {};

      const where: FindOptionsWhere<ReportTemplate> = {};

      if (systemId) {
        where.system_id = systemId;
      }
      if (testEnvironment) {
        where.test_environment = testEnvironment;
      }
      if (workload) {
        where.workload = workload;
      }
      if (isDefault !== undefined) {
        where.is_default = isDefault;
      }

      // Always exclude adhoc templates from listings (they're ephemeral)
      where.is_adhoc = false;

      // Handle search across name and description
      let queryBuilder = this.templateRepo.createQueryBuilder('template');

      if (Object.keys(where).length > 0) {
        queryBuilder = queryBuilder.where(where);
      }

      if (search) {
        queryBuilder = queryBuilder.andWhere(
          '(template.name ILIKE :search OR template.description ILIKE :search)',
          { search: `%${search}%` },
        );
      }

      // Sorting
      const sortFieldMap: Record<string, string> = {
        name: 'template.name',
        created_at: 'template.created_at',
        updated_at: 'template.updated_at',
      };
      const orderField = sortFieldMap[sortBy] || 'template.created_at';

      queryBuilder = queryBuilder
        .orderBy(orderField, sortOrder.toUpperCase() as 'ASC' | 'DESC')
        .skip(offset)
        .take(limit);

      const [templates, total] = await queryBuilder.getManyAndCount();

      this.logger.debug(`Found ${total} templates matching query`);

      return {
        items: templates,
        total,
        offset,
        limit,
      };
    } catch (error) {
      this.logger.error(`Failed to list templates: ${(error as Error).message}`);
      throw new DatabaseException('Failed to list templates', error);
    }
  }

  /**
   * Get templates for a specific scope (system/environment/workload)
   * @param systemId - System under test ID
   * @param testEnvironment - Test environment name
   * @param workload - Workload name
   * @returns List of templates in the scope
   */
  async findByScope(
    systemId: string,
    testEnvironment: string,
    workload: string,
  ): Promise<ReportTemplate[]> {
    try {
      return await this.templateRepo.find({
        where: {
          system_id: systemId,
          test_environment: testEnvironment,
          workload: workload,
          is_adhoc: false, // Exclude ephemeral adhoc templates
        },
        order: { is_default: 'DESC', name: 'ASC' },
      });
    } catch (error) {
      this.logger.error(`Failed to find templates by scope: ${(error as Error).message}`);
      throw new DatabaseException('Failed to find templates by scope', error);
    }
  }

  /**
   * Get the default template for a scope
   * @param systemId - System under test ID
   * @param testEnvironment - Test environment name
   * @param workload - Workload name
   * @returns Default template or null if none set
   */
  async findDefault(
    systemId: string,
    testEnvironment: string,
    workload: string,
  ): Promise<ReportTemplate | null> {
    try {
      return await this.templateRepo.findOne({
        where: {
          system_id: systemId,
          test_environment: testEnvironment,
          workload: workload,
          is_default: true,
          is_adhoc: false, // Default templates cannot be adhoc
        },
      });
    } catch (error) {
      this.logger.error(`Failed to find default template: ${(error as Error).message}`);
      throw new DatabaseException('Failed to find default template', error);
    }
  }

  /**
   * Get template summaries for dropdown/selection UI
   * @param systemId - System under test ID
   * @param testEnvironment - Test environment name
   * @param workload - Workload name
   * @returns List of template summaries
   */
  async getSummaries(
    systemId: string,
    testEnvironment: string,
    workload: string,
  ): Promise<TemplateSummary[]> {
    try {
      const templates = await this.findByScope(systemId, testEnvironment, workload);

      return templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        sectionCount: (t.sections || []).length,
        isDefault: t.is_default,
        createdAt: t.created_at,
      }));
    } catch (error) {
      this.logger.error(`Failed to get template summaries: ${(error as Error).message}`);
      throw new DatabaseException('Failed to get template summaries', error);
    }
  }

  // ==================== Update Operations ====================

  /**
   * Update a report template
   * @param templateId - Template UUID
   * @param options - Update options
   * @returns Updated template entity
   * @throws ResourceNotFoundException if not found
   * @throws ResourceExistsException if new name conflicts in scope
   */
  async update(
    templateId: string,
    options: UpdateTemplateOptions,
  ): Promise<ReportTemplate> {
    try {
      const template = await this.findById(templateId);

      // Validate sections if provided
      if (options.sections) {
        this.validateSections(options.sections);
      }

      // Check for name conflict if name is being updated
      if (options.name && options.name !== template.name) {
        const existing = await this.templateRepo.findOne({
          where: {
            name: options.name,
            system_id: template.system_id,
            test_environment: template.test_environment,
            workload: template.workload,
          },
        });

        if (existing && existing.id !== templateId) {
          throw new ResourceExistsException(
            'Report Template',
            `name '${options.name}' in scope ${template.system_id}/${template.test_environment}/${template.workload}`,
          );
        }
      }

      // If setting as default, unset other defaults
      if (options.isDefault === true && !template.is_default) {
        await this.clearDefaultInScope(
          template.system_id,
          template.test_environment,
          template.workload,
          templateId,
        );
      }

      // Build update data
      const updateData: Partial<ReportTemplate> = {};

      if (options.name !== undefined) {
        updateData.name = options.name;
      }
      if (options.description !== undefined) {
        updateData.description = options.description;
      }
      if (options.sections !== undefined) {
        updateData.sections = options.sections;
      }
      if (options.styling !== undefined) {
        updateData.styling = options.styling;
      }
      if (options.isDefault !== undefined) {
        updateData.is_default = options.isDefault;
      }
      if (options.updatedBy) {
        updateData.updatedBy = options.updatedBy;
      }

      await this.templateRepo.update(templateId, updateData as Record<string, unknown>);

      const updatedTemplate = await this.findById(templateId);

      this.logger.log(`Updated report template '${updatedTemplate.name}' (${templateId})`);

      return updatedTemplate;
    } catch (error) {
      if (
        error instanceof ResourceNotFoundException ||
        error instanceof ResourceExistsException ||
        error instanceof ValidationException
      ) {
        throw error;
      }
      this.logger.error(`Failed to update template ${templateId}: ${(error as Error).message}`);
      throw new DatabaseException('Failed to update template', error);
    }
  }

  /**
   * Set a template as the default for its scope
   * @param templateId - Template UUID to set as default
   * @returns Updated template entity
   */
  async setAsDefault(templateId: string): Promise<ReportTemplate> {
    return this.update(templateId, { isDefault: true });
  }

  /**
   * Add a section to a template
   * @param templateId - Template UUID
   * @param section - Section to add
   * @returns Updated template entity
   */
  async addSection(
    templateId: string,
    section: ReportSectionConfig,
  ): Promise<ReportTemplate> {
    const template = await this.findById(templateId);

    // Validate the new section
    this.validateSections([section]);

    // Add section with appropriate order
    const sections = [...(template.sections || [])];
    const maxOrder = sections.reduce((max, s) => Math.max(max, s.order), -1);
    const newSection = { ...section, order: section.order ?? maxOrder + 1 };
    sections.push(newSection);

    return this.update(templateId, { sections });
  }

  /**
   * Remove a section from a template
   * @param templateId - Template UUID
   * @param sectionOrder - Order of section to remove
   * @returns Updated template entity
   */
  async removeSection(templateId: string, sectionOrder: number): Promise<ReportTemplate> {
    const template = await this.findById(templateId);

    const sections = (template.sections || []).filter((s) => s.order !== sectionOrder);

    // Re-order remaining sections
    const reorderedSections = sections.map((s, index) => ({
      ...s,
      order: index,
    }));

    return this.update(templateId, { sections: reorderedSections });
  }

  /**
   * Reorder sections in a template
   * @param templateId - Template UUID
   * @param sectionOrders - Array of section orders in new order
   * @returns Updated template entity
   */
  async reorderSections(
    templateId: string,
    sectionOrders: number[],
  ): Promise<ReportTemplate> {
    const template = await this.findById(templateId);
    const existingSections = template.sections || [];

    // Validate all orders exist
    const existingOrders = new Set(existingSections.map((s) => s.order));
    for (const order of sectionOrders) {
      if (!existingOrders.has(order)) {
        throw new ValidationException(`Section with order ${order} not found`);
      }
    }

    // Create new order mapping
    const orderMap = new Map<number, number>();
    sectionOrders.forEach((oldOrder, newIndex) => {
      orderMap.set(oldOrder, newIndex);
    });

    // Apply new order
    const reorderedSections = existingSections.map((s) => ({
      ...s,
      order: orderMap.get(s.order) ?? s.order,
    }));

    // Sort by new order
    reorderedSections.sort((a, b) => a.order - b.order);

    return this.update(templateId, { sections: reorderedSections });
  }

  // ==================== Delete Operations ====================

  /**
   * Delete a report template
   * @param templateId - Template UUID
   * @throws ResourceNotFoundException if not found
   */
  async delete(templateId: string): Promise<void> {
    try {
      const result = await this.templateRepo.delete(templateId);

      if (result.affected === 0) {
        throw new ResourceNotFoundException('Report Template', templateId);
      }

      this.logger.log(`Deleted report template ${templateId}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete template ${templateId}: ${(error as Error).message}`);
      throw new DatabaseException('Failed to delete template', error);
    }
  }

  /**
   * Duplicate a template with a new name
   * @param templateId - Template UUID to duplicate
   * @param newName - Name for the new template
   * @param createdBy - Username of creator
   * @returns New template entity
   */
  async duplicate(
    templateId: string,
    newName: string,
    createdBy: string,
  ): Promise<ReportTemplate> {
    const template = await this.findById(templateId);

    return this.create({
      name: newName,
      description: template.description
        ? `${template.description} (duplicated from ${template.name})`
        : `Duplicated from ${template.name}`,
      createdBy,
      systemId: template.system_id,
      testEnvironment: template.test_environment,
      workload: template.workload,
      sections: template.sections,
      styling: template.styling,
      isDefault: false, // Duplicated templates are not default
    });
  }

  /**
   * Copy report templates from a source scope to a target scope
   *
   * @param dto - Copy parameters including source/target scopes and conflict strategy
   * @param createdBy - User ID of the creator (for ownership tracking)
   */
  async copyToScope(
    dto: CopyReportTemplatesDto,
    createdBy: string,
  ): Promise<{ copied: number; skipped: number; total: number }> {
    try {
      let sourceTemplates = await this.findByScope(
        dto.sourceSystemId,
        dto.sourceTestEnvironment,
        dto.sourceWorkload,
      );

      // Filter to specific IDs if provided
      if (dto.ids && dto.ids.length > 0) {
        const idSet = new Set(dto.ids);
        sourceTemplates = sourceTemplates.filter(t => idSet.has(t.id));
      }

      const total = sourceTemplates.length;
      let copied = 0;
      let skipped = 0;

      const existingTemplates = await this.findByScope(
        dto.targetSystemId,
        dto.targetTestEnvironment,
        dto.targetWorkload,
      );
      const existingNameMap = new Map(existingTemplates.map(t => [t.name, t]));

      for (const template of sourceTemplates) {
        const existing = existingNameMap.get(template.name);

        if (existing && dto.conflictStrategy === 'skip') {
          skipped++;
          continue;
        }

        if (existing && dto.conflictStrategy === 'overwrite') {
          await this.update(existing.id, {
            description: template.description,
            sections: template.sections,
            styling: template.styling,
          });
          copied++;
          continue;
        }

        // Create new
        await this.create({
          name: template.name,
          description: template.description,
          createdBy,
          systemId: dto.targetSystemId,
          testEnvironment: dto.targetTestEnvironment,
          workload: dto.targetWorkload,
          sections: template.sections,
          styling: template.styling,
          isDefault: false,
        });
        copied++;
      }

      this.logger.log(`Copied ${copied} report templates, skipped ${skipped} of ${total} total`);
      return { copied, skipped, total };
    } catch (error) {
      if (error instanceof ResourceExistsException || error instanceof ValidationException) {
        throw error;
      }
      this.logger.error(`Failed to copy report templates: ${(error as Error).message}`);
      throw new DatabaseException('Failed to copy report templates', error);
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Validate section configuration
   * @throws ValidationException if sections are invalid
   */
  private validateSections(sections: ReportSectionConfig[]): void {
    if (!Array.isArray(sections)) {
      throw new ValidationException('Sections must be an array');
    }

    if (sections.length > 50) {
      throw new ValidationException('Maximum 50 sections allowed per template');
    }

    const validTypes = [
      'header',
      'text_block',
      'slo',
      'apdex',
      'transaction_response_times',
      'regressions',
      'awr',
      'trends',
      'comparisons',
      'graphs',
    ];

    const orders = new Set<number>();

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];

      if (!section) {
        throw new ValidationException(`Section at index ${i} is undefined`);
      }

      // Validate type
      if (!section.type || !validTypes.includes(section.type)) {
        throw new ValidationException(
          `Invalid section type '${section.type}' at index ${i}. Valid types: ${validTypes.join(', ')}`,
        );
      }

      // Validate order
      if (typeof section.order !== 'number' || section.order < 0) {
        throw new ValidationException(
          `Invalid section order at index ${i}. Order must be a non-negative number`,
        );
      }

      // Check for duplicate orders
      if (orders.has(section.order)) {
        throw new ValidationException(
          `Duplicate section order ${section.order} found`,
        );
      }
      orders.add(section.order);

      // Validate comments are only on commentable sections
      const nonCommentableSections = ['header', 'text_block'];
      if (section.comment && nonCommentableSections.includes(section.type)) {
        throw new ValidationException(
          `Comments are not allowed on '${section.type}' sections (index ${i})`,
        );
      }
    }
  }

  /**
   * Clear the default flag for all templates in a scope
   * @param excludeId - Optional template ID to exclude from clearing
   */
  private async clearDefaultInScope(
    systemId: string,
    testEnvironment: string,
    workload: string,
    excludeId?: string,
  ): Promise<void> {
    try {
      let queryBuilder = this.templateRepo
        .createQueryBuilder()
        .update(ReportTemplate)
        .set({ is_default: false })
        .where('system_id = :systemId', { systemId })
        .andWhere('test_environment = :testEnvironment', { testEnvironment })
        .andWhere('workload = :workload', { workload })
        .andWhere('is_default = :isDefault', { isDefault: true });

      if (excludeId) {
        queryBuilder = queryBuilder.andWhere('id != :excludeId', { excludeId });
      }

      await queryBuilder.execute();

      this.logger.debug(
        `Cleared default flag in scope ${systemId}/${testEnvironment}/${workload}`,
      );
    } catch (error) {
      this.logger.error(`Failed to clear default in scope: ${(error as Error).message}`);
      throw new DatabaseException('Failed to clear default template', error);
    }
  }
}
