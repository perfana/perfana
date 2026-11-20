import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import * as readline from 'readline';
import { SUT_RESOURCES } from './sut-resource-graph';

interface PgError {
  code?: string;
  table?: string;
  constraint?: string;
  detail?: string;
}

export interface ImportSummary {
  sutId: string;
  sutName: string;
  /** Rows actually written, per table. */
  rowCounts: Record<string, number>;
  /** Rows already present and left untouched, per table. Only tables that skipped appear. */
  skippedCounts: Record<string, number>;
  /** Rows discarded because a required parent was missing from both the bundle and the target. */
  droppedCounts: Record<string, number>;
  /** True when the SUT was already in this environment and the bundle topped it up. */
  mergedIntoExisting: boolean;
}

const BATCH_SIZE = 1000;

// Allowlist of tables the import bundle may write to — derived from the same
// descriptor the exporter reads, so the trust boundary can never drift out of
// sync with the resource graph. Untrusted __table__ values MUST be checked
// against this before being interpolated into SQL.
const VALID_TABLES = new Set(SUT_RESOURCES.map((r) => r.table));

/**
 * Import is idempotent by re-insert-and-skip: every row carries its source PK, so a row that is
 * already here hits ON CONFLICT DO NOTHING. That is what lets one SUT be exported in several
 * bundles (a few test runs at a time) and imported one after another — the shared parents land
 * once, each bundle adds only its own runs.
 *
 * The deliberate limit: it is insert-only. A row that changed at the source is NOT updated on
 * re-import; the copy already here wins. Re-importing is topping up, not syncing.
 */

/**
 * Tables whose `id` PK is an env-local serial integer (nextval sequence). The source env numbers
 * these from 1 just like the target, so preserving the source id guarantees a collision against
 * the target's own rows. None is referenced by any foreign key, so we drop the id on insert and
 * let the target sequence assign a fresh one.
 *
 * This is the COMPLETE set for the bundle, derived from the catalog rather than by hand:
 *   SELECT c.relname FROM pg_class c
 *   JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'id'
 *   JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
 *   WHERE c.relkind = 'r' AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval%';
 * Everything else it returns is a TimescaleDB internal or typeorm_migrations, none of which the
 * bundle carries. Re-run it when a table is added to sut-resource-graph.ts: a serial-id table
 * missing from here is not a loud failure, it is a row silently dropped by ON CONFLICT and then
 * reported to the operator as "already present".
 */
const SERIAL_ID_TABLES = new Set<string>([
  'ds_panels',
  'ds_change_points',
  'ds_control_groups',
  'ds_control_group_statistics',
]);

/**
 * Tables `ON CONFLICT DO NOTHING` cannot make idempotent, so a re-import has to clear the run's
 * rows and rewrite them. Two different reasons land a table here, both verified in the catalog:
 *
 *  - `ds_panels` / `ds_change_points` get a fresh serial id on insert and have no natural unique
 *    key, so nothing can recognise them as duplicates.
 *  - the four raw sample hypertables have **no primary key and no unique index at all**. Postgres
 *    accepts `ON CONFLICT DO NOTHING` there and it simply never fires — re-importing a bundle with
 *    `includeRaw` would silently double every sample, and the continuous aggregates over them
 *    would then report roughly twice the real throughput.
 *
 * `ds_control_group_statistics` is deliberately NOT in this set even though it also has a serial
 * id: `uniq_ds_control_group_statistics (control_group_id, application_dashboard_id, panel_id,
 * metric_name)` already dedupes it, and it is exported per application dashboard rather than per
 * run — purging by run would delete baselines for runs this bundle was never asked to carry, and
 * its `test_run_id` is nullable so the scope would not even cover them all.
 *
 * Every table here is exported `byTestRunVarchar`, so `test_run_id` is the right scope.
 */
const PURGE_BY_RUN_TABLES = new Set<string>([
  'ds_panels',
  'ds_change_points',
  'requests_raw',
  'requests_error',
  'transactions',
  'virtual_users',
]);

