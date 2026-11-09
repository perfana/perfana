import { BadRequestException } from '@nestjs/common';
import { IS_ADMIN_ONLY_KEY } from '../../decorators/admin-only.decorator';
import {
  CompareTemplatesController,
  parseTemplateScope,
  ProfileCompareTemplatesController,
  ProvisioningExportController,
} from './compare-templates.controller';

jest.mock('../../common/utils/with-org-filter', () => ({ withOrgFilter: jest.fn() }));
import { withOrgFilter } from '../../common/utils/with-org-filter';

const ORG = 'aaaaaaaa-0000-4000-8000-00000000000a';

describe('parseTemplateScope', () => {
  it.each([
    [ORG, undefined, { kind: 'organization', organizationId: ORG }],
    [ORG, 'organization', { kind: 'organization', organizationId: ORG }],
    [undefined, 'install', { kind: 'install' }],
    ['', 'install', { kind: 'install' }],
  ])('reads organizationId=%p scope=%p', (organizationId, scope, expected) => {
    expect(parseTemplateScope(organizationId, scope)).toEqual(expected);
  });

  /**
   * Value: protects=a request that forgets its scope is refused, never read as install-wide;
   * fails_when=a missing parameter defaults to one scope; why_new=new endpoint; seam=none
   */
  it.each([
    [undefined, undefined],
    [ORG, 'install'],
    [undefined, 'organization'],
    ['acme', undefined],
    [undefined, 'everything'],
  ])('refuses organizationId=%p scope=%p with 400', (organizationId, scope) => {
    expect(() => parseTemplateScope(organizationId, scope)).toThrow(BadRequestException);
  });
});

/**
 * Every route resolves the caller's organizations ONCE and hands them to the service, which treats
 * that argument as the tenant boundary (root CLAUDE.md #48). This table has no RLS behind it.
 */
describe('CompareTemplatesController', () => {
  const ctx = { userId: 'user-1', roles: ['user'] } as never;
  const authz = {} as never;
  let service: Record<string, jest.Mock>;
  let controller: CompareTemplatesController;

  beforeEach(() => {
    (withOrgFilter as jest.Mock).mockReset().mockResolvedValue([ORG]);
    service = {
      list: jest.fn(async () => ({})),
      findOne: jest.fn(async () => ({})),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      remove: jest.fn(async () => undefined),
    };
    controller = new CompareTemplatesController(service as never, authz);
  });

  it.each([
    ['list', (c: CompareTemplatesController) => c.list(ctx, ORG), 'list', [{ kind: 'organization', organizationId: ORG }, 'user-1', ['user'], [ORG]]],
    ['findOne', (c: CompareTemplatesController) => c.findOne('t-1', ctx), 'findOne', ['t-1', [ORG]]],
    ['create', (c: CompareTemplatesController) => c.create({} as never, ctx, undefined, 'install'), 'create', [{ kind: 'install' }, {}, 'user-1', ['user'], [ORG]]],
    ['update', (c: CompareTemplatesController) => c.update('t-1', {} as never, ctx), 'update', ['t-1', {}, 'user-1', ['user'], [ORG]]],
    ['remove', (c: CompareTemplatesController) => c.remove('t-1', ctx), 'remove', ['t-1', 'user-1', ['user'], [ORG]]],
  ] as const)('%s passes the resolved scope', async (_name, call, method, args) => {
    await call(controller);
    expect(withOrgFilter).toHaveBeenCalledWith('user-1', ['user'], authz);
    expect(withOrgFilter).toHaveBeenCalledTimes(1);
    expect(service[method]).toHaveBeenCalledWith(...args);
  });

  /**
   * Value: protects=a misspelt override reaches the codec and is refused, instead of being stripped by
   *   the global ValidationPipe's whitelist and stored as a template that forces nothing;
   * fails_when=the body parameter is typed as the DTO again (the pipe then validates and whitelists it);
   * why_new=observed on the local stack, where `absoluteThreshold` was answered with a 201;
   * seam=reflected parameter types, which is what the pipe keys on; no_claim=the pipe itself
   */
  it.each(['create', 'update'] as const)('hands the %s body to the service unvalidated by the global pipe', (method) => {
    const types: unknown[] = Reflect.getMetadata('design:paramtypes', CompareTemplatesController.prototype, method);
    const bodyIndex = method === 'create' ? 0 : 1;
    expect(types[bodyIndex]).toBe(Object);
  });

  it('refuses a create with no scope before reaching the service', async () => {
    await expect(controller.create({} as never, ctx)).rejects.toThrow(BadRequestException);
    expect(service.create).not.toHaveBeenCalled();
  });
});

