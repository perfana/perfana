import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { OwnedResource } from '@perfana/shared';
import { Organization, ProvisionedTemplateDsCompareConfig } from '../../entities';
import { withRequestEm } from '../../common/db/request-em';
import { AuthorizationService } from '../../common/services/authorization.service';
import { Capability } from '../../constants/capabilities.constants';
import { AuditService } from '../audit/audit.service';
import {
  compareTemplateRows,
  parseTemplateItem,
  rowToItem,
  serializeTemplates,
  templateKey,
  TemplateColumns,
} from './compare-template-codec';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CompareTemplateDefinitionDto } from './dto/compare-template.dto';
import type { CompareTemplateListDto, CompareTemplateResponseDto } from './dto/compare-template.dto';

/** Which collection of templates a request addresses. */
export type CompareTemplateScope = { kind: 'install' } | { kind: 'organization'; organizationId: string };

/** Migration 1822's unique index over `templateKey()`'s five terms. */
export const COMPARE_TEMPLATE_KEY_INDEX = 'uq_provisioned_template_ds_compare_configs_key';

/**
 * Whether a caught error is Postgres refusing a second template with the same key. Reads `code` and
 * `constraint` off the error and off a nested `driverError`, because TypeORM's `QueryFailedError`
 * and a rethrown driver error carry them in different places (apps/api/CODING_RULES.md, "Turning a
 * constraint violation into a 409").
 */
export function isDuplicateTemplateKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  const code = e.code ?? e.driverError?.code;
  const constraint = e.constraint ?? e.driverError?.constraint;
  return code === '23505' && constraint === COMPARE_TEMPLATE_KEY_INDEX;
}

type KeyFields = Pick<TemplateColumns, 'dashboard_uid' | 'regex' | 'panel_id' | 'panel_title' | 'metric_name'>;

/** The four non-scope terms of a template's key, as a person reads them. */
export function describeTemplateKey(v: Partial<KeyFields>): string {
  const dashboard =
    v.dashboard_uid == null ? 'every dashboard' : `dashboard ${v.regex ? 'matching ' : ''}"${v.dashboard_uid}"`;
  const panel =
    v.panel_id != null
      ? `panel ${v.panel_id}`
      : `panel ${v.regex ? 'titles matching' : 'titled'} "${v.panel_title}"`;
  return `${dashboard}, ${panel}${v.metric_name ? `, metric "${v.metric_name}"` : ''}`;
}

/** The entity's optional columns read as the codec's nullable ones. */
const asColumns = (row: ProvisionedTemplateDsCompareConfig): Partial<TemplateColumns> =>
  row as unknown as Partial<TemplateColumns>;

/**
 * Compare-config templates managed in the UI (design: docs/design/2026-11-08-compare-config-templates-design.md
 * §4 and §5), and the export that turns every template back into `template_ds_compare_configs.yaml`.
 *
 * Two scopes, each addressed as its own collection: an organization's templates, which apply to every
 * run in that organization, and install-wide ones (`organization_id IS NULL`), which apply to every
 * run. Every path is limited to `system_under_test_id IS NULL`: `classifyMetric` writes system-scoped
 * rows into the same table, and they are not templates.
 *
 * Authorization. The template table has no row-level security, so this service is the only boundary
 * on it, and `withRequestEm()` filters nothing here. Every method takes `accessibleOrgIds` as a
 * REQUIRED parameter (`null` = global admin; root CLAUDE.md #48):
 * - Read: an organization's templates need membership; install-wide ones any authenticated caller,
 *   because they apply to everyone's runs. A template or organization outside the caller's
 *   organizations answers 404, never 403, so its existence is not confirmed.
 * - Write: `benchmark:manage` in the template's organization (a template changes ADAPT verdicts the
 *   way an SLO does), checked after the 404 scoping; install-wide templates need a global admin.
 * - A provisioned template (`read_only`) is owned by the file: edit and delete answer 409.
 *
 * Validation is the codec's. A definition goes through `parseTemplateItem`, the function provisioning
 * runs on each file item, so a template created here is stored exactly as the file item that
 * describes it would be. That is what makes the round trip hold: export, commit, boot, and
 * provisioning takes the row over with identical content (`takenOver`), then reports it unchanged.
 */
@Injectable()
export class CompareTemplatesService {
  private readonly logger = new Logger(CompareTemplatesService.name);

