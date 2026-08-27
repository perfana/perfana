'use client';

import { authenticatedFetch } from '@/lib/api';

/**
 * What to do with existing analysis results after an SLO/threshold change.
 * Matches SaveDialogOption in the edit-slo dialog — the same three choices are
 * offered wherever a threshold change invalidates analysis.
 */
export type ReEvaluateOption = 'none' | 'current' | 'all';

export interface ReEvaluationContext {
  /** test_run_id key (not the uuid) — the batch endpoint matches on it. */
  testRunId: string;
  systemUnderTestId?: string;
  testEnvironment?: string;
  workload?: string;
}

/**
 * Queue re-evaluation for the chosen scope. Failures are swallowed on purpose:
 * the threshold write already succeeded, and a failed re-evaluate must not read
 * back as a failed save.
 */
export async function triggerSloReEvaluation(
  option: ReEvaluateOption,
  ctx: ReEvaluationContext,
): Promise<void> {
  if (option === 'none') return;

  try {
    if (option === 'current') {
      await authenticatedFetch('/data/reevaluate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testRunIds: [ctx.testRunId], checks: true, adapt: true }),
      });
      return;
    }

    const { systemUnderTestId, testEnvironment, workload } = ctx;
    if (!systemUnderTestId || !testEnvironment || !workload) return;

    const response = await authenticatedFetch(
      `/test-runs/test-runs-after-changepoint?systemUnderTestId=${encodeURIComponent(systemUnderTestId)}` +
        `&testEnvironment=${encodeURIComponent(testEnvironment)}&workload=${encodeURIComponent(workload)}`,
    );
    if (!response.ok) return;

    const data = await response.json();
    const testRunIds: string[] = data.testRunIds || [];
    if (testRunIds.length === 0) return;

    await authenticatedFetch('/data/reevaluate/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testRunIds, checks: true, adapt: true }),
    });
  } catch (err) {
    // Silent: see doc comment.
  }
}
