import { authenticatedFetch } from '@/lib/api';
import { ErrorDetail } from '../types';

export interface ErrorDetailsTarget {
  transaction: string;
  sampler: string;
  url: string;
}

/**
 * One fetcher for GET /test-runs/:id/error-analysis/details, shared by the Error Analysis tab
 * and the Performance Analysis overview drill-down.
 *
 * All three params are required by the API and the query matches `url` EXACTLY, so the caller
 * must pass the URL as the server stored it — see the comment beside `eg.sample_url` in
 * `test-runs-performance-query.service.ts`.
 */
export async function fetchErrorDetails(
  testRunId: string,
  target: ErrorDetailsTarget,
): Promise<ErrorDetail[]> {
  const params = new URLSearchParams({
    transaction: target.transaction,
    sampler: target.sampler,
    url: target.url,
  });

  const response = await authenticatedFetch(
    `test-runs/${testRunId}/error-analysis/details?${params.toString()}`,
  );

  if (!response.ok) throw new Error('Failed to fetch error details');

  const details = await response.json();
  return Array.isArray(details) ? (details as ErrorDetail[]) : [];
}