  constructor(
    @InjectRepository(ProvisionedTemplateDsCompareConfig)
    private readonly templateRepo: Repository<ProvisionedTemplateDsCompareConfig>,
    @InjectRepository(Organization)
    private readonly organizationRepo: Repository<Organization>,
    private readonly auditService: AuditService,
    private readonly authzService: AuthorizationService,
  ) {}

  async list(
    scope: CompareTemplateScope,
    userId: string,
    roles: string[],
    accessibleOrgIds: string[] | null,
  ): Promise<CompareTemplateListDto> {
    const organizationId =
      scope.kind === 'install' ? null : (await this.loadOrganization(scope.organizationId, accessibleOrgIds)).id;
    const rows = await withRequestEm(this.templateRepo).find({
      where: { system_under_test_id: IsNull(), organization_id: organizationId ?? IsNull() },
    });
    rows.sort((a, b) => compareTemplateRows(asColumns(a), asColumns(b)));
    return {
      scope: scope.kind,
      organizationId,
      canWrite: await this.canWrite(organizationId, userId, roles, accessibleOrgIds),
      templates: rows.map((row) => this.toDto(row)),
    };
  }

  async findOne(id: string, accessibleOrgIds: string[] | null): Promise<CompareTemplateResponseDto> {
    return this.toDto(await this.loadAuthorized(id, accessibleOrgIds));
  }

  async create(
    scope: CompareTemplateScope,
    /** One item of the file, as sent (see `parse`). */
    definition: unknown,
    userId: string,
    roles: string[],
    accessibleOrgIds: string[] | null,
  ): Promise<CompareTemplateResponseDto> {
    const organization =
      scope.kind === 'install' ? null : await this.loadOrganization(scope.organizationId, accessibleOrgIds);
    const organizationId = organization?.id ?? null;
    await this.assertCanWrite(organizationId, userId, roles, accessibleOrgIds);

    const values = this.parse(definition, organizationId);
    const scopeLabel = this.scopeLabel(organization);
    await this.assertKeyFree(values, scopeLabel, null);

    const entity = this.templateRepo.create({
      ...values,
      read_only: false,
      created_by: userId,
      updated_by: userId,
    } as unknown as Partial<ProvisionedTemplateDsCompareConfig>);
    const saved = await this.saveRefusingDuplicateKey(entity, values, scopeLabel);
    this.auditService.logCreate(saved as unknown as OwnedResource, {
      organizationIdOverride: saved.organization_id ?? undefined,
    });
    this.logger.log(`Compare-config template ${saved.id} created in ${scopeLabel} by ${userId}: ${describeTemplateKey(values)}`);
    return this.toDto(saved);
  }

  /**
   * Replaces a template's definition wholesale, the way re-provisioning a file item does: a field the
   * new definition leaves out stops being forced. The scope never changes; copy to another scope instead.
   */
  async update(
    id: string,
    /** One item of the file, as sent (see `parse`). */
    definition: unknown,
    userId: string,
    roles: string[],
    accessibleOrgIds: string[] | null,
  ): Promise<CompareTemplateResponseDto> {
    const row = await this.loadAuthorized(id, accessibleOrgIds);
    const organizationId = row.organization_id ?? null;
    await this.assertCanWrite(organizationId, userId, roles, accessibleOrgIds);
    this.assertEditable(row);

    const values = this.parse(definition, organizationId);
    const scopeLabel = this.scopeLabel(organizationId ? await this.organizationName(organizationId) : null);
    await this.assertKeyFree(values, scopeLabel, row.id);

    const before = Object.assign(new ProvisionedTemplateDsCompareConfig(), row);
    Object.assign(row, values, { updated_by: userId });
    const saved = await this.saveRefusingDuplicateKey(row, values, scopeLabel);
    this.auditService.logUpdate(before as unknown as OwnedResource, saved as unknown as OwnedResource, {
      organizationIdOverride: saved.organization_id ?? undefined,
    });
    return this.toDto(saved);
  }

