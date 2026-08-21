import { DataSource } from 'typeorm';
import { assertEntityColumns } from './assert-entity-columns';

/**
 * The scenario every case here is a variation of: application_dashboards.deletion_status exists
 * in the entity and in the consolidated schema, but not in a database that predates it.
 */
const dashboardEntity = (columns: string[]) => ({
  tableName: 'application_dashboards',
  tableType: 'regular',
  columns: columns.map((databaseName) => ({ databaseName })),
});

const ds = (dbColumns: Array<[string, string]>, entities: unknown[]) =>
  ({
    query: jest
      .fn()
      .mockResolvedValue(dbColumns.map(([table_name, column_name]) => ({ table_name, column_name }))),
    entityMetadatas: entities,
  }) as unknown as DataSource;

describe('assertEntityColumns', () => {
  const originalMode = process.env.SCHEMA_DRIFT_CHECK;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.SCHEMA_DRIFT_CHECK;
    else process.env.SCHEMA_DRIFT_CHECK = originalMode;
    jest.restoreAllMocks();
  });

  it('passes when the database has every column the entities declare', async () => {
    const dataSource = ds(
      [
        ['application_dashboards', 'id'],
        ['application_dashboards', 'deletion_status'],
      ],
      [dashboardEntity(['id', 'deletion_status'])],
    );

    await expect(assertEntityColumns(dataSource)).resolves.toBeUndefined();
  });

  it('names the missing column rather than letting reads fail later', async () => {
    const error = jest.spyOn(require('@nestjs/common').Logger.prototype, 'error').mockImplementation();

    // The production shape: the row exists, the column does not.
    const dataSource = ds(
      [['application_dashboards', 'id']],
      [dashboardEntity(['id', 'deletion_status'])],
    );

    await assertEntityColumns(dataSource);

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain('application_dashboards.deletion_status');
  });

  it('keeps serving by default, because a false positive must not take the API down', async () => {
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'error').mockImplementation();

    const dataSource = ds([], [dashboardEntity(['id'])]);

    await expect(assertEntityColumns(dataSource)).resolves.toBeUndefined();
  });

  it('refuses to boot in strict mode', async () => {
    process.env.SCHEMA_DRIFT_CHECK = 'strict';

    const dataSource = ds(
      [['application_dashboards', 'id']],
      [dashboardEntity(['id', 'deletion_status'])],
    );

    await expect(assertEntityColumns(dataSource)).rejects.toThrow(
      /application_dashboards\.deletion_status/,
    );
  });

  it('reports a wholly missing table once, not once per column', async () => {
    const error = jest.spyOn(require('@nestjs/common').Logger.prototype, 'error').mockImplementation();

    const dataSource = ds([], [dashboardEntity(['id', 'deletion_status', 'dashboard_label'])]);

    await assertEntityColumns(dataSource);

    const message = error.mock.calls[0]![0] as string;
    expect(message).toContain('missing tables: application_dashboards');
    expect(message).not.toContain('missing columns');
  });

  it('skips views, which are derived rather than migrated', async () => {
    const dataSource = ds(
      [],
      [{ tableName: 'some_view', tableType: 'view', columns: [{ databaseName: 'anything' }] }],
    );

    await expect(assertEntityColumns(dataSource)).resolves.toBeUndefined();
  });

  it('can be switched off entirely', async () => {
    process.env.SCHEMA_DRIFT_CHECK = 'off';
    const dataSource = ds([], [dashboardEntity(['id'])]);

    await assertEntityColumns(dataSource);

    // Not even queried: off means off.
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
