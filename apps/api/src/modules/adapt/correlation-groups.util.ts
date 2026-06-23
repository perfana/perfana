export interface SeriesPoint {
  time: number; // epoch ms
  value: number;
}

export interface MetricSeries {
  resultId: string;
  metricName: string;
  dashboardLabel: string;
  dashboardUid: string;
  panelTitle: string;
  conclusionLabel: string | null;
  points: SeriesPoint[];
}

export interface GroupMember {
  resultId: string;
  metricName: string;
  dashboardLabel: string;
  panelTitle: string;
  conclusionLabel: string | null;
  correlationToDriver: number;
}

export interface CorrelationGroup {
  id: string;
  label: string;
  size: number;
  avgCorrelation: number;
  driver: { resultId: string; metricName: string; panelTitle: string };
  members: GroupMember[];
}

export interface UngroupedRegression {
  resultId: string;
  metricName: string;
  dashboardLabel: string;
  panelTitle: string;
  conclusionLabel: string | null;
}

export interface CorrelationGroupsResult {
  groups: CorrelationGroup[];
  ungrouped: UngroupedRegression[];
}

export interface GroupingOptions {
  primary: number;       // |r| >= primary => edge
  metaThreshold: number; // |r| >= metaThreshold AND same dashboardUid => edge
}

const MIN_OVERLAP = 5;

/** Pearson correlation. Returns NaN if either series has zero variance or <2 points. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va === 0 || vb === 0) return NaN;
  return cov / Math.sqrt(va * vb);
}

/** Inner-join two series on time, returning aligned value vectors. */
export function alignSeries(a: SeriesPoint[], b: SeriesPoint[]): [number[], number[]] {
  const bByTime = new Map<number, number>();
  for (const p of b) bByTime.set(p.time, p.value);
  const va: number[] = [], vb: number[] = [];
  for (const p of a) {
    const m = bByTime.get(p.time);
    if (m !== undefined) { va.push(p.value); vb.push(m); }
  }
  return [va, vb];
}

/**
 * Cluster regressed metric series by how strongly they moved together.
 * Hybrid edge rule: |r| >= primary, OR |r| >= metaThreshold when dashboardUid matches.
 */
export function buildCorrelationGroups(
  series: MetricSeries[],
  opts: GroupingOptions,
): CorrelationGroupsResult {
  // ponytail: O(n^2) pairwise — cap at 100 regressed metrics, grouping only the first 100
  // if exceeded. Promote to a real clustering lib only if a run blows past that.
  if (series.length > 100) series = series.slice(0, 100);

  const toUngrouped = (s: MetricSeries): UngroupedRegression => ({
    resultId: s.resultId, metricName: s.metricName,
    dashboardLabel: s.dashboardLabel, panelTitle: s.panelTitle, conclusionLabel: s.conclusionLabel,
  });

  if (series.length < 2) {
    return { groups: [], ungrouped: series.map(toUngrouped) };
  }

  // Pairwise |r| matrix (NaN where no edge-eligible correlation could be computed).
  const m = series.length;
  const corr: number[][] = Array.from({ length: m }, () => new Array(m).fill(NaN));
  const adj: boolean[][] = Array.from({ length: m }, () => new Array(m).fill(false));

  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const [a, b] = alignSeries(series[i].points, series[j].points);
      if (a.length < MIN_OVERLAP) continue;
      const r = pearson(a, b);
      if (Number.isNaN(r)) continue;
      const absR = Math.abs(r);
      corr[i][j] = absR; corr[j][i] = absR;
      const sameUid = series[i].dashboardUid === series[j].dashboardUid;
      const edge = absR >= opts.primary || (sameUid && absR >= opts.metaThreshold);
      adj[i][j] = edge; adj[j][i] = edge;
    }
  }

  // Connected components (BFS).
  const comp = new Array<number>(m).fill(-1);
  let nComp = 0;
  for (let i = 0; i < m; i++) {
    if (comp[i] !== -1) continue;
    const queue = [i];
    comp[i] = nComp;
    while (queue.length) {
      const u = queue.pop()!;
      for (let v = 0; v < m; v++) {
        if (adj[u][v] && comp[v] === -1) { comp[v] = nComp; queue.push(v); }
      }
    }
    nComp++;
  }

  const groups: CorrelationGroup[] = [];
  const ungrouped: UngroupedRegression[] = [];

  for (let c = 0; c < nComp; c++) {
    const idx = series.map((_, i) => i).filter((i) => comp[i] === c);
    if (idx.length < 2) { ungrouped.push(toUngrouped(series[idx[0]])); continue; }

    // Driver = member with the highest mean |r| to the rest of the group.
    // Note: in transitively-connected groups (chains where some pairs lack a direct
    // correlation) the hub may not win the driver election — that is acceptable.
    let driverIdx = idx[0], driverScore = -1;
    const meanToGroup: Record<number, number> = {};
    for (const i of idx) {
      let sum = 0, cnt = 0;
      for (const j of idx) {
        if (i === j) continue;
        const r = corr[i][j];
        if (!Number.isNaN(r)) { sum += r; cnt++; }
      }
      const score = cnt ? sum / cnt : 0;
      meanToGroup[i] = score;
      if (score > driverScore) { driverScore = score; driverIdx = i; }
    }

    const members: GroupMember[] = idx.map((i) => {
      const r = corr[i][driverIdx];
      return {
        resultId: series[i].resultId,
        metricName: series[i].metricName,
        dashboardLabel: series[i].dashboardLabel,
        panelTitle: series[i].panelTitle,
        conclusionLabel: series[i].conclusionLabel,
        correlationToDriver: i === driverIdx
          ? 1
          : (!Number.isNaN(r)
              ? Math.round(r * 1000) / 1000
              // transitive member: no direct edge to driver; use mean |r| to the group as a proxy
              : Math.round((meanToGroup[i] || 0) * 1000) / 1000),
      };
    });

    // avgCorrelation = mean of all within-group pairwise |r| that exist.
    let sum = 0, cnt = 0;
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const r = corr[idx[a]][idx[b]];
        if (!Number.isNaN(r)) { sum += r; cnt++; }
      }
    }

    groups.push({
      id: `group-${c}`,
      label: mostCommonLabel(idx.map((i) => series[i].dashboardLabel)),
      size: idx.length,
      avgCorrelation: cnt ? Math.round((sum / cnt) * 1000) / 1000 : 0,
      driver: { resultId: series[driverIdx].resultId, metricName: series[driverIdx].metricName, panelTitle: series[driverIdx].panelTitle },
      members,
    });
  }

  // Largest, strongest groups first; renumber ids to match output position.
  groups.sort((x, y) => y.size - x.size || y.avgCorrelation - x.avgCorrelation);
  groups.forEach((g, i) => { g.id = `group-${i}`; });
  return { groups, ungrouped };
}

function mostCommonLabel(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  let best = labels[0] ?? '', bestN = 0;
  for (const [l, n] of counts) if (n > bestN) { best = l; bestN = n; }
  return best;
}