/**
 * The purge is scoped per test run and runs once per import — not once per batch. A run's rows can
 * span several 1000-row batches, and re-deleting would erase what the previous batch just wrote.
 */
const PURGE_SCOPE_COLUMN = 'test_run_id';

/**
 * Test-run comments carry their source `notified_at`, which is NULL for any comment the source's
 * notification sweep had not claimed yet. Imported as is, the target's sweep would post those to
 * the target's Slack/Teams/Mattermost channels as new discussion. Every imported comment is
 * stamped announced instead (design R9), whatever the bundle says, and an older bundle without
 * the column is stamped the same way.
 */
const COMMENTS_TABLE = 'test_run_comments';

@Injectable()
export class SutImportService {
  private readonly logger = new Logger(SutImportService.name);

  constructor(private readonly dataSource: DataSource) {}

  async import(fileBuffer: Buffer, targetOrganizationId: string): Promise<ImportSummary> {
    const rl = readline.createInterface({
      input: Readable.from(fileBuffer).pipe(createGunzip()),
      crlfDelay: Infinity,
    });

    const rowCounts: Record<string, number> = {};
    const skippedCounts: Record<string, number> = {};
    const droppedCounts: Record<string, number> = {};
    // (table, scope) pairs already cleared this import — see SERIAL_ID_SCOPE_COLUMN.
    const purgedScopes = new Set<string>();
    const importedAt = new Date().toISOString();

    // Read the manifest first (line 1) so we can run the conflict check before writing.
    // We buffer per-table batches and flush inside a single transaction.
    const iterator = rl[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new BadRequestException('Empty bundle');
    const firstObj = JSON.parse(first.value);
    if (!firstObj.__manifest__) throw new BadRequestException('Bundle missing manifest');
    const manifest: { sourceSutId: string; sutName: string; schemaVersion: number } = firstObj.__manifest__;
    if (manifest.schemaVersion !== 1) {
      throw new BadRequestException(`Unsupported bundle schemaVersion ${manifest.schemaVersion}`);
    }
    if (!manifest.sourceSutId) {
      throw new BadRequestException('Bundle manifest missing sourceSutId');
    }

    const existing: Array<{ organization_id: string }> = await this.dataSource.query(
      `SELECT organization_id FROM systems_under_test WHERE id = $1`,
      [manifest.sourceSutId],
    );
    const mergedIntoExisting = existing.length > 0;
    if (mergedIntoExisting) {
      // The SUT row itself is skipped by ON CONFLICT, so it keeps the organization it already has
      // while every child row in this bundle is remapped to targetOrganizationId. Importing into a
      // different org would therefore split one SUT across two: the runs would be invisible to
      // BOTH orgs, since RLS reads the run's own organization_id and the service-layer check reads
      // the joined SUT's. Refuse instead of writing that.
      const currentOrg = existing[0]!.organization_id;
      if (currentOrg !== targetOrganizationId) {
        throw new ConflictException(
          `SUT ${manifest.sourceSutId} already exists in organization ${currentOrg}. Import it ` +
            `into that organization, or delete it first — merging it into ${targetOrganizationId} ` +
            `would split the system across two organizations and hide its test runs from both.`,
        );
      }
      this.logger.log(
        `SUT ${manifest.sourceSutId} (${manifest.sutName}) is already here — merging this bundle ` +
          `into it. Rows that already exist are left as they are.`,
      );
    } else {
      // uq_system_under_test_name_org: a DIFFERENT SUT already holding this name in the target org
      // would make the SUT row lose ON CONFLICT silently, and every child would then reference a
      // system_under_test_id that does not exist — a raw 23503 at best, and a bundle with no
      // children would report success having written nothing.
      const nameClash: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM systems_under_test WHERE name = $1 AND organization_id = $2`,
        [manifest.sutName, targetOrganizationId],
      );
      if (nameClash.length > 0) {
        throw new ConflictException(
          `A different system named "${manifest.sutName}" (${nameClash[0]!.id}) already exists in ` +
            `this organization. Rename or delete it before importing this bundle.`,
        );
      }
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        let currentTable: string | null = null;
        let batch: Record<string, unknown>[] = [];

        const flush = async (): Promise<void> => {
          if (!currentTable || batch.length === 0) return;
          const { inserted, dropped } = await this.insertBatch(
            manager,
            currentTable,
            batch,
            purgedScopes,
          );
          rowCounts[currentTable] = (rowCounts[currentTable] ?? 0) + inserted;
          const skipped = batch.length - inserted - dropped;
          if (skipped > 0) skippedCounts[currentTable] = (skippedCounts[currentTable] ?? 0) + skipped;
          if (dropped > 0) droppedCounts[currentTable] = (droppedCounts[currentTable] ?? 0) + dropped;
          batch = [];
        };

        for await (const line of { [Symbol.asyncIterator]: () => iterator }) {
          if (!line.trim()) continue;
          const obj = JSON.parse(line);
          if (obj.__table__) {
            await flush();
            const table = obj.__table__ as string;
            if (!VALID_TABLES.has(table)) {
              throw new BadRequestException(`Unknown table in bundle: ${table}`);
            }
            currentTable = table;
            if (rowCounts[currentTable] === undefined) rowCounts[currentTable] = 0;
            continue;
          }
          if (obj.__summary__ || obj.__manifest__) continue;
          // Remap ownership on any row that carries these columns.
          if ('organization_id' in obj) obj.organization_id = targetOrganizationId;
          if ('team_id' in obj) obj.team_id = null;
          if (currentTable === COMMENTS_TABLE) obj.notified_at = importedAt;
          batch.push(obj);
          if (batch.length >= BATCH_SIZE) await flush();
        }
        await flush();
      });
    } catch (err) {
      const pg = (err as { driverError?: PgError } | undefined)?.driverError
        ?? (err as PgError | undefined);
      if (pg?.code === '23505') {
        // Every insert is ON CONFLICT DO NOTHING, so a duplicate key reaching here is not a
        // re-import — it is a genuine clash (two different rows claiming one natural key).
        // Name the table rather than blaming the SUT.
        const where = pg.table ? ` on ${pg.table}${pg.constraint ? ` (${pg.constraint})` : ''}` : '';
        throw new ConflictException(
          `Import conflict — duplicate key${where}${pg.detail ? `: ${pg.detail}` : ''}`,
        );
      }
      throw err;
    }

    this.logger.log(
      `Imported SUT ${manifest.sourceSutId} (${manifest.sutName}) into org ${targetOrganizationId}: ` +
        `inserted ${JSON.stringify(rowCounts)}, skipped ${JSON.stringify(skippedCounts)}, ` +
        `dropped ${JSON.stringify(droppedCounts)}`,
    );
    return {
      sutId: manifest.sourceSutId,
      sutName: manifest.sutName,
      rowCounts,
      skippedCounts,
      droppedCounts,
      mergedIntoExisting,
    };
  }

  /**
   * Writes a batch and reports what happened to it: `inserted` landed, `dropped` were pruned as
   * orphans before the insert, and whatever is left over was already present. Keeping `dropped`
   * separate matters — folding it into the skip count would tell the operator that discarded rows
   * are "already present" in the target, which is the exact opposite of the truth.
   */
  private async insertBatch(
    manager: EntityManager,
    table: string,
    rows: Record<string, unknown>[],
    purgedScopes: Set<string>,
  ): Promise<{ inserted: number; dropped: number }> {
    // Postgres reconstructs each row (jsonb/array/timestamp types) from JSON.
    // DO NOTHING on every table (not just the shared ones) is what makes a re-import a no-op
    // instead of a 23505: rows carry their source PK, so one already here simply loses.
    // RETURNING 1 yields one row per insert, which is the only honest way to count them —
    // batch.length would report skipped rows as imported. See writeRows.

    // generated_reports.template_id is an FK to report_templates, which now travels
    // in the bundle. Bundles exported before that fix carry the reports but not their
    // templates, so those rows would FK-violate the whole import. Drop the orphans
    // (logged) so the rest of the SUT still lands; a re-export with the current code
    // brings the templates — and the reports — back. For self-contained bundles this
    // prunes nothing. A NULL here is a report whose template was deleted, which is not
    // an orphan: it refers to nothing and imports as it is.
    //
    // ds_metric_series_groups.rule_id is the opposite case: nullable, and the row is still a
    // valid raw -> group mapping without its rule, so the reference is cleared instead of the
    // row dropped. See nullRowsMissingParent.
    const toInsert =
      table === 'generated_reports'
        ? await this.dropRowsMissingParent(manager, table, rows, 'template_id', 'report_templates')
        : table === 'ds_metric_series_groups'
          ? await this.nullRowsMissingParent(manager, table, rows, 'rule_id', 'series_grouping_rules')
          : rows;
    const dropped = rows.length - toInsert.length;
    if (toInsert.length === 0) return { inserted: 0, dropped };

    // A bundle run whose key already belongs to a DIFFERENT run here must not be merged in.
    if (table === 'test_runs') await this.assertNoForeignRunKey(manager, toInsert);

    if (PURGE_BY_RUN_TABLES.has(table)) {
      await this.purgeRunScopes(manager, table, toInsert, purgedScopes);
    }

    if (table === COMMENTS_TABLE) return this.insertComments(manager, toInsert);

    return { inserted: await this.writeRows(manager, table, toInsert), dropped };
  }

  /**
   * Comments reference each other (`parent_id` → a root of the same run), so roots and replies
   * go in as two statements, and a reply whose root did not land is dropped rather than left to
   * FK-violate and abort the whole import.
   *
   * The export orders roots first, but that alone is not enough on a merge-import: a bundle root
   * can lose ON CONFLICT DO NOTHING to a DIFFERENT comment already here, because an unqualified
   * ON CONFLICT arbitrates on every unique index and `uq_test_run_comments_marker_seq` makes
   * (run, marker number) unique. That happens when a run imported earlier gained a marker in
   * BOTH environments before the top-up: the two new markers share the next number. The bundle's
   * root is then "already present", and its replies would point at an id that does not exist.
   */
  private async insertComments(
    manager: EntityManager,
    rows: Record<string, unknown>[],
  ): Promise<{ inserted: number; dropped: number }> {
    const roots = rows.filter((r) => r.parent_id == null);
    const replies = rows.filter((r) => r.parent_id != null);
    const insertedRoots = roots.length > 0 ? await this.writeRows(manager, COMMENTS_TABLE, roots) : 0;
    const keptReplies = replies.length > 0
      ? await this.dropRowsMissingParent(
          manager,
          COMMENTS_TABLE,
          replies,
          'parent_id',
          COMMENTS_TABLE,
          'their thread root was not imported (a different comment here already holds its marker number).',
        )
      : [];
    const insertedReplies = keptReplies.length > 0
      ? await this.writeRows(manager, COMMENTS_TABLE, keptReplies)
      : 0;
    return { inserted: insertedRoots + insertedReplies, dropped: replies.length - keptReplies.length };
  }

  /** INSERT … ON CONFLICT DO NOTHING; returns how many rows actually landed. */
  private async writeRows(
    manager: EntityManager,
    table: string,
    toInsert: Record<string, unknown>[],
  ): Promise<number> {
    // Name only the columns the bundle actually carries. A bundle exported before a column
    // existed has no key for it, and json_populate_recordset turns a missing key into NULL —
    // which bypasses the column DEFAULT and fails a NOT NULL added later (notification_channels
    // .notify_on_comment, v0.2.97.89). Left out of the list, the column takes its DEFAULT.
    // SERIAL_ID_TABLES also omit `id` so the target sequence assigns a fresh one, sidestepping
    // the env-local integer-id collision. Names come from the catalog, filtered by the bundle
    // keys, so an untrusted key can never be interpolated.
    const present = new Set(toInsert.flatMap((r) => Object.keys(r)));
    const skipId = SERIAL_ID_TABLES.has(table);
    const cols = (await this.tableColumns(manager, table)).filter(
      (c) => present.has(c) && !(skipId && c === 'id'),
    );
    if (cols.length === 0) {
      throw new BadRequestException(
        `No column of ${table} here matches the bundle's rows: has this environment run its migrations?`,
      );
    }
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const written: unknown[] = await manager.query(
      `INSERT INTO ${table} (${colList}) SELECT ${colList} FROM json_populate_recordset(null::${table}, $1::json) ON CONFLICT DO NOTHING RETURNING 1`,
      [JSON.stringify(toInsert)],
    );
    return written.length;
  }

