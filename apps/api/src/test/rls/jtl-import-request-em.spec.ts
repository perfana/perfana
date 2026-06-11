/**
 * Issue #398 regression: JTL imports failed 100% with FK violation
 * `FK_0f51a7f49362c67adfaaca3973c` because configs (and JTL metric rows) were
 * written through the raw `DataSource` — a *separate* pooled connection — while
 * the test run was created earlier in the same request via the request-scoped
 * RLS transaction. The config INSERT's FK to `test_runs.id` could not see the
 * still-uncommitted run, so the whole request rolled back; the raw-connection
 * metric inserts autocommitted and survived the rollback as orphaned rows.
 *
 * These tests exercise the real service code through a CLS-provided request
 * EntityManager (mirroring `RlsTransactionInterceptor`) and assert:
 *   1. `TestRunsConfigService.addTestRunConfigsByUuid` writes configs on the
 *      same connection that created the (uncommitted) run, so the FK resolves.
 *   2. `JtlImportService`'s metric inserts run inside the request transaction,
 *      so they roll back atomically with the run — leaving no orphaned rows.
 *
 * They run against the local dev DB as the owner role (RLS bypassed); the bug
 * is a connection/transaction-visibility defect, independent of RLS policy.
 * Reverting either fix (back to `this.dataSource.query`) makes the matching
 * test fail.
 */
import { randomUUID } from 'crypto';
import { ClsServiceManager } from 'nestjs-cls';
import { DataSource, EntityManager } from 'typeorm';
import { AppDataSource } from '../../data-source';
import { REQ_EM } from '../../common/db/request-em';
import * as Entities from '../../entities';
import { TestRun as TestRunEntity } from '../../entities';
import { TestRunsConfigService } from '../../modules/test-runs/services/test-runs-config.service';
import { JtlImportService } from '../../modules/test-runs/services/jtl-import.service';

// AppDataSource is migration-only (`entities: []`). Build a sibling DataSource
// that registers the imported entity classes so the services' `getRepository`
// / `findOne` calls resolve metadata with the same class identity.
const entityClasses = Object.values(Entities).filter(
  (v): v is new () => unknown => typeof v === 'function',
);

