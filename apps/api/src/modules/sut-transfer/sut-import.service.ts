import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import * as readline from 'readline';

export interface ImportSummary {
  sutId: string;
  sutName: string;
  rowCounts: Record<string, number>;
}

const BATCH_SIZE = 1000;

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

    const exists: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM systems_under_test WHERE id = $1`,
      [manifest.sourceSutId],
    );
    if (exists.length > 0) {
      throw new ConflictException(`SUT ${manifest.sourceSutId} already exists — delete it first`);
    }

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
          currentTable = obj.__table__ as string;
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

// Kept local (not derived from the descriptor import) to avoid a circular concern;
// mirror the group:'shared' entries in sut-resource-graph.ts.
const SHARED_TABLES = new Set<string>([
  'pyroscope_instances',
  'grafana_instances',
  'grafana_dashboards',
  'dynatrace_configs',
]);
