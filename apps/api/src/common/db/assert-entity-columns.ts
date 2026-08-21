import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Reports entity columns that this database does not have.
 *
 * The failure it exists for: `application_dashboards.deletion_status` (v0.2.68.7) was added to
 * the entity and to `1700000000000-ConsolidatedSchema.ts` — the schema a FRESH database is built
 * from — and to no incremental migration. Every deployment created before that schema kept a
 * table without the column. TypeORM names every declared column in its SELECT, so the first
 * dashboard read after the upgrade asked for a column that was not there, the endpoint failed,
 * and the UI reported an empty list. It was diagnosed as "deploying deleted all application
 * dashboards" and took a day to trace, because nothing in the system said what was actually
 * wrong. This says it, at boot, in one line.
 *
 * A database migrated from scratch always passes — the consolidated schema creates everything.
 * That is precisely why a CI check against a fresh database would NOT have caught this, and why
 * this one runs against whatever database the service is actually pointed at.
 *
 * Modes, via `SCHEMA_DRIFT_CHECK`:
 *   warn (default)  log the drift at ERROR and keep serving
 *   strict          refuse to boot
 *   off             skip
 *
 * The default is warn rather than strict on purpose. A false positive here — a mapping quirk
 * this comparison does not model — would take the API down on a database that is actually fine,
 * and trading a silent bug for a self-inflicted outage is not an improvement. The log line alone
 * turns the day this cost into a minute. Set strict once you trust it in your environment.
 */
export async function assertEntityColumns(dataSource: DataSource): Promise<void> {
  const logger = new Logger('AssertEntityColumns');
  const mode = (process.env.SCHEMA_DRIFT_CHECK ?? 'warn').toLowerCase();

  if (mode === 'off') {
    logger.log('Schema drift check disabled (SCHEMA_DRIFT_CHECK=off).');
    return;
  }

  const actual: Array<{ table_name: string; column_name: string }> = await dataSource.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );

  const present = new Set(actual.map((r) => `${r.table_name}.${r.column_name}`));
  const tables = new Set(actual.map((r) => r.table_name));

  const missingColumns: string[] = [];
  const missingTables: string[] = [];

  for (const meta of dataSource.entityMetadatas) {
    // Views are derived, not migrated, and carry no columns of their own to compare.
    if (meta.tableType === 'view') continue;

    const table = meta.tableName;

    if (!tables.has(table)) {
      missingTables.push(table);
      // Every column of a missing table is missing; listing them all is noise.
      continue;
    }

    for (const column of meta.columns) {
      // A column mapped to a parent's table (single-table inheritance) or generated purely in
      // memory has no storage of its own here; databaseName is what the SQL actually names.
      const name = column.databaseName;
      if (!name) continue;
      if (!present.has(`${table}.${name}`)) {
        missingColumns.push(`${table}.${name}`);
      }
    }
  }

  if (missingTables.length === 0 && missingColumns.length === 0) {
    logger.log(`Schema matches the entities (${dataSource.entityMetadatas.length} checked).`);
    return;
  }

  const detail = [
    missingTables.length > 0 ? `missing tables: ${missingTables.join(', ')}` : null,
    missingColumns.length > 0 ? `missing columns: ${missingColumns.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('; ');

  const message =
    `This database is missing schema the entities declare — ${detail}. ` +
    'Every read of an affected table will fail with "column does not exist", and a frontend ' +
    'that turns a failed fetch into an empty list will present that as missing DATA. ' +
    'The usual cause is a column added to an entity and to the consolidated schema but to no ' +
    'incremental migration, so only databases created after that change have it. Write the ' +
    'migration, or add the column by hand.';

  if (mode === 'strict') {
    throw new Error(`Startup check failed: ${message}`);
  }

  logger.error(message);
}