  /**
   * Rows the template owned are rebuilt from their base config, or handed to the next matching
   * template, on each workload's next completed run (design §2, Ownership).
   */
  async remove(id: string, userId: string, roles: string[], accessibleOrgIds: string[] | null): Promise<void> {
    const row = await this.loadAuthorized(id, accessibleOrgIds);
    await this.assertCanWrite(row.organization_id ?? null, userId, roles, accessibleOrgIds);
    this.assertEditable(row);
    const snapshot = Object.assign(new ProvisionedTemplateDsCompareConfig(), row);
    await withRequestEm(this.templateRepo).delete(row.id);
    this.auditService.logDelete(snapshot as unknown as OwnedResource, {
      organizationIdOverride: snapshot.organization_id ?? undefined,
    });
    this.logger.log(`Compare-config template ${row.id} deleted by ${userId}: ${describeTemplateKey(asColumns(row))}`);
  }

  /**
   * The install's whole `template_ds_compare_configs.yaml`: every template, provisioned or created in
   * the UI, across every scope. It replaces the installed file as a whole, because provisioning prunes
   * every provisioned template a file leaves out (design §4, "Why the whole file"). Global admin only:
   * the file declares every organization's templates.
   */
  async exportYaml(accessibleOrgIds: string[] | null): Promise<string> {
    if (accessibleOrgIds !== null) {
      throw new ForbiddenException('Only a global admin can export the compare-config templates file');
    }
    const rows = await withRequestEm(this.templateRepo).find({ where: { system_under_test_id: IsNull() } });
    this.logger.log(`Exported ${rows.length} compare-config template(s) as template_ds_compare_configs.yaml`);
    return serializeTemplates(rows.map(asColumns));
  }

  // ------------------------------------------------------------------------------------------

  /** Whether the caller may write templates in that scope (`null` = install-wide). */
  private async canWrite(
    organizationId: string | null,
    userId: string,
    roles: string[],
    accessibleOrgIds: string[] | null,
  ): Promise<boolean> {
    if (organizationId === null) return accessibleOrgIds === null;
    // An API key's organization is the key itself, and it already passed the 404 scoping; as in
    // SeriesGroupingService and TestRunsMutationService.
    if (userId.startsWith('api-key:')) return true;
    const caps = await this.authzService.getCapabilities(userId, roles, organizationId, null);
    return caps.includes(Capability.BenchmarkManage);
  }

  private async assertCanWrite(
    organizationId: string | null,
    userId: string,
    roles: string[],
    accessibleOrgIds: string[] | null,
  ): Promise<void> {
    if (await this.canWrite(organizationId, userId, roles, accessibleOrgIds)) return;
    this.logger.warn(
      `Compare-template write denied: userId=${userId} scope=${organizationId ?? 'install'} needs ${organizationId ? Capability.BenchmarkManage : 'global admin'}`,
    );
    throw new ForbiddenException(
      organizationId
        ? 'You do not have permission to manage compare-config templates in this organization'
        : 'Only a global admin can manage install-wide compare-config templates',
    );
  }

  private assertEditable(row: ProvisionedTemplateDsCompareConfig): void {
    if (row.read_only !== true) return;
    throw new ConflictException(
      'This template is provisioned from template_ds_compare_configs.yaml. Change it in the file, or copy it to another scope to edit the copy.',
    );
  }

  /**
   * The organization a caller named, which must be one of theirs and must exist. A global admin can
   * name any id, and the template table has no foreign key on `organization_id`, so existence is
   * checked here rather than left to an orphan row.
   */
  private async loadOrganization(
    organizationId: string,
    accessibleOrgIds: string[] | null,
  ): Promise<{ id: string; name: string }> {
    const id = organizationId.trim().toLowerCase();
    const notFound = new NotFoundException(`Organization ${id} not found`);
    if (accessibleOrgIds !== null && !accessibleOrgIds.some((o) => o.toLowerCase() === id)) {
      this.logger.warn(`Cross-tenant compare-template access refused for organization ${id}`);
      throw notFound;
    }
    const organization = await withRequestEm(this.organizationRepo).findOne({ where: { id } });
    if (!organization) throw notFound;
    return { id: organization.id, name: organization.name };
  }

  private async organizationName(organizationId: string): Promise<{ id: string; name: string }> {
    const organization = await withRequestEm(this.organizationRepo).findOne({ where: { id: organizationId } });
    return { id: organizationId, name: organization?.name ?? organizationId };
  }

  private scopeLabel(organization: { name: string } | null): string {
    return organization ? `organization "${organization.name}"` : 'the install-wide templates';
  }

