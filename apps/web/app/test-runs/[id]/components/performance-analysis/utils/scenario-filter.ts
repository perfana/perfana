import { TransactionStat, ThroughputStats, VirtualUserStats } from '../types/performance-analysis.types';
import { NO_SCENARIO_LABEL } from '../components/ScenarioFilter';

const normalize = (scenarioName?: string | null): string =>
  scenarioName && scenarioName.length > 0 ? scenarioName : NO_SCENARIO_LABEL;

export function matchesSelectedScenarios(
  scenarioName: string | null | undefined,
  selectedScenarios: string[],
): boolean {
  if (selectedScenarios.length === 0) return true;
  return selectedScenarios.includes(normalize(scenarioName));
}

export function deriveAvailableScenarios(transactions: TransactionStat[]): string[] {
  const hasNull = transactions.some((t) => !t.scenario_name);
  const named = new Set<string>();
  transactions.forEach((t) => {
    if (t.scenario_name) named.add(t.scenario_name);
  });
  const sortedNamed = Array.from(named).sort((a, b) => a.localeCompare(b));
  return hasNull ? [...sortedNamed, NO_SCENARIO_LABEL] : sortedNamed;
}

export function filterThroughputStats(
  stats: ThroughputStats | null,
  selectedScenarios: string[],
): ThroughputStats | null {
  if (!stats || selectedScenarios.length === 0) return stats;

  const filteredBy = stats.by_scenario.filter((entry) =>
    selectedScenarios.includes(normalize(entry.scenario_name)),
  );

  return {
    overall: {
      peak_transactions_per_second: filteredBy.reduce(
        (sum, e) => sum + (e.peak_transactions_per_second || 0),
        0,
      ),
      peak_requests_per_second: filteredBy.reduce(
        (sum, e) => sum + (e.peak_requests_per_second || 0),
        0,
      ),
    },
    by_scenario: filteredBy,
  };
}

export function filterVirtualUserStats(
  stats: VirtualUserStats | null,
  selectedScenarios: string[],
): VirtualUserStats | null {
  if (!stats || selectedScenarios.length === 0) return stats;

  const filteredBy = stats.by_scenario.filter((entry) =>
    selectedScenarios.includes(normalize(entry.scenario_name)),
  );

  const totalDataPoints = filteredBy.reduce((sum, e) => sum + (e.total_data_points || 0), 0);
  const weightedAvg = (field: 'avg_active_threads' | 'avg_started_threads' | 'avg_finished_threads') =>
    totalDataPoints > 0
      ? filteredBy.reduce((sum, e) => sum + (e[field] || 0) * (e.total_data_points || 0), 0) /
        totalDataPoints
      : 0;

  return {
    overall: {
      peak_active_threads: filteredBy.reduce(
        (sum, e) => sum + (e.peak_active_threads || 0),
        0,
      ),
      avg_active_threads: weightedAvg('avg_active_threads'),
      peak_started_threads: filteredBy.reduce(
        (sum, e) => sum + (e.peak_started_threads || 0),
        0,
      ),
      avg_started_threads: weightedAvg('avg_started_threads'),
      peak_finished_threads: filteredBy.reduce(
        (sum, e) => sum + (e.peak_finished_threads || 0),
        0,
      ),
      avg_finished_threads: weightedAvg('avg_finished_threads'),
      total_data_points: totalDataPoints,
    },
    by_scenario: filteredBy,
  };
}
