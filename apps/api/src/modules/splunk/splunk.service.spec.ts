import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SplunkService } from './splunk.service';
import { Capability } from '../../constants/capabilities.constants';

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const SUT = '11111111-1111-1111-1111-111111111111';
const CFG = '22222222-2222-2222-2222-222222222222';

function repo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'new-id', createdAt: new Date(), updatedAt: new Date(), ...x })),
    findOne: jest.fn(),
    find: jest.fn(async () => []),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
    target: 'x',
  };
}

function build(opts: { canModify?: boolean; canAccess?: boolean; caps?: string[] } = {}) {
  const configRepo = repo();
  const mappingRepo = repo();
  const queryRepo = repo();
  const sutRepo = repo();
  const authz = {
    getAccessibleOrganizations: jest.fn(async () => [ORG_A]),
    getCapabilities: jest.fn(async () => opts.caps ?? Object.values(Capability)),
    canAccessResource: jest.fn(async () => ({ allowed: opts.canAccess ?? true })),
    canModifyResource: jest.fn(async () => ({ allowed: opts.canModify ?? true })),
  };
  const audit = { logCreate: jest.fn(), logUpdate: jest.fn(), logDelete: jest.fn() };
  const proxy = { resolve: jest.fn(async () => null) };
  const service = new SplunkService(
    configRepo as never, mappingRepo as never, queryRepo as never, sutRepo as never,
    authz as never, audit as never, proxy as never,
  );
  sutRepo.findOne.mockResolvedValue({ id: SUT, organization_id: ORG_A, team_id: null });
  configRepo.findOne.mockResolvedValue({ id: CFG, organizationId: ORG_A, host: 'https://splunk.example.com:8089', apiToken: 't' });
  return { service, configRepo, mappingRepo, queryRepo, sutRepo, authz, audit };
}

const baseConfig = { label: 'prod', host: 'https://splunk.example.com:8089', apiToken: 'secret' };

describe('SplunkService configs', () => {
  it('masks credentials in every response', async () => {
    const { service } = build();
    const created = await service.createConfig({ ...baseConfig, password: 'pw', username: 'u' }, 'user', []);
    expect(created.apiToken).toBe('[MASKED]');
    expect(created.password).toBe('[MASKED]');
  });

  it('checks the capability in the organization the body names (RLS does not)', async () => {
    const { service, authz } = build({ caps: [] });
    await expect(service.createConfig({ ...baseConfig, organizationId: ORG_B }, 'user', [])).rejects.toBeInstanceOf(ForbiddenException);
    expect(authz.getCapabilities).toHaveBeenCalledWith('user', [], ORG_B);
  });

  it('refuses Splunk Web on port 8000 and a connection with no credentials', async () => {
    const { service } = build();
    await expect(service.createConfig({ ...baseConfig, host: 'https://splunk.example.com:8000' }, 'u', [])).rejects.toThrow('management port');
    await expect(service.createConfig({ label: 'x', host: 'https://splunk.example.com:8089' }, 'u', [])).rejects.toThrow('token');
  });

  it('leaves a credential alone when the client echoes the mask back', async () => {
    const { service, configRepo } = build();
    configRepo.findOne.mockResolvedValue({ id: CFG, organizationId: ORG_A, host: 'https://s:8089', apiToken: 'keep-me', label: 'x' });
    await service.updateConfig(CFG, { apiToken: '[MASKED]', label: 'renamed' }, 'u', []);
    expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({ apiToken: 'keep-me', label: 'renamed' }));
  });

  it('answers 404, not 403, for a connection outside the caller organizations', async () => {
    const { service } = build({ canAccess: false });
    await expect(service.getConfig(CFG, 'u', [])).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SplunkService mappings and queries', () => {
  it('refuses to point a system at another organization\'s Splunk connection', async () => {
    const { service, configRepo } = build();
    configRepo.findOne.mockResolvedValue({ id: CFG, organizationId: ORG_B, host: 'https://s:8089', apiToken: 't' });
    await expect(
      service.createMapping({ splunkConfigId: CFG, systemUnderTestId: SUT, level: 'sut', indexName: 'web' }, 'u', []),
    ).rejects.toThrow('another organization');
  });

  it('inherits the organization from the system and nulls the scope a level does not use', async () => {
    const { service, mappingRepo } = build();
    await service.createMapping(
      { splunkConfigId: CFG, systemUnderTestId: SUT, level: 'environment', testEnvironment: 'acc', workload: 'ignored', indexName: ' web ' },
      'u', [],
    );
    expect(mappingRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_A, testEnvironment: 'acc', workload: null, indexName: 'web' }),
    );
  });

  it('requires the environment for an environment-level mapping', async () => {
    const { service } = build();
    await expect(
      service.createMapping({ splunkConfigId: CFG, systemUnderTestId: SUT, level: 'environment', indexName: 'web' }, 'u', []),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is a 403 for a system the caller can read but not change', async () => {
    const { service } = build({ canModify: false, canAccess: true });
    await expect(
      service.createMapping({ splunkConfigId: CFG, systemUnderTestId: SUT, level: 'sut', indexName: 'web' }, 'u', []),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['index=x | timechart count', 'timechart'],
    ['index=x earliest=-1h', 'earliest'],
    ['index=x | outputlookup foo', 'outputlookup'],
  ])('rejects SPL that Perfana owns or that writes: %s', async (spl, word) => {
    const { service } = build();
    await expect(
      service.createQuery({ splunkConfigId: CFG, systemUnderTestId: SUT, testEnvironment: 'acc', workload: 'load', panelTitle: 'p', panelId: 1, spl }, 'u', []),
    ).rejects.toThrow(word);
  });
});
