'use client';

import { useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/api';
import type { SeriesGroupingCopyTarget } from '@/lib/api/series-grouping';

interface SystemEnvironments {
  environments?: Array<{ environment: string; workloads?: string[] }>;
}

/** Every (environment, workload) of the system except the one the rule is being created for. */
export function copyTargetsFrom(
  environments: SystemEnvironments['environments'],
  environment: string,
  workload: string,
): SeriesGroupingCopyTarget[] {
  const targets: SeriesGroupingCopyTarget[] = [];
  for (const env of environments ?? []) {
    for (const w of env.workloads ?? []) {
      if (env.environment === environment && w === workload) continue;
      targets.push({ testEnvironment: env.environment, workload: w });
    }
  }
  return targets;
}

/**
 * The system's other workloads, for the dialog's "Also create for other workloads". Fetched only
 * while `enabled` (the dialog is open), from the same `GET /systems-under-test/:id` the config page
 * reads its environment and workload selectors from. A failure offers no copy targets rather than
 * an error: copying is optional.
 */
export function useCopyTargets(
  systemId: string | undefined,
  environment: string,
  workload: string,
  enabled: boolean,
): SeriesGroupingCopyTarget[] {
  const [targets, setTargets] = useState<SeriesGroupingCopyTarget[]>([]);

  useEffect(() => {
    if (!enabled || !systemId) return;
    let cancelled = false;
    authenticatedFetch(`/systems-under-test/${encodeURIComponent(systemId)}`)
      .then(async (response) => {
        if (!response.ok) return [];
        const system = (await response.json()) as SystemEnvironments;
        return copyTargetsFrom(system.environments, environment, workload);
      })
      .catch(() => [])
      .then((result) => {
        if (!cancelled) setTargets(result);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, systemId, environment, workload]);

  return targets;
}