  /**
   * Refuse a bundle whose test run key is already taken by a different run in this environment.
   *
   * `test_runs` carries `UNIQUE (test_run_id)`, and an unqualified ON CONFLICT DO NOTHING
   * arbitrates on ANY unique index — so without this the colliding run would be silently skipped
   * and counted as "already present", while every child row keyed by that varchar key (raw
   * samples, ds_metrics, check results) would be written onto the target's own unrelated run, and
   * the per-run purge would first DELETE that run's panels and change points. Fail loudly instead.
   */
  private async assertNoForeignRunKey(
    manager: EntityManager,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    const byKey = new Map<string, string>();
    for (const r of rows) {
      if (r.test_run_id != null && r.id != null) byKey.set(String(r.test_run_id), String(r.id));
    }
    if (byKey.size === 0) return;

    const clashes: Array<{ id: string; test_run_id: string }> = await manager.query(
      `SELECT id::text AS id, test_run_id FROM test_runs WHERE test_run_id = ANY($1::text[])`,
      [[...byKey.keys()]],
    );
    const foreign = clashes.filter((c) => byKey.get(c.test_run_id) !== c.id);
    if (foreign.length > 0) {
      const names = foreign.map((c) => `"${c.test_run_id}"`).join(', ');
      throw new ConflictException(
        `Test run key(s) ${names} already belong to a different test run in this environment. ` +
          `Importing would overwrite that run's data. Rename or delete the existing run(s) first.`,
      );
    }
  }

