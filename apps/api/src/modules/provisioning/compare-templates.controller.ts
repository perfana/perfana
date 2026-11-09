import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { withOrgFilter } from '../../common/utils/with-org-filter';
import { AdminOnly } from '../../decorators/admin-only.decorator';
import { CompareTemplateScope, CompareTemplatesService } from './compare-templates.service';
import {
  CompareTemplateDefinitionDto,
  CompareTemplateListDto,
  CompareTemplateResponseDto,
} from './dto/compare-template.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which collection a list or create addresses: `?organizationId=<uuid>` for an organization's
 * templates, `?scope=install` for install-wide ones. Exactly one, so a forgotten parameter is a 400
 * rather than a silent install-wide write.
 */
export function parseTemplateScope(organizationId?: string, scope?: string): CompareTemplateScope {
  const hasOrganization = organizationId !== undefined && organizationId !== '';
  if (scope === 'install' && !hasOrganization) return { kind: 'install' };
  if (hasOrganization && (scope === undefined || scope === '' || scope === 'organization')) {
    if (!UUID.test(organizationId!)) throw new BadRequestException('organizationId must be a uuid');
    return { kind: 'organization', organizationId: organizationId! };
  }
  throw new BadRequestException('Name exactly one scope: ?organizationId=<uuid> or ?scope=install');
}

/**
 * Compare-config (ADAPT) templates created in the UI. Provisioned ones are listed too, read-only.
 * File format and precedence: docs/reference/Features/Compare Config Templates.md.
 *
 * No try/catch here on purpose: the service throws HttpExceptions, and a catch that wrapped
 * everything would turn its 409 into a 500 (apps/api/CODING_RULES.md, "Turning a constraint
 * violation into a 409").
 */
@ApiTags('compare-templates')
@ApiBearerAuth()
@Controller('compare-templates')
export class CompareTemplatesController {
  constructor(
    private readonly service: CompareTemplatesService,
    private readonly authzService: AuthorizationService,
  ) {}

  /** The caller's accessible organizations, or `null` for a global admin; resolved once per request. */
  private orgScope(ctx: UserContext): Promise<string[] | null> {
    return withOrgFilter(ctx.userId, ctx.roles, this.authzService);
  }

