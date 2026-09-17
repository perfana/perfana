import { authenticatedFetch } from '@/lib/api';

/** One sampler of a run — the columns the Top 10 requests/URLs tabs actually read. */
export interface RunSampler {
  transaction_name: string;
  sampler_name: string;
  scenario_name?: string;
  url_pattern: string | null;
  avg_response_time: number;
  passed_count: number;
  failed_count: number;
  total_count: number;
}

/**
 * Every sampler of a run in one request.
 *
 * `GET /test-runs/:id/samplers` reads the sampler rollup in one indexed query. Before it
 * existed both Top 10 tabs looped `/transactions/:name/samples` once per transaction — 314
 * serial calls on a large run, each paying ~3 s for a controller chain the tabs never
 * display (docs/ops/2026-09-17-top10-requests-tab.md).
 *
 * A 404 means the run has no rollup (analysed before the rollup pipeline existed, or its
 * analyze never reached it), and the per-transaction route still has the CAGG and raw
 * paths for that — so the old loop is kept as the fallback. A 202 (rollup being built)
 * takes the same fallback; each per-transaction call then answers 202 too and is skipped,
 * exactly as before.
 */
export async function fetchRunSamplers(testRunId: string, excludeRampUp: boolean): Promise<RunSampler[]> {
  const one = await authenticatedFetch(`/test-runs/${testRunId}/samplers?excludeRampUp=${excludeRampUp}`);
  if (one.status === 200) {
    return one.json();
  }

  const transactionsResponse = await authenticatedFetch(
    `/test-runs/${testRunId}/transactions?excludeRampUp=${excludeRampUp}`,
  );
  if (!transactionsResponse.ok) {
    throw new Error('Failed to fetch transactions');
  }
  const transactions: Array<{ transaction_name: string; scenario_name?: string }> =
    await transactionsResponse.json();

  const all: RunSampler[] = [];
  for (const transaction of transactions) {
    try {
      const response = await authenticatedFetch(
        `/test-runs/${testRunId}/transactions/${encodeURIComponent(transaction.transaction_name)}/samples?excludeRampUp=${excludeRampUp}`,
      );
      if (!response.ok) continue;
      const samplers: Array<Omit<RunSampler, 'transaction_name'>> = await response.json();
      if (!Array.isArray(samplers)) continue; // 202 body is a pending marker, not rows
      for (const sampler of samplers) {
        all.push({ ...sampler, transaction_name: transaction.transaction_name, scenario_name: transaction.scenario_name });
      }
    } catch {
      // Skip failed sampler fetches silently, as the tabs always have.
    }
  }
  return all;
}
