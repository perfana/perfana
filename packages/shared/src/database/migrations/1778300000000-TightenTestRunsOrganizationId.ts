import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5b PR1: Backfill test_runs.organization_id from the joined SUT, then
 * tighten to NOT NULL.
 *
 * Pre-existing CLAUDE.md note flagged test_runs.organization_id as "vestigial"
 * because access was checked via the joined SUT. RLS activation needs the
 * column to be authoritative so the standard policy
 * (`can_access_resource(organization_id, team_id, created_by)`) works
 * without a subquery to systems_under_test.
 *
 * Backfill is bounded: every test_run has system_under_test_id NOT NULL by
 * existing FK; SUT has organization_id NOT NULL post-Phase-4; therefore every
 * test_run can resolve an organization_id. Migration aborts if any row
 * remains NULL after backfill.
 */
export class TightenTestRunsOrganizationId1778300000000
  implements MigrationInterface
{
  name = 'TightenTestRunsOrganizationId1778300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Backfill organization_id from the joined SUT.
    const updated = await queryRunner.query(`
      UPDATE test_runs t
      SET organization_id = sut.organization_id,
          team_id = COALESCE(t.team_id, sut.team_id)
      FROM systems_under_test sut
      WHERE t.system_under_test_id = sut.id
        AND t.organization_id IS NULL
    `);
    console.log(`Backfilled organization_id on test_runs:`, updated);

    // 2. Verify no orphans (defense against unexpected schema state).
    const orphans = await queryRunner.query(
      `SELECT count(*)::int AS c FROM test_runs WHERE organization_id IS NULL`,
    );
    if (orphans[0].c > 0) {
      throw new Error(
        `Cannot tighten test_runs.organization_id: ${orphans[0].c} rows still NULL after backfill. ` +
        `Investigate orphan test_runs (no SUT or SUT.organization_id NULL) before re-running.`,
      );
    }

    // 3. Tighten the column.
    await queryRunner.query(`ALTER TABLE test_runs ALTER COLUMN organization_id SET NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reversible: drop the NOT NULL constraint. Backfilled values are kept
    // (no point in nulling them; that would lose data).
    await queryRunner.query(`ALTER TABLE test_runs ALTER COLUMN organization_id DROP NOT NULL`);
  }
}