  /**
   * Clear a table's rows for every test run in this batch, once per import.
   *
   * See PURGE_BY_RUN_TABLES for why ON CONFLICT cannot cover these. Deleting per run (rather than
   * per SUT) keeps a top-up bundle from touching runs it does not carry.
   */
  private async purgeRunScopes(
    manager: EntityManager,
    table: string,
    rows: Record<string, unknown>[],
    purgedScopes: Set<string>,
  ): Promise<void> {
    const scopes = [
      ...new Set(
        rows
          .map((r) => r[PURGE_SCOPE_COLUMN])
          .filter((v) => v != null)
          .map(String),
      ),
    ].filter((scope) => !purgedScopes.has(`${table}:${scope}`));
    if (scopes.length === 0) return;

    await manager.query(
      `DELETE FROM ${table} WHERE ${PURGE_SCOPE_COLUMN}::text = ANY($1::text[])`,
      [scopes],
    );
    scopes.forEach((scope) => purgedScopes.add(`${table}:${scope}`));
  }

  /**
   * Clear a nullable FK column on rows whose parent is absent from the target, keeping the rows.
   *
   * The case is `ds_metric_series_groups.rule_id` on a merge-import. A bundle's rule can lose
   * `ON CONFLICT DO NOTHING` to a DIFFERENT rule already holding the same slot
   * (`uq_series_grouping_rules_slot`: system, environment, workload, dashboard, panel), which is
   * what happens when a user deleted and recreated a rule in the target before a top-up import.
   * The rule is then skipped and counted as "already present", and the membership rows that
   * reference its id would FK-violate (23503) and abort the whole import, which only translates
   * 23505.
   *
   * `rule_id` is `ON DELETE SET NULL`, so NULL is exactly the "rule removed" state the stale
   * detection already understands, and the row stays a valid raw -> group mapping for its run.
   * The parent is looked up AFTER the parent table was flushed: the bundle orders
   * `series_grouping_rules` first, and its rows are visible here inside the same transaction.
   *
   * Rows already carrying NULL, and rows whose parent exists, pass through untouched. The parent
   * table is a trusted literal from the caller; ids are cast to text so this works regardless of
   * the key type, as in dropRowsMissingParent.
   */
  private async nullRowsMissingParent(
    manager: EntityManager,
    table: string,
    rows: Record<string, unknown>[],
    column: string,
    parentTable: string,
  ): Promise<Record<string, unknown>[]> {
    const ids = [...new Set(rows.map((r) => r[column]).filter((v) => v != null).map(String))];
    if (ids.length === 0) return rows;
    const present: Array<{ id: string }> = await manager.query(
      `SELECT id::text AS id FROM ${parentTable} WHERE id::text = ANY($1::text[])`,
      [ids],
    );
    const have = new Set(present.map((p) => p.id));
    let cleared = 0;
    const kept = rows.map((r) => {
      if (r[column] == null || have.has(String(r[column]))) return r;
      cleared++;
      return { ...r, [column]: null };
    });
    if (cleared > 0) {
      this.logger.warn(
        `Cleared ${column} on ${cleared} ${table} row(s) referencing a ${parentTable} row that is ` +
          `not in the target (typically because another rule already holds its slot). The rows were ` +
          `imported without it.`,
      );
    }
    return kept;
  }

