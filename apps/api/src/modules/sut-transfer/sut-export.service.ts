import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createGzip } from 'zlib';
import { Readable } from 'stream';
import { selectResources, SutResource } from './sut-resource-graph';

interface ExportContext {
  sutId: string;
  testRunUuids: string[];
  testRunKeys: string[];
  appDashboardIds: string[];
}

@Injectable()
export class SutExportService {
  private readonly logger = new Logger(SutExportService.name);

  constructor(private readonly dataSource: DataSource) {}

  async export(
    sutId: string,
    opts: { testRunIds: string[]; includeOptional: boolean; includeRaw: boolean },
  ): Promise<Readable> {
    const sutRows: Array<{ name: string }> = await this.dataSource.query(
      `SELECT name FROM systems_under_test WHERE id = $1`,
      [sutId],
    );
    if (sutRows.length === 0) throw new NotFoundException(`SUT ${sutId} not found`);
    const sutName = sutRows[0]!.name;

    // Resolve + validate the selected runs belong to this SUT; grab both key flavors.
    const runRows: Array<{ id: string; test_run_id: string }> = await this.dataSource.query(
      `SELECT id, test_run_id FROM test_runs WHERE system_under_test_id = $1 AND id = ANY($2)`,
      [sutId, opts.testRunIds],
    );
    const appDashRows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM application_dashboards WHERE system_under_test_id = $1`,
      [sutId],
    );
    const ctx: ExportContext = {
      sutId,
      testRunUuids: runRows.map((r) => r.id),
      testRunKeys: runRows.map((r) => r.test_run_id),
      appDashboardIds: appDashRows.map((r) => r.id),
    };

    const gzip = createGzip();
    // Fire-and-forget writer; errors destroy the stream so the controller surfaces them.
    void this.writeBundle(gzip, sutName, ctx, opts).catch((err) => {
      this.logger.error(`SUT export failed for ${sutId}: ${(err as Error).message}`);
      gzip.destroy(err as Error);
    });
    return gzip;
  }

  private async writeBundle(
    sink: NodeJS.WritableStream,
    sutName: string,
    ctx: ExportContext,
    opts: { testRunIds: string[]; includeOptional: boolean; includeRaw: boolean },
  ): Promise<void> {
    const write = (obj: unknown): Promise<void> =>
      new Promise((resolve, reject) =>
        sink.write(JSON.stringify(obj) + '\n', (e) => (e ? reject(e) : resolve())),
      );

    await write({
      __manifest__: {
        schemaVersion: 1,
        appVersion: process.env.APP_VERSION ?? 'dev',
        sourceSutId: ctx.sutId,
        sutName,
        testRunIds: ctx.testRunUuids,
        includeOptional: opts.includeOptional,
        includeRaw: opts.includeRaw,
        exportedAt: new Date().toISOString(),
      },
    });

    const counts: Record<string, number> = {};
    for (const resource of selectResources(opts)) {
      const { sql, params } = this.buildQuery(resource, ctx);
      await write({ __table__: resource.table });
      const count = await this.streamRows(sql, params, write);
      counts[resource.table] = count;
    }
    await write({ __summary__: { counts } });
    await new Promise<void>((resolve, reject) => sink.end((e?: Error) => (e ? reject(e) : resolve())));
  }

  private buildQuery(resource: SutResource, ctx: ExportContext): { sql: string; params: unknown[] } {
    switch (resource.filter) {
      case 'byReference':
        return { sql: resource.customSql!, params: [ctx.sutId] };
      case 'bySut': {
        // The systems_under_test row itself is keyed by `id`, not
        // `system_under_test_id` (every other 'bySut' table is its child).
        const column = resource.table === 'systems_under_test' ? 'id' : 'system_under_test_id';
        return {
          sql: `SELECT row_to_json(t) AS r FROM ${resource.table} t WHERE t.${column} = $1`,
          params: [ctx.sutId],
        };
      }
      case 'byTestRunVarchar':
        return {
          sql: `SELECT row_to_json(t) AS r FROM ${resource.table} t WHERE t.test_run_id = ANY($1)`,
          params: [ctx.testRunKeys],
        };
      case 'byTestRunUuid':
        return {
          sql: `SELECT row_to_json(t) AS r FROM ${resource.table} t WHERE t.test_run_id = ANY($1)`,
          params: [ctx.testRunUuids],
        };
      case 'byAppDashboard':
        return {
          sql: `SELECT row_to_json(t) AS r FROM ${resource.table} t WHERE t.application_dashboard_id = ANY($1)`,
          params: [ctx.appDashboardIds],
        };
      case 'byTestEnvironment':
        // system_under_test_workloads has no system_under_test_id; it hangs off
        // test environments (grandchild). Filter via the SUT's environments.
        return {
          sql: `SELECT row_to_json(t) AS r FROM ${resource.table} t
                WHERE t.system_under_test_test_environment_id IN (
                  SELECT id FROM system_under_test_test_environments WHERE system_under_test_id = $1)`,
          params: [ctx.sutId],
        };
    }
  }

  private async streamRows(
    sql: string,
    params: unknown[],
    write: (obj: unknown) => Promise<void>,
  ): Promise<number> {
    // Empty ANY([]) short-circuit: skip the query entirely.
    if (params.length === 1 && Array.isArray(params[0]) && params[0].length === 0) return 0;
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    let count = 0;
    try {
      // ponytail: pg-query-stream cursor keeps ds_metrics memory-bounded; swap to
      // Postgres COPY only if export of huge runs is measurably too slow.
      const stream = await qr.stream(sql, params as any[]);
      for await (const row of stream as AsyncIterable<{ r: unknown }>) {
        await write(row.r);
        count++;
      }
    } finally {
      await qr.release();
    }
    return count;
  }
}
