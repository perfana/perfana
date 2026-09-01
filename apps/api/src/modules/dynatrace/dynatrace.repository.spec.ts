import { DynatraceRepository } from './dynatrace.repository';

/**
 * Regression tests for the ds_compare_config INSERT gaining organization_id
 * (NOT NULL under RLS — a NULL row is invisible to every non-admin).
 * The org is resolved in SQL from the parent application_dashboards row, so
 * the parameter list must stay at 6 while the column list has 7 entries.
 */
describe('DynatraceRepository — createDsCompareConfigForMetric', () => {
  let manager: { query: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let repository: DynatraceRepository;

  const stubRepo = () => ({}) as never;

  beforeEach(() => {
    manager = { query: jest.fn().mockResolvedValue([]) };
    dataSource = {
      transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) => fn(manager)),
    };
    repository = new DynatraceRepository(
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      dataSource as never,
    );
  });

  it('inserts with organization_id resolved from the application dashboard', async () => {
    manager.query.mockResolvedValueOnce([]); // existence check: no config yet

    await repository.createDsCompareConfigForMetric(
      'sut-1',
      'production',
      'loadTest',
      'ad-1',
      42,
      'CPU usage',
      'builtin:host.cpu.usage',
    );

    expect(manager.query).toHaveBeenCalledTimes(2);
    const [sql, params] = manager.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO ds_compare_config');
    expect(sql).toContain('organization_id');
    // org comes from the dashboard row via subquery, not a (missing) parameter
    expect(sql).toContain('(SELECT organization_id FROM application_dashboards WHERE id = $4)');
    expect(params).toHaveLength(6);
    // placeholder/param drift guard: distinct placeholders must match the param list
    const distinctPlaceholders = new Set(sql.match(/\$\d+/g) as string[]).size;
    expect(distinctPlaceholders).toBe(6);
  });

  it('does not insert when the config already exists', async () => {
    manager.query.mockResolvedValueOnce([{ id: 'existing' }]);

    await repository.createDsCompareConfigForMetric(
      'sut-1',
      'production',
      'loadTest',
      'ad-1',
      42,
      'CPU usage',
      'builtin:host.cpu.usage',
    );

    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(manager.query.mock.calls[0][0]).toContain('SELECT id FROM ds_compare_config');
  });
});

/**
 * `client_url` (the repository's snake_case input) must be mapped onto the
 * entity's camelCase `clientUrl` property. TypeORM silently drops unknown
 * properties, so a snake_case key here would compile, run, and persist nothing —
 * the field would just never save, with no error anywhere.
 *
 * `withRequestEm` returns the repository unchanged when no request-scoped
 * EntityManager is bound, so a plain mock repo is enough here.
 */
describe('DynatraceRepository — clientUrl column mapping', () => {
  let configRepo: { create: jest.Mock; save: jest.Mock; update: jest.Mock; findOne: jest.Mock };
  let repository: DynatraceRepository;

  const stubRepo = () => ({}) as never;

  beforeEach(() => {
    configRepo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue({ id: 'config-1' }),
    };
    repository = new DynatraceRepository(
      configRepo as never,
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      stubRepo(),
      { transaction: jest.fn() } as never,
    );
  });

  it('create() maps client_url onto the camelCase clientUrl property', async () => {
    await repository.create({
      host: 'https://example.live.dynatrace.com',
      client_url: 'https://dynatrace.example.com',
      api_token: 'dt0c01.test',
      label: 'Production',
    });

    const created = configRepo.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(created.clientUrl).toBe('https://dynatrace.example.com');
    // The snake_case key must NOT survive — TypeORM would drop it without a word
    expect(created).not.toHaveProperty('client_url');
  });

  it('update() normalises an empty string to NULL, so the field has one unset value', async () => {
    await repository.update('config-1', { client_url: '' });

    const [, updateData] = configRepo.update.mock.calls[0] as [string, Record<string, unknown>];
    expect(updateData).toHaveProperty('clientUrl', null);
  });

  it('update() omits clientUrl entirely when the caller did not send one', async () => {
    await repository.update('config-1', { label: 'Renamed' });

    const [, updateData] = configRepo.update.mock.calls[0] as [string, Record<string, unknown>];
    // Present-but-undefined would be harmless for TypeORM, but absent is the
    // contract the service relies on to distinguish "leave it" from "clear it".
    expect(updateData).not.toHaveProperty('clientUrl');
    expect(updateData).toHaveProperty('label', 'Renamed');
  });
});