describe('ProfileCompareTemplatesController', () => {
  const ctx = { userId: 'user-1', roles: ['user'] } as never;
  const authz = {} as never;
  const PROFILE = 'dddddddd-0000-4000-8000-00000000000d';
  let service: Record<string, jest.Mock>;
  let controller: ProfileCompareTemplatesController;

  beforeEach(() => {
    (withOrgFilter as jest.Mock).mockReset().mockResolvedValue([ORG]);
    service = {
      list: jest.fn(async () => ({})),
      findOne: jest.fn(async () => ({})),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      remove: jest.fn(async () => undefined),
    };
    controller = new ProfileCompareTemplatesController(service as never, authz);
  });

  it.each([
    ['list', (c: ProfileCompareTemplatesController) => c.list(PROFILE, ctx), 'list', [{ kind: 'profile', profileId: PROFILE }, 'user-1', ['user'], [ORG]]],
    ['findOne', (c: ProfileCompareTemplatesController) => c.findOne(PROFILE, 't-1', ctx), 'findOne', ['t-1', [ORG], PROFILE]],
    ['create', (c: ProfileCompareTemplatesController) => c.create(PROFILE, {} as never, ctx), 'create', [{ kind: 'profile', profileId: PROFILE }, {}, 'user-1', ['user'], [ORG]]],
    ['update', (c: ProfileCompareTemplatesController) => c.update(PROFILE, 't-1', {} as never, ctx), 'update', ['t-1', {}, 'user-1', ['user'], [ORG], PROFILE]],
    ['remove', (c: ProfileCompareTemplatesController) => c.remove(PROFILE, 't-1', ctx), 'remove', ['t-1', 'user-1', ['user'], [ORG], PROFILE]],
  ] as const)('%s passes the profile and the resolved organizations', async (_name, call, method, args) => {
    await call(controller);
    expect(withOrgFilter).toHaveBeenCalledTimes(1);
    expect(service[method]).toHaveBeenCalledWith(...args);
  });

  /** Same guard as /compare-templates: a DTO-typed body would be whitelisted by the global pipe. */
  it.each([['create', 1], ['update', 2]] as const)('hands the %s body to the service unvalidated by the global pipe', (method, bodyIndex) => {
    const types: unknown[] = Reflect.getMetadata('design:paramtypes', ProfileCompareTemplatesController.prototype, method);
    expect(types[bodyIndex]).toBe(Object);
  });
});

describe('ProvisioningExportController', () => {
  it('is admin-only at the guard, and passes the resolved scope so the service checks again', async () => {
    expect(Reflect.getMetadata(IS_ADMIN_ONLY_KEY, ProvisioningExportController.prototype.export)).toBe(true);
    (withOrgFilter as jest.Mock).mockReset().mockResolvedValue(null);
    const service = { exportYaml: jest.fn(async () => 'items: []\n') };
    const controller = new ProvisioningExportController(service as never, {} as never);
    expect(await controller.export({ userId: 'admin', roles: ['perfana-admin'] } as never)).toBe('items: []\n');
    expect(service.exportYaml).toHaveBeenCalledWith(null);
  });
});
