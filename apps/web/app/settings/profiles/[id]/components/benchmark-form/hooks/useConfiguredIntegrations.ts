'use client';

import { useEffect, useState } from 'react';
import { fetchDynatraceConfigs } from '@/lib/dynatrace';
import { fetchSplunkConfigs } from '@/lib/splunk';
import { ConfiguredIntegrations } from '@/lib/profile-benchmarks';

const NONE: ConfiguredIntegrations = { dynatrace: false, splunk: false };

/**
 * Whether a Dynatrace and a Splunk connection exist, looked up each time the dialog opens: the
 * "Dynatrace — all hosts" and "Splunk — all panels" pseudo-dashboards are offered only then.
 * A failed lookup reads as "not configured".
 */
export function useConfiguredIntegrations(open: boolean): ConfiguredIntegrations {
  const [integrations, setIntegrations] = useState<ConfiguredIntegrations>(NONE);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      fetchDynatraceConfigs().catch(() => []),
      fetchSplunkConfigs().catch(() => []),
    ]).then(([dynatraceConfigs, splunkConfigs]) => {
      if (cancelled) return;
      setIntegrations({
        dynatrace: (dynatraceConfigs ?? []).length > 0,
        splunk: (splunkConfigs ?? []).length > 0,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return integrations;
}
