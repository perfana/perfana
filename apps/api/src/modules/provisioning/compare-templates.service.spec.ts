import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import * as yaml from 'js-yaml';
import { ProvisionedTemplateDsCompareConfig } from '../../entities';
import { Capability } from '../../constants/capabilities.constants';
import { CompareTemplatesService, describeTemplateKey, isDuplicateTemplateKey } from './compare-templates.service';
import { ProvisioningService } from './provisioning.service';
import { templateKey, TemplateColumns } from './compare-template-codec';
import type { CompareTemplateDefinitionDto } from './dto/compare-template.dto';

/**
 * The request-scoped entity manager is absent in unit tests, so withRequestEm() hands back the
 * repositories below unchanged.
 */
jest.mock('../../common/db/request-em', () => {
  const actual = jest.requireActual('../../common/db/request-em');
  return { ...actual, getRequestEm: jest.fn(() => null), withRequestEm: jest.fn((repo: unknown) => repo) };
});

const ORG_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ORG_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const ORGS: Record<string, string> = { [ORG_A]: 'Acme', [ORG_B]: 'Bravo' };
const P_JVM = 'dddddddd-0000-4000-8000-00000000000d';
const P_DOTNET = 'eeeeeeee-0000-4000-8000-00000000000e';
const P_OTHER = 'ffffffff-0000-4000-8000-00000000000f';
/** Profiles by id. `readOnly` is a provisioned profile, which still takes UI templates. */
const PROFILES: Record<string, { id: string; name: string; organizationId: string; readOnly?: boolean }> = {
  [P_JVM]: { id: P_JVM, name: 'jvm', organizationId: ORG_A, readOnly: true },
  [P_DOTNET]: { id: P_DOTNET, name: 'dotnet', organizationId: ORG_A },
  [P_OTHER]: { id: P_OTHER, name: 'other', organizationId: ORG_B },
};
const profileRepo = {
  findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) => PROFILES[id] ?? null),
  find: jest.fn(async (opts: { where?: { id?: { value?: string[] } } } = {}) => {
    const ids = opts.where?.id?.value;
    return Object.values(PROFILES).filter((p) => !ids || ids.includes(p.id));
  }),
};

const duplicateKey = () =>
  Object.assign(new Error('duplicate key value violates unique constraint "uq_provisioned_template_ds_compare_configs_key"'), {
    code: '23505',
    constraint: 'uq_provisioned_template_ds_compare_configs_key',
  });

const clone = (row: ProvisionedTemplateDsCompareConfig): ProvisionedTemplateDsCompareConfig =>
  Object.assign(new ProvisionedTemplateDsCompareConfig(), row, {
    config_overrides: row.config_overrides == null ? row.config_overrides : JSON.parse(JSON.stringify(row.config_overrides)),
  });

/**
 * The template table, in memory, behind both services' repositories. It understands the `where`
 * shapes they use (equality and `IsNull()`), and it enforces migration 1822's unique key over
 * `system_under_test_id IS NULL` rows, so a write that would collide fails as Postgres would.
 */
function templateTable(initial: Array<Partial<ProvisionedTemplateDsCompareConfig>> = []) {
  const rows: ProvisionedTemplateDsCompareConfig[] = [];
  let seq = 0;
  const now = () => new Date(Date.UTC(2026, 10, 8, 12, 0, seq));
  const add = (fields: Partial<ProvisionedTemplateDsCompareConfig>) => {
    seq++;
    const row = Object.assign(new ProvisionedTemplateDsCompareConfig(), {
      regex: false,
      read_only: false,
      created_at: now(),
      updated_at: now(),
      ...fields,
      id: fields.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    });
    rows.push(row);
    return row;
  };
  initial.forEach(add);

  const matches = (row: ProvisionedTemplateDsCompareConfig, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => {
      const actual = (row as unknown as Record<string, unknown>)[k];
      if (v instanceof FindOperator && v.type === 'isNull') return actual == null;
      return actual === v;
    });
  const assertUnique = (candidate: Partial<ProvisionedTemplateDsCompareConfig>, selfId?: string) => {
    if (candidate.system_under_test_id != null) return;
    const key = templateKey(candidate as Partial<TemplateColumns>);
    if (rows.some((r) => r.id !== selfId && r.system_under_test_id == null && templateKey(r as unknown as Partial<TemplateColumns>) === key)) {
      throw duplicateKey();
    }
  };

  const repo = {
    find: jest.fn(async (opts: { where?: Record<string, unknown> } = {}) => rows.filter((r) => matches(r, opts.where)).map(clone)),
    count: jest.fn(async (opts: { where?: Record<string, unknown> } = {}) => rows.filter((r) => matches(r, opts.where)).length),
    findOne: jest.fn(async (opts: { where: Record<string, unknown> }) => {
      const row = rows.find((r) => matches(r, opts.where));
      return row ? clone(row) : null;
    }),
    create: jest.fn((fields: Partial<ProvisionedTemplateDsCompareConfig>) => Object.assign(new ProvisionedTemplateDsCompareConfig(), fields)),
    save: jest.fn(async (entity: ProvisionedTemplateDsCompareConfig) => {
      const existing = entity.id ? rows.find((r) => r.id === entity.id) : undefined;
      assertUnique(entity, existing?.id);
      if (existing) {
        Object.assign(existing, entity, { updated_at: now() });
        return clone(existing);
      }
      return clone(add(entity));
    }),
    insert: jest.fn(async (values: Partial<ProvisionedTemplateDsCompareConfig>) => {
      assertUnique(values);
      add(values);
    }),
    update: jest.fn(async (id: string, values: Partial<ProvisionedTemplateDsCompareConfig>) => {
      const row = rows.find((r) => r.id === id)!;
      assertUnique({ ...row, ...values }, id);
      Object.assign(row, values, { updated_at: now() });
    }),
    delete: jest.fn(async (id: string) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    }),
  };
  return { rows, repo };
}