  @Get()
  @ApiOperation({
    summary: 'List compare-config templates in one scope',
    description:
      "An organization's templates (members of it), or the install-wide ones (any authenticated user, since they apply to every run). " +
      'In the order the YAML export writes them. `canWrite` says whether the caller may change this scope.',
  })
  @ApiQuery({ name: 'organizationId', required: false, description: "The organization's templates" })
  @ApiQuery({ name: 'scope', required: false, enum: ['install'], description: 'install: the install-wide templates' })
  @ApiResponse({ status: 200, type: CompareTemplateListDto })
  @ApiResponse({ status: 400, description: 'Neither or both of organizationId and scope=install' })
  @ApiResponse({ status: 404, description: 'Organization not found, or not one of yours' })
  async list(
    @UserCtx() ctx: UserContext,
    @Query('organizationId') organizationId?: string,
    @Query('scope') scope?: string,
  ): Promise<CompareTemplateListDto> {
    return this.service.list(parseTemplateScope(organizationId, scope), ctx.userId, ctx.roles, await this.orgScope(ctx));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one compare-config template' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: CompareTemplateResponseDto })
  @ApiResponse({ status: 404, description: 'Not found, or outside your organizations' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext): Promise<CompareTemplateResponseDto> {
    return this.service.findOne(id, await this.orgScope(ctx));
  }

  @Post()
  @ApiOperation({
    summary: 'Create a compare-config template',
    description:
      'Creates a UI-owned template in the named scope. It applies on the next completed run of matching workloads, to panels nobody has hand-edited. ' +
      'If template_ds_compare_configs.yaml later declares the same template, provisioning takes it over and it becomes read-only.',
  })
  @ApiQuery({ name: 'organizationId', required: false })
  @ApiQuery({ name: 'scope', required: false, enum: ['install'] })
  @ApiBody({ type: CompareTemplateDefinitionDto })
  @ApiResponse({ status: 201, type: CompareTemplateResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid definition (the same rules the YAML file is held to, and an unknown field or an organizationId in the body is refused), or no single scope named' })
  @ApiResponse({ status: 403, description: 'Missing benchmark:manage in the organization, or not a global admin for an install-wide template' })
  @ApiResponse({ status: 404, description: 'Organization not found, or not one of yours' })
  @ApiResponse({
    status: 409,
    description:
      'The scope already has a template with this dashboard, panel and metric. A constraint violation the user has to act on, with no resource body: the message names the scope and the key.',
  })
  async create(
    // `unknown`, not the DTO: the global pipe's whitelist would strip a misspelt key silently, and
    // the service needs to see it to refuse it (CompareTemplatesService.parse).
    @Body() dto: unknown,
    @UserCtx() ctx: UserContext,
    @Query('organizationId') organizationId?: string,
    @Query('scope') scope?: string,
  ): Promise<CompareTemplateResponseDto> {
    return this.service.create(parseTemplateScope(organizationId, scope), dto, ctx.userId, ctx.roles, await this.orgScope(ctx));
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Replace a compare-config template',
    description:
      'Replaces the whole definition, as re-provisioning a file item does: a field left out stops being forced. The scope cannot change; create a copy in another scope instead.',
  })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: CompareTemplateDefinitionDto })
  @ApiResponse({ status: 200, type: CompareTemplateResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid definition, or one that names organizationId or a field the format does not know' })
  @ApiResponse({ status: 403, description: 'Missing benchmark:manage in the organization, or not a global admin for an install-wide template' })
  @ApiResponse({ status: 404, description: 'Not found, or outside your organizations' })
  @ApiResponse({
    status: 409,
    description:
      'Provisioned from template_ds_compare_configs.yaml (edit the file), or another template in the scope already has this key. A hard refusal with no resource body.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: unknown,
    @UserCtx() ctx: UserContext,
  ): Promise<CompareTemplateResponseDto> {
    return this.service.update(id, dto, ctx.userId, ctx.roles, await this.orgScope(ctx));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a compare-config template',
    description:
      "Rows it owned go to the next matching template, or are rebuilt from their own base config, on each workload's next completed run.",
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 403, description: 'Missing benchmark:manage in the organization, or not a global admin for an install-wide template' })
  @ApiResponse({ status: 404, description: 'Not found, or outside your organizations' })
  @ApiResponse({ status: 409, description: 'Provisioned from template_ds_compare_configs.yaml: remove it from the file instead' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @UserCtx() ctx: UserContext): Promise<void> {
    await this.service.remove(id, ctx.userId, ctx.roles, await this.orgScope(ctx));
  }
}

/**
 * The provisioning file, generated from the database. A drop-in replacement for the install's one
 * `template_ds_compare_configs.yaml`.
 */
@ApiTags('compare-templates')
@ApiBearerAuth()
@Controller('provisioning')
export class ProvisioningExportController {
  constructor(
    private readonly service: CompareTemplatesService,
    private readonly authzService: AuthorizationService,
  ) {}

  @Get('compare-templates/export')
  @AdminOnly()
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="template_ds_compare_configs.yaml"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Export every compare-config template as template_ds_compare_configs.yaml (global admin)',
    description:
      'The whole file: every template, provisioned or created in the UI, in every scope. Commit it in place of the installed file; ' +
      'provisioning prunes provisioned templates a file leaves out, so a partial file would delete them. ' +
      "The first export of a hand-written file drops its comments and reorders its keys; from then on export, provision, export is byte-identical.",
  })
  @ApiProduces('application/yaml')
  @ApiResponse({ status: 200, description: 'The YAML file', content: { 'application/yaml': { schema: { type: 'string' } } } })
  @ApiResponse({ status: 403, description: 'Not a global admin' })
  async export(@UserCtx() ctx: UserContext): Promise<string> {
    return this.service.exportYaml(await withOrgFilter(ctx.userId, ctx.roles, this.authzService));
  }
}
