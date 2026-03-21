'use client';

import { useState, useEffect } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { DeepLink, ResolvedDeepLink } from '../types';

interface UseDeepLinksDataProps {
  testRunId: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
}

interface UseDeepLinksDataReturn {
  loading: boolean;
  error: string | null;
  resolvedLinks: ResolvedDeepLink[];
  validCount: number;
  invalidCount: number;
}

export function useDeepLinksData({
  testRunId,
  systemUnderTestId,
  testEnvironment,
  workload,
}: UseDeepLinksDataProps): UseDeepLinksDataReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedLinks, setResolvedLinks] = useState<ResolvedDeepLink[]>([]);

  useEffect(() => {
    if (!systemUnderTestId || !testEnvironment || !workload) return;

    const fetchAndResolve = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await authenticatedFetch(
          `/deep-links?systemUnderTestId=${systemUnderTestId}&testEnvironment=${encodeURIComponent(testEnvironment)}&workload=${encodeURIComponent(workload)}`,
          { method: 'GET', headers: { 'Content-Type': 'application/json' } },
        );

        if (!response.ok) throw new Error('Failed to fetch deep links');
        const links: DeepLink[] = await response.json() ?? [];

        if (links.length === 0) {
          setResolvedLinks([]);
          return;
        }

        // Resolve all links in parallel
        const resolved = await Promise.all(
          links.map(async (link) => {
            try {
              const res = await authenticatedFetch(
                `/deep-links/${link.id}/resolve?testRunId=${testRunId}`,
                { method: 'GET', headers: { 'Content-Type': 'application/json' } },
              );
              if (res.ok) return res.json() as Promise<ResolvedDeepLink>;
              return { id: link.id, name: link.name, url: link.url, isValid: false, unresolvedVariables: ['Resolution failed'], tags: link.tags ?? [] };
            } catch {
              return { id: link.id, name: link.name, url: link.url, isValid: false, unresolvedVariables: ['Resolution error'], tags: link.tags ?? [] };
            }
          }),
        );

        setResolvedLinks(resolved);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch deep links');
        setResolvedLinks([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAndResolve();
  }, [testRunId, systemUnderTestId, testEnvironment, workload]);

  const validCount = resolvedLinks.filter((l) => l.isValid).length;
  const invalidCount = resolvedLinks.filter((l) => !l.isValid).length;

  return { loading, error, resolvedLinks, validCount, invalidCount };
}