const def = (over: Partial<CompareTemplateDefinitionDto> = {}): CompareTemplateDefinitionDto => ({
  dashboardUid: 'jvm-overview',
  panelId: 7,
  metricClassification: 'USE_saturation',
  ...over,
});

describe('CompareTemplatesService', () => {
  let table: ReturnType<typeof templateTable>;
  let service: CompareTemplatesService;
  let audit: { logCreate: jest.Mock; logUpdate: jest.Mock; logDelete: jest.Mock };
  let authz: { getCapabilities: jest.Mock };
  /** Capabilities per `${userId}:${organizationId}`. */
  let caps: Record<string, string[]>;

  const build = (initial: Array<Partial<ProvisionedTemplateDsCompareConfig>> = []) => {
    table = templateTable(initial);
    const organizationRepo = {
      findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) => (ORGS[id] ? { id, name: ORGS[id] } : null)),
    };
    service = new CompareTemplatesService(
      table.repo as never,
      organizationRepo as never,
      audit as never,
      authz as never,
      profileRepo as never,
    );
  };

  beforeEach(() => {
    audit = { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() };
    caps = {
      [`member:${ORG_A}`]: [Capability.BenchmarkManage],
      [`viewer:${ORG_A}`]: [],
    };
    // As the real one does, getCapabilities grants a global admin the full set in any organization.
    authz = {
      getCapabilities: jest.fn(async (userId: string, roles: string[], orgId: string) =>
        roles.includes('perfana-admin') ? Object.values(Capability) : (caps[`${userId}:${orgId}`] ?? []),
      ),
    };
    build();
  });

  describe('list', () => {
    it("answers an organization's templates, in the export's order, with whether the caller may write", async () => {
      build([
        { organization_id: ORG_A, dashboard_uid: 'z', panel_id: 1, metric_classification: 'x' },
        { organization_id: ORG_A, dashboard_uid: 'a', panel_title: 'CPU', metric_classification: 'x' },
        { organization_id: ORG_A, dashboard_uid: 'a', panel_id: 9, metric_classification: 'x' },
        { organization_id: ORG_B, panel_id: 1, metric_classification: 'x' },
        { organization_id: null as never, panel_id: 1, metric_classification: 'x' },
        // classifyMetric's system-scoped rows are not templates.
        { organization_id: ORG_A, system_under_test_id: 'sut', panel_id: 1, metric_classification: 'x' },
      ]);
      const list = await service.list({ kind: 'organization', organizationId: ORG_A }, 'member', ['user'], [ORG_A]);
      expect(list).toMatchObject({ scope: 'organization', organizationId: ORG_A, canWrite: true });
      expect(list.templates.map((t) => [t.definition.dashboardUid, t.definition.panelId ?? t.definition.panelTitle])).toEqual([
        ['a', 9],
        ['a', 'CPU'],
        ['z', 1],
      ]);
    });

    it('tells a viewer it cannot write', async () => {
      const list = await service.list({ kind: 'organization', organizationId: ORG_A }, 'viewer', ['user'], [ORG_A]);
      expect(list.canWrite).toBe(false);
    });

    /**
     * Value: protects=a caller-named organization is checked against the caller's memberships, with
     *   no RLS on this table to catch it, and the refusal does not confirm the organization exists;
     * fails_when=the membership check is dropped or answers 403;
     * why_new=new endpoint; seam=service; no_claim=the RLS interceptor (unit, no database)
     */
    it("answers 404 for an organization that is not the caller's, and for one that does not exist", async () => {
      await expect(service.list({ kind: 'organization', organizationId: ORG_B }, 'member', ['user'], [ORG_A])).rejects.toThrow(NotFoundException);
      const missing = 'cccccccc-0000-4000-8000-00000000000c';
      await expect(service.list({ kind: 'organization', organizationId: missing }, 'admin', ['perfana-admin'], null)).rejects.toThrow(NotFoundException);
    });

    it('answers install-wide templates to any caller, writable only by a global admin', async () => {
      build([
        { organization_id: null as never, panel_id: 1, metric_classification: 'x' },
        { organization_id: ORG_B, panel_id: 1, metric_classification: 'x' },
      ]);
      const asNobody = await service.list({ kind: 'install' }, 'stranger', ['user'], []);
      expect(asNobody).toMatchObject({ scope: 'install', organizationId: null, canWrite: false });
      expect(asNobody.templates).toHaveLength(1);
      expect((await service.list({ kind: 'install' }, 'admin', ['perfana-admin'], null)).canWrite).toBe(true);
    });
  });

  describe('findOne', () => {
    it('hides a template of another organization and every system-scoped row', async () => {
      build([
        { id: 'aaaaaaaa-1111-4000-8000-000000000001', organization_id: ORG_B, panel_id: 1, metric_classification: 'x' },
        { id: 'aaaaaaaa-1111-4000-8000-000000000002', system_under_test_id: 'sut', panel_id: 1, metric_classification: 'x' },
        { id: 'aaaaaaaa-1111-4000-8000-000000000003', organization_id: null as never, panel_id: 1, metric_classification: 'x' },
      ]);
      await expect(service.findOne('aaaaaaaa-1111-4000-8000-000000000001', [ORG_A])).rejects.toThrow(NotFoundException);
      await expect(service.findOne('aaaaaaaa-1111-4000-8000-000000000002', null)).rejects.toThrow(NotFoundException);
      expect((await service.findOne('aaaaaaaa-1111-4000-8000-000000000003', [])).scope).toBe('install');
    });
  });

  describe('create', () => {
    it('stores the definition as the file item would be stored, owned by the UI, and audits it', async () => {
      const created = await service.create(
        { kind: 'organization', organizationId: ORG_A.toUpperCase() },
        def({ higherIsBetter: null, percentageThreshold: 0.2, aggregation: 'q95' }),
        'member',
        ['user'],
        [ORG_A],
      );
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0]).toMatchObject({
        organization_id: ORG_A, // lowercased: the key must match what Postgres returns
        dashboard_uid: 'jvm-overview',
        regex: false,
        panel_id: 7,
        metric_name: null,
        metric_classification: 'USE_saturation',
        higher_is_better: null,
        config_overrides: { higherIsBetter: null, percentageThreshold: 0.2, aggregation: 'q95' },
        read_only: false,
        created_by: 'member',
        updated_by: 'member',
      });
      expect(created).toMatchObject({
        scope: 'organization',
        organizationId: ORG_A,
        readOnly: false,
        definition: { dashboardUid: 'jvm-overview', panelId: 7, metricClassification: 'USE_saturation', higherIsBetter: null, percentageThreshold: 0.2, aggregation: 'q95' },
      });
      expect(audit.logCreate).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }), { organizationIdOverride: ORG_A });
    });

    it('takes the scope from the collection, and refuses a body that names one', async () => {
      await expect(
        service.create({ kind: 'organization', organizationId: ORG_A }, { ...def(), organizationId: ORG_B }, 'member', ['user'], [ORG_A]),
      ).rejects.toThrow(/organizationId is not part of a template definition/);
      expect(table.rows).toHaveLength(0);
    });

    it.each([
      ['a viewer', 'viewer', [ORG_A], { kind: 'organization', organizationId: ORG_A }],
      ['a member writing install-wide', 'member', [ORG_A], { kind: 'install' }],
    ] as const)('refuses %s with 403 and writes nothing', async (_label, user, orgs, scope) => {
      await expect(service.create(scope as never, def(), user, ['user'], [...orgs])).rejects.toThrow(ForbiddenException);
      expect(table.rows).toHaveLength(0);
    });

    it('lets a global admin create an install-wide template', async () => {
      const created = await service.create({ kind: 'install' }, def(), 'admin', ['perfana-admin'], null);
      expect(created).toMatchObject({ scope: 'install', organizationId: null });
      expect(audit.logCreate).toHaveBeenCalledWith(expect.anything(), { organizationIdOverride: undefined });
    });

    /**
     * Value: protects=the API holds a template to the file's own rules, so nothing it stores could
     *   fail to provision back or be stored differently from the item that describes it;
     * fails_when=the service validates on its own instead of through parseTemplateItem;
     * why_new=new endpoint; seam=service; no_claim=class-validator's decorators (exercised end to end)
     */
    it.each([
      ['no panel at all', { panelId: undefined }, /panelId or panelTitle is required/],
      ['a percentage written as a percent', { percentageThreshold: 15 }, /fraction/],
      ['an unsafe regex', { dashboardUid: '(a+)+$', regex: true }, /not a usable regular expression/],
      ['a null aggregation', { aggregation: null as never }, /aggregation must be one of/],
      ['an empty dashboard uid', { dashboardUid: '' }, /dashboardUid must be a non-empty string/],
      // The global ValidationPipe would strip it silently; the controller passes the body raw so the
      // codec sees it, and a template that would force nothing is refused with the codec's hint.
      ['a misspelt field', { absoluteThreshold: 5 } as never, /unknown field "absoluteThreshold" ignored \(did you mean "absThreshold"\?\)/],
      ['a value too long for its column', { dashboardUid: 'x'.repeat(256) }, /dashboardUid must be shorter than or equal to 255 characters/],
      ['a string where a number belongs', { panelId: '7' as never }, /panelId must be an integer number/],
    ])('refuses %s with 400', async (_label, over, message) => {
      const attempt = service.create({ kind: 'organization', organizationId: ORG_A }, def(over), 'member', ['user'], [ORG_A]);
      await expect(attempt).rejects.toThrow(BadRequestException);
      await expect(
        service.create({ kind: 'organization', organizationId: ORG_A }, def(over), 'member', ['user'], [ORG_A]),
      ).rejects.toThrow(message);
      expect(table.rows).toHaveLength(0);
    });

    it.each([[null], [[def()]], ['panelId: 7']])('refuses a body that is not one object: %p', async (body) => {
      await expect(service.create({ kind: 'install' }, body, 'admin', ['perfana-admin'], null)).rejects.toThrow(BadRequestException);
    });

    it('refuses a key the scope already holds with a 409 naming the scope, the key and a provisioned holder', async () => {
      build([{ organization_id: ORG_A, dashboard_uid: 'jvm-overview', panel_id: 7, panel_title: 'Heap', metric_classification: 'x', read_only: true }]);
      // A different descriptive title beside the same panel id is the same template.
      const attempt = service.create({ kind: 'organization', organizationId: ORG_A }, def({ panelTitle: 'Heap used' }), 'member', ['user'], [ORG_A]);
      await expect(attempt).rejects.toThrow(ConflictException);
      await expect(
        service.create({ kind: 'organization', organizationId: ORG_A }, def(), 'member', ['user'], [ORG_A]),
      ).rejects.toThrow('There is already a template for dashboard "jvm-overview", panel 7 in organization "Acme", provisioned from template_ds_compare_configs.yaml');
    });

    it('allows the same key in another scope, which is how a provisioned template is copied to edit', async () => {
      build([{ organization_id: null as never, dashboard_uid: 'jvm-overview', panel_id: 7, metric_classification: 'x', read_only: true }]);
      await service.create({ kind: 'organization', organizationId: ORG_A }, def(), 'member', ['user'], [ORG_A]);
      expect(table.rows).toHaveLength(2);
    });

    it('maps a unique violation that loses a race to the pre-check onto a 409', async () => {
      build([{ organization_id: ORG_A, dashboard_uid: 'jvm-overview', panel_id: 7, metric_classification: 'x' }]);
      table.repo.find.mockResolvedValueOnce([]); // the pre-check read before the other writer committed
      await expect(
        service.create({ kind: 'organization', organizationId: ORG_A }, def(), 'member', ['user'], [ORG_A]),
      ).rejects.toThrow(new ConflictException('There is already a template for dashboard "jvm-overview", panel 7 in organization "Acme".'));
      expect(audit.logCreate).not.toHaveBeenCalled();
    });

    it('rethrows any other database error untouched', async () => {
      table.repo.save.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '23505', constraint: 'some_other_index' }));
      await expect(
        service.create({ kind: 'organization', organizationId: ORG_A }, def(), 'member', ['user'], [ORG_A]),
      ).rejects.toThrow('boom');
    });
  });

  describe('update', () => {
    const ID = 'dddddddd-0000-4000-8000-000000000001';
    const stored = (over: Partial<ProvisionedTemplateDsCompareConfig> = {}) => ({
      id: ID,
      organization_id: ORG_A,
      dashboard_uid: 'jvm-overview',
      panel_id: 7,
      metric_classification: 'USE_saturation',
      higher_is_better: false,
      config_overrides: { higherIsBetter: false, absThreshold: 5 },
      created_by: 'someone',
      ...over,
    });

    it('replaces the definition wholesale, so an override left out stops being forced', async () => {
      build([stored()]);
      const updated = await service.update(ID, def({ aggregation: 'median' }), 'member', ['user'], [ORG_A]);
      expect(table.rows[0]).toMatchObject({
        config_overrides: { aggregation: 'median' },
        higher_is_better: null, // the column follows the override, as provisioning writes it
        updated_by: 'member',
        created_by: 'someone',
        read_only: false,
      });
      expect(updated.definition).toEqual({ dashboardUid: 'jvm-overview', panelId: 7, metricClassification: 'USE_saturation', aggregation: 'median' });
      expect(audit.logUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ config_overrides: { higherIsBetter: false, absThreshold: 5 } }),
        expect.objectContaining({ config_overrides: { aggregation: 'median' } }),
        { organizationIdOverride: ORG_A },
      );
    });

    it('cannot be moved to another scope', async () => {
      build([stored()]);
      await expect(service.update(ID, { ...def(), organizationId: null }, 'member', ['user'], [ORG_A])).rejects.toThrow(BadRequestException);
      expect(table.rows[0]!.organization_id).toBe(ORG_A);
    });

    it('refuses a provisioned template with 409, and a viewer with 403 before that', async () => {
      build([stored({ read_only: true })]);
      await expect(service.update(ID, def(), 'member', ['user'], [ORG_A])).rejects.toThrow(/provisioned from template_ds_compare_configs.yaml/);
      await expect(service.update(ID, def(), 'viewer', ['user'], [ORG_A])).rejects.toThrow(ForbiddenException);
      expect(table.rows[0]!.config_overrides).toEqual({ higherIsBetter: false, absThreshold: 5 });
    });

    it("answers 404 for another organization's template", async () => {
      build([stored({ organization_id: ORG_B })]);
      await expect(service.update(ID, def(), 'member', ['user'], [ORG_A])).rejects.toThrow(NotFoundException);
    });

    it('keeps its own key without colliding with itself, and refuses moving onto a sibling key', async () => {
      build([stored(), { organization_id: ORG_A, dashboard_uid: 'jvm-overview', panel_id: 8, metric_classification: 'x' }]);
      await service.update(ID, def({ dashboardLabel: 'JVM' }), 'member', ['user'], [ORG_A]);
      await expect(service.update(ID, def({ panelId: 8 }), 'member', ['user'], [ORG_A])).rejects.toThrow(ConflictException);
      expect(table.rows[0]).toMatchObject({ panel_id: 7, dashboard_label: 'JVM' });
    });
  });

  describe('remove', () => {
    const ID = 'eeeeeeee-0000-4000-8000-000000000001';

    it('deletes a UI template and audits it', async () => {
      build([{ id: ID, organization_id: ORG_A, panel_id: 1, metric_classification: 'x' }]);
      await service.remove(ID, 'member', ['user'], [ORG_A]);
      expect(table.rows).toHaveLength(0);
      expect(audit.logDelete).toHaveBeenCalledWith(expect.objectContaining({ id: ID }), { organizationIdOverride: ORG_A });
    });

    it('refuses a provisioned template, and an install-wide one for anyone but a global admin', async () => {
      build([{ id: ID, organization_id: null as never, panel_id: 1, metric_classification: 'x', read_only: true }]);
      await expect(service.remove(ID, 'member', ['user'], [ORG_A])).rejects.toThrow(ForbiddenException);
      await expect(service.remove(ID, 'admin', ['perfana-admin'], null)).rejects.toThrow(ConflictException);
      expect(table.rows).toHaveLength(1);
      expect(audit.logDelete).not.toHaveBeenCalled();
    });
  });

  describe('exportYaml', () => {
    it('refuses anyone but a global admin', async () => {
      await expect(service.exportYaml([ORG_A])).rejects.toThrow(ForbiddenException);
    });

    it('writes every template of every scope, provisioned or not, and no system-scoped row', async () => {
      build([
        { organization_id: ORG_A, panel_id: 1, metric_classification: 'RED_rate', read_only: false },
        { organization_id: null as never, panel_id: 1, metric_classification: 'RED_rate', read_only: true },
        { organization_id: ORG_A, system_under_test_id: 'sut', panel_id: 2, metric_classification: 'RED_rate' },
      ]);
      expect(await service.exportYaml(null)).toBe(
        [
          'items:',
          '  - organizationId: null',
          '    panelId: 1',
          '    metricClassification: RED_rate',
          `  - organizationId: ${ORG_A}`,
          '    panelId: 1',
          '    metricClassification: RED_rate',
          '',
        ].join('\n'),
      );
    });
  });

  /**
   * Value:
   *   protects — the design's round trip: templates created in the UI export to a file that, once
   *     committed and booted, is taken over with identical content, and every later boot is a no-op.
   *   fails_when — the API stores a template differently from how provisioning stores the item that
   *     describes it, or the exporter drops a field the API accepts (mutation-checked by removing
   *     `dashboardLabel`, `metricName` or `regex` from rowToItem: each fails the content comparison,
   *     which the takeover count alone does not see).
   *   why_new — the create path and the export route are new; PR 1 only round-tripped YAML to YAML.
   *   seam — both real services over one in-memory table; no_claim — Postgres itself.
   */
  /**
   * Profile templates (`/profiles/:id/compare-templates`). Their organization is the profile's, read
   * from the profile on every request, and they are a scope of their own: never listed or keyed with
   * their organization's templates.
   */
  describe('profile scope', () => {
    const profileTemplate = (id: string, profileId: string, over: Partial<ProvisionedTemplateDsCompareConfig> = {}) => ({
      id, profile_id: profileId, organization_id: PROFILES[profileId]!.organizationId, dashboard_uid: 'jvm-overview',
      panel_id: 7, metric_classification: 'x', ...over,
    });

    it("lists only the profile's templates, and an organization's list leaves its profiles' out", async () => {
      build([
        profileTemplate('11111111-0000-4000-8000-000000000001', P_JVM),
        profileTemplate('11111111-0000-4000-8000-000000000002', P_DOTNET),
        { organization_id: ORG_A, panel_id: 7, metric_classification: 'x' },
      ]);
      const list = await service.list({ kind: 'profile', profileId: P_JVM }, 'member', ['user'], [ORG_A]);
      expect(list).toMatchObject({ scope: 'profile', organizationId: ORG_A, profileId: P_JVM, profileName: 'jvm', canWrite: true });
      expect(list.templates.map((t) => t.id)).toEqual(['11111111-0000-4000-8000-000000000001']);
      expect(list.templates[0]).toMatchObject({ scope: 'profile', profileId: P_JVM, profileName: 'jvm' });
      expect(list.templates[0]!.definition).not.toHaveProperty('profile');

      const org = await service.list({ kind: 'organization', organizationId: ORG_A }, 'member', ['user'], [ORG_A]);
      expect(org.templates).toHaveLength(1);
      expect(org.templates[0]!.scope).toBe('organization');
    });

    it("answers 404 for a profile outside the caller's organizations, and for one that does not exist", async () => {
      await expect(service.list({ kind: 'profile', profileId: P_OTHER }, 'member', ['user'], [ORG_A])).rejects.toThrow(NotFoundException);
      await expect(service.list({ kind: 'profile', profileId: 'cccccccc-0000-4000-8000-00000000000c' }, 'admin', ['perfana-admin'], null))
        .rejects.toThrow(NotFoundException);
    });

    it("creates under a provisioned profile, stores the profile and its organization, and audits in that organization", async () => {
      const created = await service.create({ kind: 'profile', profileId: P_JVM }, def({ absThreshold: 3 }), 'member', ['user'], [ORG_A]);
      expect(created).toMatchObject({ scope: 'profile', profileId: P_JVM, organizationId: ORG_A, readOnly: false });
      expect(table.rows[0]).toMatchObject({ profile_id: P_JVM, organization_id: ORG_A, config_overrides: { absThreshold: 3 } });
      expect(audit.logCreate).toHaveBeenCalledWith(expect.anything(), { organizationIdOverride: ORG_A });
    });

    it("needs benchmark:manage in the profile's organization", async () => {
      await expect(service.create({ kind: 'profile', profileId: P_JVM }, def(), 'viewer', ['user'], [ORG_A])).rejects.toThrow(ForbiddenException);
    });

    it('refuses a body that names a profile or an organization: the route is the scope', async () => {
      await expect(service.create({ kind: 'profile', profileId: P_JVM }, { ...def(), profile: 'dotnet' }, 'member', ['user'], [ORG_A]))
        .rejects.toThrow(/profile is not part of a template definition/);
      await expect(service.create({ kind: 'profile', profileId: P_JVM }, { ...def(), organizationId: ORG_A }, 'member', ['user'], [ORG_A]))
        .rejects.toThrow(BadRequestException);
    });

    it("keys a profile's templates apart from its organization's and its sibling profiles'", async () => {
      build([{ organization_id: ORG_A, dashboard_uid: 'jvm-overview', panel_id: 7, metric_classification: 'x' }]);
      await service.create({ kind: 'profile', profileId: P_JVM }, def(), 'member', ['user'], [ORG_A]);
      await service.create({ kind: 'profile', profileId: P_DOTNET }, def(), 'member', ['user'], [ORG_A]);
      await expect(service.create({ kind: 'profile', profileId: P_JVM }, def(), 'member', ['user'], [ORG_A]))
        .rejects.toThrow(/already a template for dashboard "jvm-overview", panel 7 in profile "jvm"/);
    });

    it("authorizes through the profile's current organization, not the stale copy on the row", async () => {
      const id = '11111111-0000-4000-8000-000000000009';
      // The row says ORG_B (the profile used to be there); the profile is in ORG_A now.
      build([profileTemplate(id, P_JVM, { organization_id: ORG_B })]);
      await expect(service.findOne(id, [ORG_A])).resolves.toMatchObject({ organizationId: ORG_A, profileName: 'jvm' });
      await expect(service.findOne(id, [ORG_B])).rejects.toThrow(NotFoundException);
    });

    it("answers 404 when the route's profile is not the template's", async () => {
      const id = '11111111-0000-4000-8000-000000000003';
      build([profileTemplate(id, P_JVM), { id: '11111111-0000-4000-8000-000000000004', organization_id: ORG_A, panel_id: 1, metric_classification: 'x' }]);
      await expect(service.findOne(id, [ORG_A], P_DOTNET)).rejects.toThrow(NotFoundException);
      await expect(service.update(id, def(), 'member', ['user'], [ORG_A], P_DOTNET)).rejects.toThrow(NotFoundException);
      await expect(service.remove(id, 'member', ['user'], [ORG_A], P_DOTNET)).rejects.toThrow(NotFoundException);
      // An organization template is not any profile's.
      await expect(service.remove('11111111-0000-4000-8000-000000000004', 'member', ['user'], [ORG_A], P_JVM)).rejects.toThrow(NotFoundException);
      await service.remove(id, 'member', ['user'], [ORG_A], P_JVM);
      expect(table.rows.map((r) => r.id)).toEqual(['11111111-0000-4000-8000-000000000004']);
    });

    it('updates in place, keeping the profile, and refuses a provisioned profile template with 409', async () => {
      const id = '11111111-0000-4000-8000-000000000005';
      build([profileTemplate(id, P_JVM), profileTemplate('11111111-0000-4000-8000-000000000006', P_JVM, { panel_id: 8, read_only: true })]);
      const updated = await service.update(id, def({ iqrThreshold: 3 }), 'member', ['user'], [ORG_A], P_JVM);
      expect(updated).toMatchObject({ profileId: P_JVM, definition: { iqrThreshold: 3 } });
      expect(table.rows[0]).toMatchObject({ profile_id: P_JVM, organization_id: ORG_A });
      await expect(service.update('11111111-0000-4000-8000-000000000006', def({ panelId: 8 }), 'member', ['user'], [ORG_A], P_JVM))
        .rejects.toThrow(ConflictException);
    });

    it("counts a profile's templates, provisioned ones included, for the delete confirmation", async () => {
      build([
        profileTemplate('11111111-0000-4000-8000-000000000007', P_JVM, { read_only: true }),
        profileTemplate('11111111-0000-4000-8000-000000000008', P_JVM, { panel_id: 8 }),
        profileTemplate('11111111-0000-4000-8000-000000000010', P_DOTNET),
      ]);
      expect(await service.countForProfile(P_JVM)).toBe(2);
    });

    it('exports profile templates after organizations, by profile name, naming the profile and no organization', async () => {
      build([
        profileTemplate('11111111-0000-4000-8000-000000000011', P_JVM),
        profileTemplate('11111111-0000-4000-8000-000000000012', P_DOTNET),
        { organization_id: ORG_B, panel_id: 1, metric_classification: 'x' },
      ]);
      expect(await service.exportYaml(null)).toBe(
        [
          'items:',
          `  - organizationId: ${ORG_B}`,
          '    panelId: 1',
          '    metricClassification: x',
          '  - profile: dotnet',
          '    dashboardUid: jvm-overview',
          '    panelId: 7',
          '    metricClassification: x',
          '  - profile: jvm',
          '    dashboardUid: jvm-overview',
          '    panelId: 7',
          '    metricClassification: x',
          '',
        ].join('\n'),
      );
    });
  });

  describe('round trip: create in the UI, export, commit, boot', () => {
    it('takes every UI template over unchanged, then reports nothing to do', async () => {
      const provisioning = new ProvisioningService(
        {} as never,
        profileRepo as never,
        {} as never,
        {} as never,
        table.repo as never,
        { createQueryRunner: () => ({ connect: jest.fn(), release: jest.fn(), query: jest.fn(async () => [{ locked: true }]) }) } as never,
      );
      const asAdmin = ['admin', ['perfana-admin'], null] as const;
      await service.create({ kind: 'install' }, def({ dashboardUid: '^dynatrace-', regex: true, panelId: undefined, panelTitle: 'CPU.*', metricClassification: 'USE_utilization', absThreshold: null }), ...asAdmin);
      await service.create({ kind: 'install' }, def({ panelId: 201, dashboardUid: undefined, metricClassification: 'RED_rate', higherIsBetter: null, percentageThreshold: 0.15 }), ...asAdmin);
      await service.create(
        { kind: 'organization', organizationId: ORG_A },
        def({
          dashboardLabel: 'JVM', panelTitle: 'Heap', metricName: 'heap used', higherIsBetter: true, ignore: false,
          ignoreMeanDiffSmallerThan: 0, iqrThreshold: 2, aggregation: 'q95', minSampleCount: 3, defaultValueIfControlGroupMissing: 0,
        }),
        ...asAdmin,
      );
      await service.create({ kind: 'organization', organizationId: ORG_B }, def(), ...asAdmin);
      await service.create({ kind: 'profile', profileId: P_OTHER }, def({ absThreshold: 7 }), ...asAdmin);

      // Every column the file decides, per row. Takeover is counted whatever it writes, so the
      // content has to be compared, not just the counts.
      const decided = () =>
        Object.fromEntries(
          table.rows.map((r) => [
            r.id,
            {
              organization_id: r.organization_id, profile_id: r.profile_id, dashboard_uid: r.dashboard_uid, regex: r.regex,
              dashboard_label: r.dashboard_label, panel_id: r.panel_id, panel_title: r.panel_title,
              metric_name: r.metric_name, metric_classification: r.metric_classification,
              higher_is_better: r.higher_is_better, config_overrides: r.config_overrides,
            },
          ]),
        );
      const before = decided();

      const file = await service.exportYaml(null);
      const { organizationId, items } = yaml.load(file) as { organizationId?: string; items: unknown[] };

      const SUMMARY = { created: 0, updated: 0, unchanged: 0, takenOver: 0, pruned: 0, skipped: 0, errors: 0 };
      expect(await provisioning.provisionMetricClassifications(items, organizationId ?? null)).toEqual({ ...SUMMARY, takenOver: 5 });
      expect(table.rows.every((r) => r.read_only === true && r.updated_by === 'system:provisioning')).toBe(true);
      expect(decided()).toEqual(before);

      expect(await provisioning.provisionMetricClassifications(items, organizationId ?? null)).toEqual({ ...SUMMARY, unchanged: 5 });
      expect(await service.exportYaml(null)).toBe(file);

      // ...and the rows are now owned by the file.
      const list = await service.list({ kind: 'install' }, 'admin', ['perfana-admin'], null);
      expect(list.templates.map((t) => t.readOnly)).toEqual([true, true]);
    });
  });
});

describe('isDuplicateTemplateKey', () => {
  it('recognises the template key index on the error or on its driver error, and nothing else', () => {
    expect(isDuplicateTemplateKey(duplicateKey())).toBe(true);
    expect(isDuplicateTemplateKey({ driverError: { code: '23505', constraint: 'uq_provisioned_template_ds_compare_configs_key' } })).toBe(true);
    expect(isDuplicateTemplateKey({ code: '23505', constraint: 'other' })).toBe(false);
    expect(isDuplicateTemplateKey(null)).toBe(false);
  });
});

describe('describeTemplateKey', () => {
  it.each([
    [{ panel_id: 5 }, 'every dashboard, panel 5'],
    [{ dashboard_uid: '^jvm-', regex: true, panel_title: 'Heap.*' }, 'dashboard matching "^jvm-", panel titles matching "Heap.*"'],
    [{ dashboard_uid: 'jvm', panel_title: 'Heap', metric_name: 'used' }, 'dashboard "jvm", panel titled "Heap", metric "used"'],
  ])('reads %p as %p', (key, text) => {
    expect(describeTemplateKey(key)).toBe(text);
  });
});