  // Drop rows whose FK column points at a parent row absent from the target — used
  // for orphaned generated_reports in pre-fix bundles. A NULL points at nothing, so it
  // stays. The parent
  // table is a trusted literal from the caller; ids are cast to text so this
  // works regardless of the key type. Logs how many rows were pruned.
  private async dropRowsMissingParent(
    manager: EntityManager,
    table: string,
    rows: Record<string, unknown>[],
    column: string,
    parentTable: string,
    reason = 're-export the SUT with the current version to include them.',
  ): Promise<Record<string, unknown>[]> {
    const ids = [...new Set(rows.map((r) => r[column]).filter((v) => v != null).map(String))];
    if (ids.length === 0) return rows;
    const present: Array<{ id: string }> = await manager.query(
      `SELECT id::text AS id FROM ${parentTable} WHERE id::text = ANY($1::text[])`,
      [ids],
    );
    const have = new Set(present.map((p) => p.id));
    const kept = rows.filter((r) => r[column] == null || have.has(String(r[column])));
    const dropped = rows.length - kept.length;
    if (dropped > 0) {
      this.logger.warn(
        `Dropped ${dropped} ${table} row(s) referencing a missing ${parentTable} — ${reason}`,
      );
    }
    return kept;
  }

  // Column names for a table, straight from the catalog. Trusted source → safe to interpolate
  // into the column list. Cached per import (keyed on its transaction's manager), never per
  // process: the API can serve an import before the migration runner finishes, and a list
  // cached then would name a dropped column (42703) until a restart. Per batch would be a
  // catalog query every 1000 rows, ~20k of them on a large raw-data import.
  private readonly columnCache = new WeakMap<EntityManager, Map<string, string[]>>();
  private async tableColumns(manager: EntityManager, table: string): Promise<string[]> {
    let perImport = this.columnCache.get(manager);
    if (!perImport) {
      perImport = new Map();
      this.columnCache.set(manager, perImport);
    }
    const cached = perImport.get(table);
    if (cached) return cached;
    const rows: { column_name: string }[] = await manager.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    );
    const cols = rows.map((r) => r.column_name);
    perImport.set(table, cols);
    return cols;
  }
}
