import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import * as readline from 'readline';
import { SUT_RESOURCES } from './sut-resource-graph';

export interface ImportSummary {
  sutId: string;
  sutName: string;
  rowCounts: Record<string, number>;
}

const BATCH_SIZE = 1000;

// Allowlist of tables the import bundle may write to — derived from the same
// descriptor the exporter reads, so the trust boundary can never drift out of
// sync with the resource graph. Untrusted __table__ values MUST be checked
// against this before being interpolated into SQL.
const VALID_TABLES = new Set(SUT_RESOURCES.map((r) => r.table));

// Derived (not hand-duplicated) so it automatically stays in sync with the
// group:'shared' entries in sut-resource-graph.ts.
const SHARED_TABLES = new Set<string>(
  SUT_RESOURCES.filter((r) => r.group === 'shared').map((r) => r.table),
);

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

    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM systems_under_test WHERE id = $1`,
      [manifest.sourceSutId],
    );
    if (exists.length > 0) {
      throw new ConflictException(`SUT ${manifest.sourceSutId} already exists — delete it first`);
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        let currentTable: string | null = null;
        let batch: Record<string, unknown>[] = [];

        const flush = async (): Promise<void> => {
          if (!currentTable || batch.length === 0) return;
          await this.insertBatch(manager, currentTable, batch);
          rowCounts[currentTable] = (rowCounts[currentTable] ?? 0) + batch.length;
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
          batch.push(obj);
          if (batch.length >= BATCH_SIZE) await flush();
        }
        await flush();
      });
    } catch (err) {
      const code =
        (err as { code?: string; driverError?: { code?: string } })?.code ??
        (err as { code?: string; driverError?: { code?: string } })?.driverError?.code;
      if (code === '23505') {
        throw new ConflictException(`SUT ${manifest.sourceSutId} already exists — delete it first`);
      }
      throw err;
    }

    this.logger.log(
      `Imported SUT ${manifest.sourceSutId} (${manifest.sutName}) into org ${targetOrganizationId}: ${JSON.stringify(rowCounts)}`,
    );
    return { sutId: manifest.sourceSutId, sutName: manifest.sutName, rowCounts };
  }

  private async insertBatch(
    manager: EntityManager,
    table: string,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    // Postgres reconstructs each row (jsonb/array/timestamp types) from JSON.
    // Shared reference rows may already exist in dev → ON CONFLICT DO NOTHING.
    const isShared = SHARED_TABLES.has(table);
    const conflict = isShared ? 'ON CONFLICT DO NOTHING' : '';
    await manager.query(
      `INSERT INTO ${table} SELECT * FROM json_populate_recordset(null::${table}, $1::json) ${conflict}`,
      [JSON.stringify(rows)],
    );
  }
}