  private async loadAuthorized(id: string, accessibleOrgIds: string[] | null): Promise<ProvisionedTemplateDsCompareConfig> {
    const notFound = new NotFoundException(`Compare-config template ${id} not found`);
    const row = await withRequestEm(this.templateRepo).findOne({ where: { id, system_under_test_id: IsNull() } });
    if (!row) throw notFound;
    if (row.organization_id && accessibleOrgIds !== null && !accessibleOrgIds.includes(row.organization_id)) {
      this.logger.warn(`Cross-tenant access refused for compare-config template ${id}`);
      throw notFound;
    }
    return row;
  }

  /**
   * The definition as the file would store it.
   *
   * The body arrives raw (the controller types it `unknown`), because the global ValidationPipe's
   * `whitelist` strips keys a DTO does not declare, silently: a misspelt `absoluteThreshold` would
   * vanish and the template would force nothing, which is exactly what the codec warns about in the
   * file. So class-validator checks the declared fields' types and column widths here (the codec does
   * not check widths, and an over-long value would fail the insert as a 500), and the codec sees every
   * key. Its warnings are refused rather than logged: the file warns because it cannot ask the
   * operator, the API can.
   */
  private parse(body: unknown, organizationId: string | null): TemplateColumns {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('The body must be one template definition, an object');
    }
    const item: Record<string, unknown> = Object.fromEntries(
      Object.entries(body as Record<string, unknown>).filter(([, v]) => v !== undefined),
    );
    if ('organizationId' in item) {
      throw new BadRequestException(
        'organizationId is not part of a template definition: name the scope with ?organizationId= or ?scope=install. A template keeps its scope; copy it to move it.',
      );
    }
    const errors = validateSync(plainToInstance(CompareTemplateDefinitionDto, item));
    if (errors.length > 0) {
      throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; '));
    }
    const parsed = parseTemplateItem(item, organizationId);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    if (parsed.warnings.length > 0) {
      throw new BadRequestException(
        `${parsed.warnings.join('; ')}. The provisioning file would skip this with a warning; the API refuses it instead.`,
      );
    }
    return parsed.values;
  }

  /**
   * Refuses a key another template in the scope already holds, naming it, before the insert. The
   * unique index still guards the race (`saveRefusingDuplicateKey`). A provisioned holder is named as
   * such, because the way out differs: a copy in the same scope always collides with it.
   */
  private async assertKeyFree(values: TemplateColumns, scopeLabel: string, selfId: string | null): Promise<void> {
    const key = templateKey(values);
    const rows = await withRequestEm(this.templateRepo).find({
      where: { system_under_test_id: IsNull(), organization_id: values.organization_id ?? IsNull() },
    });
    const holder = rows.find((row) => row.id !== selfId && templateKey(asColumns(row)) === key);
    if (!holder) return;
    throw new ConflictException(
      `There is already a template for ${describeTemplateKey(values)} in ${scopeLabel}` +
        (holder.read_only ? ', provisioned from template_ds_compare_configs.yaml' : '') +
        '. Edit that template, or change the dashboard, panel or metric.',
    );
  }

  /**
   * Nothing runs after a refused write, so the 23505 needs no SAVEPOINT here: the request's RLS
   * transaction is rolled back with the 409.
   */
  // audit-skip: helper; create() and update() audit the row it returns
  private async saveRefusingDuplicateKey(
    entity: ProvisionedTemplateDsCompareConfig,
    values: TemplateColumns,
    scopeLabel: string,
  ): Promise<ProvisionedTemplateDsCompareConfig> {
    try {
      return await withRequestEm(this.templateRepo).save(entity);
    } catch (error) {
      if (isDuplicateTemplateKey(error)) {
        throw new ConflictException(`There is already a template for ${describeTemplateKey(values)} in ${scopeLabel}.`);
      }
      throw error;
    }
  }

  private toDto(row: ProvisionedTemplateDsCompareConfig): CompareTemplateResponseDto {
    return {
      id: row.id,
      scope: row.organization_id ? 'organization' : 'install',
      organizationId: row.organization_id ?? null,
      readOnly: row.read_only === true,
      // The exporter's own mapping, so the UI shows what the file would say.
      definition: rowToItem(asColumns(row), false) as unknown as CompareTemplateDefinitionDto,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
