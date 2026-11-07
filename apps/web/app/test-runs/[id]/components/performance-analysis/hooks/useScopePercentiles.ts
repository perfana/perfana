'use client';

import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { NO_SCENARIO_LABEL } from '../components/ScenarioFilter';
import { TransactionStat } from '../types/performance-analysis.types';

export interface PercentileFigures {
  p95_response_time: number;
  p99_response_time: number;
}

export interface ScopePercentiles {
  /** Every execution in the selected scenarios, or in the whole run when none are selected. */
  overall: PercentileFigures | null;
  /** Keyed by the label the card groups on, so a scenario with no name is NO_SCENARIO_LABEL. */
  byScenario: Map<string, PercentileFigures>;
}

/** Null when the API cannot answer: still rolling up (202), or older than this client (404). */
async function readScopePercentiles(url: string): Promise<ScopePercentiles | null> {
  try {
    const response = await authenticatedFetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (response.status !== 200) return null;
    const body: {
      overall?: PercentileFigures | null;
      by_scenario?: Array<PercentileFigures & { scenario_name: string | null }>;
    } = await response.json();
    return {
      overall: body.overall ?? null,
      byScenario: new Map(
        (body.by_scenario ?? []).map((row): [string, PercentileFigures] => [
          row.scenario_name ?? NO_SCENARIO_LABEL,
          row,
        ]),
      ),
    };
  } catch {
    return null;
  }
}

/**
 * True percentiles for the card's tiles and scenario rows. These cannot be derived from
 * `transactions`, and a subset of scenarios can only be merged by the server, so each new set of
 * rows asks for the figures that go with it. The `/transactions` refresh rules stay in
 * usePerformanceAnalysisData: this only follows what they produce.
 *
 * Returns undefined until the current scope has answered, and null when it cannot, so the caller
 * shows nothing rather than a wrong figure while waiting and an honestly labelled weighted figure
 * after. A live refresh keeps the last answer on screen until the next one lands, including when
 * that one fails.
 */
export function useScopePercentiles(
  testRunId: string,
  excludeRampUp: boolean,
  sinceMinutes: number | null,
  selectedScenarios: string[],
  transactions: TransactionStat[],
): ScopePercentiles | null | undefined {
  const params = new URLSearchParams({ excludeRampUp: String(excludeRampUp) });
  if (sinceMinutes != null) params.set('sinceMinutes', String(sinceMinutes));
  selectedScenarios.forEach((scenario) =>
    params.append('scenario', scenario === NO_SCENARIO_LABEL ? '' : scenario),
  );
  const url = `/test-runs/${testRunId}/transactions/percentiles?${params.toString()}`;

  const [answer, setAnswer] = useState<{ url: string; value: ScopePercentiles | null } | null>(null);
  const issued = useRef(0);
  const applied = useRef(0);

  useEffect(() => {
    if (transactions.length === 0) return;
    const seq = ++issued.current;
    void readScopePercentiles(url).then((value) => {
      // Drops only an answer older than one already applied. Waiting for the latest instead would
      // never land anything once answers take longer than the refresh period.
      if (seq < applied.current) return;
      applied.current = seq;
      setAnswer((previous) =>
        value === null && previous?.url === url && previous.value ? previous : { url, value },
      );
    });
  }, [url, transactions]);

  return answer?.url === url ? answer.value : undefined;
}