describe('Issue #398 — JTL import writes through the request transaction', () => {
  const ds = new DataSource({
    ...(AppDataSource.options as Record<string, unknown>),
    entities: entityClasses,
    migrations: [],
  } as never);
  const cls = ClsServiceManager.getClsService();

  const orgId = '00000000-0000-0000-0000-000000000398';
  const sutId = randomUUID();
  const sutName = `jtl-398-sut-${sutId.slice(0, 8)}`;
  const testEnvironment = 'production';
  const workload = 'loadTest';

  let configService: TestRunsConfigService;
  let jtlService: JtlImportService;

  beforeAll(async () => {
    await ds.initialize();

    // addTestRunConfigsByUuid only touches testRunRepo; the other deps are
    // unused on that path, so null stand-ins are safe.
    configService = new TestRunsConfigService(
      ds.getRepository(TestRunEntity),
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    // insertRequests only touches the DataSource; the other deps are unused there.
    jtlService = new JtlImportService(null as never, null as never, null as never, null as never, ds);

    // Seed an org + SUT (owner role, RLS bypassed) so the test run can FK to it.
    await ds.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [orgId, 'Issue 398 Test Org'],
    );
    await ds.query(
      `INSERT INTO systems_under_test (id, organization_id, name, description)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [sutId, orgId, sutName, 'Issue 398 regression SUT'],
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM systems_under_test WHERE id = $1`, [sutId]);
    await ds.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await ds.destroy();
  });

  /** Run `fn` inside a CLS context + transaction with the EM published to REQ_EM, always rolling back. */
  async function inRequestTransaction<T>(fn: (em: EntityManager) => Promise<T>): Promise<T> {
    const ROLLBACK = Symbol('rollback');
    let captured: T;
    try {
      await cls.run(async () => {
        await ds.transaction(async (em) => {
          cls.set(REQ_EM, em);
          captured = await fn(em);
          throw ROLLBACK; // discard everything written in this request
        });
      });
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }
    return captured!;
  }

  it('writes test_run_configs on the same connection that created the run (FK resolves)', async () => {
    const testRunId = `${sutName}-${testEnvironment}-${workload}-${Date.now()}`;

    const configCount = await inRequestTransaction(async (em) => {
      // Create the run inside the request transaction — uncommitted, visible
      // only on this connection (exactly what CreateTestRunHandler does).
      const [{ id: runUuid }] = await em.query(
        `INSERT INTO test_runs (system_under_test_id, test_environment, workload, test_run_id, organization_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [sutId, testEnvironment, workload, testRunId, orgId],
      );

      // The fix: this writes via withRequestEm(testRunRepo).query, so the
      // config INSERT's FK to the run above resolves. With the old raw
      // dataSource.query it would hit a separate connection → FK violation.
      await configService.addTestRunConfigsByUuid(runUuid, ['jtl-upload'], [
        { key: 'jvm.heap', value: '4G' },
        { key: 'gc', value: 'G1' },
      ]);

      const rows = await em.query(
        `SELECT count(*)::int AS c FROM test_run_configs WHERE test_run_id = $1`,
        [runUuid],
      );
      return rows[0].c as number;
    });

    expect(configCount).toBe(2);
  });

  it('rolls back JTL metric inserts atomically — no orphaned requests_raw rows', async () => {
    const testRunId = `${sutName}-${testEnvironment}-${workload}-metrics-${Date.now()}`;
    const sampleRequest = {
      time: new Date(),
      transactionName: 'home',
      samplerName: 'GET /',
      success: true,
      requestSize: 100,
      responseSize: 200,
      responseCode: '200',
      responseConnectTime: 5,
      responseLatency: 10,
      responseTime: 20,
      url: 'https://example.test/api/v1/users/123',
    };

    const visibleInsideTx = await inRequestTransaction(async (em) => {
      // Real private insert — routes through withRequestQuery(dataSource).query.
      await (jtlService as unknown as {
        insertRequests: (
          trid: string,
          sut: string,
          env: string,
          scenario: string,
          requests: unknown[],
        ) => Promise<void>;
      }).insertRequests(testRunId, sutName, testEnvironment, 'scenario-1', [sampleRequest]);

      const rows = await em.query(
        `SELECT count(*)::int AS c FROM requests_raw WHERE test_run_id = $1`,
        [testRunId],
      );
      return rows[0].c as number;
    });

    // Written on the request connection → visible inside the (now rolled-back) tx.
    expect(visibleInsideTx).toBe(1);

    // After rollback, a fresh connection must see nothing. With the old raw
    // dataSource.query the insert autocommitted on a separate connection and
    // this would be 1 (the orphan leak the issue describes).
    const after = await ds.query(
      `SELECT count(*)::int AS c FROM requests_raw WHERE test_run_id = $1`,
      [testRunId],
    );
    expect(after[0].c).toBe(0);
  });

  it('associateStringBasedConfigs swallows a failure without poisoning the request transaction', async () => {
    // associateStringBasedConfigs runs on the request EM and intentionally swallows
    // errors. Without the SAVEPOINT guard, a failed statement would abort the whole
    // request transaction (Postgres 25P02), silently rolling back the updateRunningTest
    // that called it. Force the UPDATE to fail (FK to a non-existent run) and assert the
    // outer transaction survives — a subsequent statement on the same connection works.
    const stringId = `${sutName}-${testEnvironment}-${workload}-assoc-${Date.now()}`;
    const missingRunUuid = randomUUID(); // not in test_runs → UPDATE's FK violates

    const txStillUsable = await inRequestTransaction(async (em) => {
      // Seed a string-keyed config row so the SELECT finds work to do and the
      // UPDATE (to the missing run UUID) actually runs and violates the FK.
      await em.query(
        `INSERT INTO test_run_configs (test_run_id_string, key, value, tags)
         VALUES ($1, 'jvm.heap', '4G', '{}'::text[])`,
        [stringId],
      );

      // Must NOT throw — the method swallows the FK error after rolling back to its savepoint.
      await configService.associateStringBasedConfigs(stringId, missingRunUuid);

      // If the savepoint guard works, the transaction is still alive and this succeeds.
      // Without it, Postgres reports "current transaction is aborted" and this throws.
      const ok = await em.query(`SELECT 1 AS ok`);
      return ok[0].ok as number;
    });

    expect(txStillUsable).toBe(1);
  });
});
