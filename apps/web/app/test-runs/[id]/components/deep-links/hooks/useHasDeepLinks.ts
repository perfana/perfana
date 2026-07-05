'use client';

import { useState, useEffect } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { DeepLink } from '../types';

// ponytail: lightweight config-only check so the page can hide the card when
// no deep links are configured. Skips the per-link resolve the card itself does.
export function useHasDeepLinks(
  systemUnderTestId?: string,
  testEnvironment?: string,
  workload?: string,
): boolean {
  const [hasLinks, setHasLinks] = useState(false);

  useEffect(() => {
    if (!systemUnderTestId || !testEnvironment || !workload) return;
    let cancelled = false;

    authenticatedFetch(
      `/deep-links?systemUnderTestId=${systemUnderTestId}&testEnvironment=${encodeURIComponent(testEnvironment)}&workload=${encodeURIComponent(workload)}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    )
      .then((res) => (res.ok ? res.json() : []))
      .then((links: DeepLink[]) => { if (!cancelled) setHasLinks((links ?? []).length > 0); })
      .catch(() => { if (!cancelled) setHasLinks(false); });

    return () => { cancelled = true; };
  }, [systemUnderTestId, testEnvironment, workload]);

  return hasLinks;
}
