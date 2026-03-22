import { Repository } from 'typeorm';
import { MetricsSource, MetricsSourceType } from '../entities/metrics-source.entity';

export interface UpsertMetricsSourceParams {
  systemUnderTestId: string;
  testEnvironment: string;
  sourceType: MetricsSourceType;
  sourceConfigId?: string;
  externalRef?: string;
  displayName: string;
  displayLabel?: string;
  workload?: string;
  tags?: string[];
  organizationId?: string;
  teamId?: string;
  createdBy?: string;
  metadata?: Record<string, any>;
}

/**
 * Upsert a MetricsSource record. Used by grafana-sync, worker dashboard-manager,
 * and worker dynatrace-manager.
 *
 * Uses ON CONFLICT on the unique constraint
 * (system_under_test_id, test_environment, source_type, external_ref, display_name)
 * to provide idempotent creation.
 *
 * @returns The metrics_source.id (existing or newly created)
 */
export async function upsertMetricsSource(
  repo: Repository<MetricsSource>,
  params: UpsertMetricsSourceParams,
): Promise<string> {
  const result = await repo
    .createQueryBuilder()
    .insert()
    .into(MetricsSource)
    .values({
      systemUnderTestId: params.systemUnderTestId,
      testEnvironment: params.testEnvironment,
      sourceType: params.sourceType,
      sourceConfigId: params.sourceConfigId ?? undefined,
      externalRef: params.externalRef ?? undefined,
      displayName: params.displayName,
      displayLabel: params.displayLabel ?? undefined,
      workload: params.workload ?? undefined,
      tags: params.tags ?? [],
      metadata: params.metadata ?? undefined,
      organizationId: params.organizationId ?? undefined,
      teamId: params.teamId ?? undefined,
      createdBy: params.createdBy ?? undefined,
    })
    .orUpdate(
      [
        'display_label',
        'workload',
        'tags',
        'metadata',
        'source_config_id',
        'organization_id',
        'team_id',
        'updated_at',
      ],
      'uq_metrics_sources_unique',
    )
    .returning('id')
    .execute();

  return result.generatedMaps[0]?.id ?? result.raw[0]?.id;
}

/**
 * Infer MetricsSourceType from a dashboard UID prefix.
 * Used during backfill migration and dual-write to determine the source type
 * from existing ApplicationDashboard records.
 */
export function inferSourceTypeFromDashboardUid(dashboardUid: string | null | undefined): MetricsSourceType {
  if (!dashboardUid) return 'grafana';
  if (dashboardUid.startsWith('dynatrace-')) return 'dynatrace';
  if (dashboardUid.startsWith('performance-test-metrics-')) return 'performance_test';
  return 'grafana';
}
