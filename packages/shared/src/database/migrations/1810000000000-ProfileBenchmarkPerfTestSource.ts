import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A profile benchmark can now target the worker-written `Performance test metrics <scenario>`
 * dashboards (`source = 'performance-metrics'`, `dashboard_uid` a regex over the app-dashboard
 * uid). Those have no Grafana template, so `profile_dashboard_id` has nothing to point at.
 * Also backfills `benchmarks.evaluate_type` on profile-provisioned rows (see `up`).
 */
export class ProfileBenchmarkPerfTestSource1810000000000 implements MigrationInterface {
  name = 'ProfileBenchmarkPerfTestSource1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE public.profile_benchmarks ALTER COLUMN profile_dashboard_id DROP NOT NULL'
    );
    // grafana-sync wrote the profile's evaluate type into configuration only; the worker
    // reads the column and defaulted every profile-provisioned SLO to 'mean'.
    await queryRunner.query(`
      UPDATE public.benchmarks
      SET evaluate_type = configuration->>'evaluateType'
      WHERE generic_check_id IS NOT NULL
        AND evaluate_type IS NULL
        AND configuration->>'evaluateType' IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restoring NOT NULL means dropping every perf-test profile benchmark. The `benchmarks`
    // rows grafana-sync provisioned from them are left in place (no FK on generic_check_id);
    // they keep being evaluated until deleted by hand. The evaluate_type backfill is a repair
    // the old worker reads correctly and is not reverted.
    await queryRunner.query(
      "DELETE FROM public.profile_benchmarks WHERE profile_dashboard_id IS NULL"
    );
    await queryRunner.query(
      'ALTER TABLE public.profile_benchmarks ALTER COLUMN profile_dashboard_id SET NOT NULL'
    );
  }
}
