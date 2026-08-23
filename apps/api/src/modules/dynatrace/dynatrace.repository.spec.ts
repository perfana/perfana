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
