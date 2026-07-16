# Top 10 Lists Report Section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `top_10_lists` report section that renders the Performance Analysis "Top 10 lists" (Slowest Avg Response Time, Highest Throughput, Highest Performance Impact, Highest Error Rate) for one scope — transactions, requests, or URLs — in generated reports.

**Architecture:** Server-side renderer following the existing `transaction_response_times` section end-to-end. A new renderer produces report-style HTML tables from data supplied by two new `ReportDataFetcherService` methods that aggregate the pre-computed stat tables (`test_run_transaction_stats`, `test_run_sampler_stats`) — no per-transaction N+1 like the UI. Frontend adds a config form (scope, lists, scenarios, includeUrl) using the standard `SectionConfigShell` (comment box + Preview).

**Tech Stack:** NestJS + TypeORM (raw SQL via `withRequestEm`), React/Next.js + MUI, Jest (API + web).

## Global Constraints

- Section type id uses **underscores**: `top_10_lists` (project convention, per `create-report.dto.ts`).
- One `top_10_lists` section renders **exactly one scope**. No multi-scope in a single section.
- All four dimension lists are selectable; default is **all four on**.
- Renderer must query aggregate stat tables directly — **never** loop `/transactions/:name/samples` (no N+1).
- Derived metric formulas (match `prepareTop10Data`): `errorRate = total>0 ? failed/total*100 : 0`; `throughput = total / duration` (duration `<= 0` → treat as 1); `impact = avgResponseTime * total`.
- `includeUrl` applies only when `scope === 'requests'`; ignored otherwise.
- All SQL goes through the reports module's existing org-filter pattern: `resolveOrgFilter(userId, roles, paramStartIndex, 'tr')` + `withRequestEm(this.testRunRepo).query(...)`, joining `test_runs tr ON tr.test_run_id = ...` (same as `getScenarioDataFromDatabase`).
- Use `report-style.ts` helpers for all HTML (`sectionHeader`, `commentBlock`, `groupHeader`, `emptyState`, `TH_TEXT`, `TH_NUM`, `THEAD_ROW`, `formatNum`, `formatInt`, `formatPercent`, `REPORT_COLORS`) and `this.utils.escapeHtml` for every user/DB string.

---

### Task 1: Register the `top_10_lists` section type

**Files:**
- Modify: `packages/shared/src/entities/report-template.entity.ts:14-24` (`ReportSectionType` union)
- Modify: `packages/shared/src/types/reports.types.ts:542-611` (`REPORT_SECTION_TYPES`, `COMMENTABLE_SECTION_TYPES`, `SECTION_TYPE_LABELS`)
- Modify: `apps/api/src/modules/reports/dto/create-report.dto.ts:25-36` (`REPORT_SECTION_TYPES`)

**Interfaces:**
- Produces: the string literal section type `'top_10_lists'`, recognized everywhere `ReportSectionType` is used. Display label: `'Top 10 Lists'`.

- [ ] **Step 1: Add `'top_10_lists'` to the entity union**

In `packages/shared/src/entities/report-template.entity.ts`, extend the union (add after `'graphs'`):

```typescript
export type ReportSectionType =
  | 'header'
  | 'text_block'
  | 'slo'
  | 'apdex'
  | 'transaction_response_times'
  | 'regressions'
  | 'awr'
  | 'trends'
  | 'comparisons'
  | 'graphs'
  | 'top_10_lists';
```

- [ ] **Step 2: Add to the three runtime lists in `reports.types.ts`**

Append `'top_10_lists'` to `REPORT_SECTION_TYPES` (after `'graphs'`), append `'top_10_lists'` to `COMMENTABLE_SECTION_TYPES` (after `'graphs'`), and add the label to `SECTION_TYPE_LABELS`:

```typescript
// in REPORT_SECTION_TYPES array, after 'graphs',
  'top_10_lists',

// in COMMENTABLE_SECTION_TYPES array, after 'graphs',
  'top_10_lists',

// in SECTION_TYPE_LABELS object, after graphs: 'Custom Graphs',
  top_10_lists: 'Top 10 Lists',
```

- [ ] **Step 3: Add to the API DTO enum**

In `apps/api/src/modules/reports/dto/create-report.dto.ts`, append to `REPORT_SECTION_TYPES` (after `'graphs'`):

```typescript
  'graphs',
  'top_10_lists',
] as const;
```

- [ ] **Step 4: Type-check shared + api to prove exhaustiveness holds**

Run: `cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/shared --filter=@perfana/api`
Expected: PASS. (`SECTION_TYPE_LABELS: Record<ReportSectionType, string>` would fail to compile if the label were missing — this is the test.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/entities/report-template.entity.ts packages/shared/src/types/reports.types.ts apps/api/src/modules/reports/dto/create-report.dto.ts
git commit -m "feat(reports): register top_10_lists section type"
```

---

### Task 2: Data fetcher — `Top10Row`, pure mapper, and two query methods

**Files:**
- Modify: `apps/api/src/modules/reports/services/report-data-fetcher.service.ts` (add exported `Top10Row` interface, exported `mapRawToTop10Rows`, and two methods on the class)
- Create: `apps/api/src/modules/reports/services/report-data-fetcher.top10.spec.ts` (unit test for the pure mapper)

**Interfaces:**
- Produces:
  ```typescript
  export interface Top10Row {
    label: string;            // transaction_name | sampler_name | url pattern
    secondaryLabel?: string;  // url pattern for requests scope
    scenarioName: string;     // 'No Scenario' when empty
    avgResponseTime: number;
    callCount: number;
    errorCount: number;
    errorRate: number;        // 0..100
    throughput: number;       // per second
    impact: number;           // avgResponseTime * callCount
  }
  export function mapRawToTop10Rows(raw: RawTop10Row[], testDuration: number): Top10Row[];
  // on ReportDataFetcherService:
  async getTop10TransactionRows(testRun: TestRun, scenarios: string[], excludeRampUp: boolean, userId?: string, roles?: string[]): Promise<Top10Row[]>;
  async getTop10SamplerRows(testRun: TestRun, scenarios: string[], excludeRampUp: boolean, groupByUrl: boolean, userId?: string, roles?: string[]): Promise<Top10Row[]>;
  ```
- Consumes (Task 1): none directly, but relies on the section type existing.

- [ ] **Step 1: Write the failing test for the pure mapper**

Create `apps/api/src/modules/reports/services/report-data-fetcher.top10.spec.ts`:

```typescript
import { mapRawToTop10Rows } from './report-data-fetcher.service';

describe('mapRawToTop10Rows', () => {
  it('computes errorRate, throughput and impact and normalizes scenario/secondary', () => {
    const rows = mapRawToTop10Rows(
      [
        {
          label: 'GET /api/users',
          secondary_label: '/api/users',
          scenario_name: 'Browse',
          avg_response_time: '200',
          total_count: '100',
          failed_count: '5',
        },
        {
          label: 'POST /login',
          secondary_label: null,
          scenario_name: '',
          avg_response_time: null,
          total_count: '0',
          failed_count: '0',
        },
      ],
      50, // testDuration seconds
    );

    expect(rows[0]).toEqual({
      label: 'GET /api/users',
      secondaryLabel: '/api/users',
      scenarioName: 'Browse',
      avgResponseTime: 200,
      callCount: 100,
      errorCount: 5,
      errorRate: 5,
      throughput: 2, // 100 / 50
      impact: 20000, // 200 * 100
    });
    // empty scenario -> 'No Scenario', null secondary -> undefined, zero count -> 0 rate/throughput
    expect(rows[1].scenarioName).toBe('No Scenario');
    expect(rows[1].secondaryLabel).toBeUndefined();
    expect(rows[1].errorRate).toBe(0);
    expect(rows[1].throughput).toBe(0);
    expect(rows[1].impact).toBe(0);
  });

  it('guards a non-positive duration by treating it as 1', () => {
    const [row] = mapRawToTop10Rows(
      [{ label: 'x', secondary_label: null, scenario_name: 'S', avg_response_time: '10', total_count: '3', failed_count: '0' }],
      0,
    );
    expect(row.throughput).toBe(3); // 3 / 1
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/daniel/workspace/perfana/apps/api && npx jest src/modules/reports/services/report-data-fetcher.top10.spec.ts`
Expected: FAIL — `mapRawToTop10Rows` is not exported.

- [ ] **Step 3: Add the `Top10Row` type, `RawTop10Row` type and the pure mapper**

At the top of `apps/api/src/modules/reports/services/report-data-fetcher.service.ts` (after the existing interface exports, before the `@Injectable()` class), add:

```typescript
/** A single ranked row for the Top 10 Lists report section. */
export interface Top10Row {
  label: string;
  secondaryLabel?: string;
  scenarioName: string;
  avgResponseTime: number;
  callCount: number;
  errorCount: number;
  errorRate: number;
  throughput: number;
  impact: number;
}

/** Raw stat-table row shared by all three Top 10 scopes. */
export interface RawTop10Row {
  label: string;
  secondary_label: string | null;
  scenario_name: string | null;
  avg_response_time: string | number | null;
  total_count: string | number | null;
  failed_count: string | number | null;
}

/** Derive Top10Row metrics from raw stat rows (formulas match prepareTop10Data). */
export function mapRawToTop10Rows(raw: RawTop10Row[], testDuration: number): Top10Row[] {
  const duration = testDuration > 0 ? testDuration : 1;
  return raw.map((r) => {
    const avg = Number(r.avg_response_time) || 0;
    const total = Number(r.total_count) || 0;
    const failed = Number(r.failed_count) || 0;
    const scenario = r.scenario_name && r.scenario_name.length > 0 ? r.scenario_name : 'No Scenario';
    return {
      label: r.label,
      secondaryLabel: r.secondary_label ?? undefined,
      scenarioName: scenario,
      avgResponseTime: avg,
      callCount: total,
      errorCount: failed,
      errorRate: total > 0 ? (failed / total) * 100 : 0,
      throughput: total / duration,
      impact: avg * total,
    };
  });
}
```

- [ ] **Step 4: Run the mapper test to verify it passes**

Run: `cd /Users/daniel/workspace/perfana/apps/api && npx jest src/modules/reports/services/report-data-fetcher.top10.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add the two query methods to the class**

Add these methods inside the `ReportDataFetcherService` class (e.g. after `getScenarioDataFromDatabase`). They reuse the existing private `resolveOrgFilter` and `this.testRunRepo`:

```typescript
  /**
   * Ranked transaction rows for the Top 10 Lists section (transactions scope).
   * Aggregated per (transaction, scenario) from test_run_transaction_stats.
   */
  async getTop10TransactionRows(
    testRun: TestRun,
    scenarios: string[],
    excludeRampUp: boolean,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Top10Row[]> {
    const params: unknown[] = [testRun.testRunId, excludeRampUp];
    let scenarioClause = '';
    if (scenarios.length > 0) {
      params.push(scenarios);
      scenarioClause = `AND COALESCE(NULLIF(trs.scenario_name, ''), 'No Scenario') = ANY($${params.length})`;
    }
    const orgFilter = await this.resolveOrgFilter(userId, roles, params.length + 1, 'tr');
    params.push(...orgFilter.params);

    const query = `
      SELECT
        trs.transaction_name        AS label,
        NULL::text                  AS secondary_label,
        trs.scenario_name,
        trs.avg_response_time,
        trs.total_count,
        trs.failed_count
      FROM test_run_transaction_stats trs
      JOIN test_runs tr ON tr.test_run_id = trs.test_run_id
      WHERE trs.test_run_id = $1
        AND trs.ramp_up_excluded = $2
        AND trs.total_count > 0
        ${scenarioClause}
        ${orgFilter.clause}
    `;
    const rows: RawTop10Row[] = await withRequestEm(this.testRunRepo).query(query, params);
    return mapRawToTop10Rows(rows, testRun.duration ?? 1);
  }

  /**
   * Ranked sampler rows for the Top 10 Lists section (requests / urls scope).
   * requests: one row per sampler, url pattern as secondary_label.
   * urls (groupByUrl): aggregated per (url pattern, scenario), weighted avg RT.
   */
  async getTop10SamplerRows(
    testRun: TestRun,
    scenarios: string[],
    excludeRampUp: boolean,
    groupByUrl: boolean,
    userId: string = '',
    roles: string[] = [],
  ): Promise<Top10Row[]> {
    const params: unknown[] = [testRun.testRunId, excludeRampUp];
    let scenarioClause = '';
    if (scenarios.length > 0) {
      params.push(scenarios);
      scenarioClause = `AND COALESCE(NULLIF(trss.scenario_name, ''), 'No Scenario') = ANY($${params.length})`;
    }
    const orgFilter = await this.resolveOrgFilter(userId, roles, params.length + 1, 'tr');
    params.push(...orgFilter.params);

    const urlExpr = `COALESCE(LOWER(up.normalized_url), trss.sampler_name)`;
    const query = groupByUrl
      ? `
        SELECT
          ${urlExpr}                 AS label,
          NULL::text                 AS secondary_label,
          trss.scenario_name,
          ROUND((SUM(trss.avg_response_time * trss.total_count) / NULLIF(SUM(trss.total_count), 0))::numeric, 2) AS avg_response_time,
          SUM(trss.total_count)      AS total_count,
          SUM(trss.failed_count)     AS failed_count
        FROM test_run_sampler_stats trss
        JOIN test_runs tr ON tr.test_run_id = trss.test_run_id
        LEFT JOIN url_patterns up
          ON  up.url_hash          = trss.url_hash
          AND up.system_under_test = trss.system_under_test
          AND up.test_environment  = trss.test_environment
        WHERE trss.test_run_id = $1
          AND trss.ramp_up_excluded = $2
          AND trss.total_count > 0
          ${scenarioClause}
          ${orgFilter.clause}
        GROUP BY label, trss.scenario_name
      `
      : `
        SELECT
          trss.sampler_name          AS label,
          LOWER(up.normalized_url)   AS secondary_label,
          trss.scenario_name,
          trss.avg_response_time,
          trss.total_count,
          trss.failed_count
        FROM test_run_sampler_stats trss
        JOIN test_runs tr ON tr.test_run_id = trss.test_run_id
        LEFT JOIN url_patterns up
          ON  up.url_hash          = trss.url_hash
          AND up.system_under_test = trss.system_under_test
          AND up.test_environment  = trss.test_environment
        WHERE trss.test_run_id = $1
          AND trss.ramp_up_excluded = $2
          AND trss.total_count > 0
          ${scenarioClause}
          ${orgFilter.clause}
      `;
    const rows: RawTop10Row[] = await withRequestEm(this.testRunRepo).query(query, params);
    return mapRawToTop10Rows(rows, testRun.duration ?? 1);
  }
```

- [ ] **Step 6: Type-check the api package**

Run: `cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/reports/services/report-data-fetcher.service.ts apps/api/src/modules/reports/services/report-data-fetcher.top10.spec.ts
git commit -m "feat(reports): top-10 data fetcher rows + mapper"
```

---

### Task 3: The `top-10-lists-renderer`

**Files:**
- Create: `apps/api/src/modules/reports/renderers/top-10-lists-renderer.ts`
- Create: `apps/api/src/modules/reports/renderers/top-10-lists-renderer.spec.ts`

**Interfaces:**
- Consumes (Task 2): `Top10Row`, `ReportDataFetcherService.getTop10TransactionRows`, `getTop10SamplerRows`.
- Produces: `@Injectable() class Top10ListsRenderer` with `async renderTop10ListsSection(section: ReportSectionConfig, testRun: TestRun | null, userId?: string, roles?: string[]): Promise<string>`.

- [ ] **Step 1: Write the failing renderer test**

Create `apps/api/src/modules/reports/renderers/top-10-lists-renderer.spec.ts`:

```typescript
import { Top10ListsRenderer } from './top-10-lists-renderer';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, Top10Row } from '../services/report-data-fetcher.service';
import { TestRun, ReportSectionConfig } from '@perfana/shared';

const utils = new ReportUtilsService();

const makeRows = (): Top10Row[] => [
  { label: 'GET /a', secondaryLabel: '/a', scenarioName: 'Browse', avgResponseTime: 300, callCount: 100, errorCount: 10, errorRate: 10, throughput: 2, impact: 30000 },
  { label: 'GET /b', secondaryLabel: '/b', scenarioName: 'Browse', avgResponseTime: 100, callCount: 500, errorCount: 0, errorRate: 0, throughput: 10, impact: 50000 },
];

const testRun = { testRunId: 'tr-1', duration: 50 } as TestRun;

function makeRenderer(rows: Top10Row[]) {
  const fetcher = {
    getTop10TransactionRows: jest.fn().mockResolvedValue(rows),
    getTop10SamplerRows: jest.fn().mockResolvedValue(rows),
  } as unknown as ReportDataFetcherService;
  return { renderer: new Top10ListsRenderer(utils, fetcher), fetcher };
}

describe('Top10ListsRenderer', () => {
  it('renders all four lists by default for the transactions scope', async () => {
    const { renderer, fetcher } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: {} } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(fetcher.getTop10TransactionRows).toHaveBeenCalled();
    expect(html).toContain('Slowest Average Response Times');
    expect(html).toContain('Highest Throughput');
    expect(html).toContain('Highest Performance Impact');
    expect(html).toContain('Highest Error Rate');
    // impact ordering: /b (50000) before /a (30000)
    expect(html.indexOf('GET /b')).toBeLessThan(html.indexOf('GET /a'));
  });

  it('renders only the selected lists', async () => {
    const { renderer } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: { lists: ['slowest'] } } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(html).toContain('Slowest Average Response Times');
    expect(html).not.toContain('Highest Throughput');
  });

  it('uses the sampler fetcher for the requests scope and shows the url line when includeUrl is on', async () => {
    const { renderer, fetcher } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: { scope: 'requests', includeUrl: true, lists: ['slowest'] } } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(fetcher.getTop10SamplerRows).toHaveBeenCalledWith(testRun, [], true, false, '', []);
    expect(html).toContain('/a'); // secondary url line rendered
  });

  it('passes groupByUrl=true for the urls scope', async () => {
    const { renderer, fetcher } = makeRenderer(makeRows());
    const section = { type: 'top_10_lists', order: 0, config: { scope: 'urls', lists: ['slowest'] } } as ReportSectionConfig;
    await renderer.renderTop10ListsSection(section, testRun);
    expect(fetcher.getTop10SamplerRows).toHaveBeenCalledWith(testRun, [], true, true, '', []);
  });

  it('renders an empty state when there are no rows', async () => {
    const { renderer } = makeRenderer([]);
    const section = { type: 'top_10_lists', order: 0, config: {} } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(html.toLowerCase()).toContain('no transactions data');
  });

  it('escapes labels', async () => {
    const { renderer } = makeRenderer([
      { label: '<script>', scenarioName: 'S', avgResponseTime: 1, callCount: 1, errorCount: 0, errorRate: 0, throughput: 1, impact: 1 },
    ]);
    const section = { type: 'top_10_lists', order: 0, config: { lists: ['slowest'] } } as ReportSectionConfig;
    const html = await renderer.renderTop10ListsSection(section, testRun);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/daniel/workspace/perfana/apps/api && npx jest src/modules/reports/renderers/top-10-lists-renderer.spec.ts`
Expected: FAIL — cannot find module `./top-10-lists-renderer`.

- [ ] **Step 3: Write the renderer**

Create `apps/api/src/modules/reports/renderers/top-10-lists-renderer.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { TestRun, ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportDataFetcherService, Top10Row } from '../services/report-data-fetcher.service';
import {
  REPORT_COLORS,
  TH_NUM,
  TH_TEXT,
  THEAD_ROW,
  sectionHeader,
  commentBlock,
  groupHeader,
  emptyState,
  formatInt,
  formatNum,
  formatPercent,
} from './report-style';

type Scope = 'transactions' | 'requests' | 'urls';
type ListKey = 'slowest' | 'throughput' | 'impact' | 'error_rate';

interface ListDef {
  key: ListKey;
  title: string;
  valueOf: (r: Top10Row) => number;
  format: (v: number) => string;
  showErrorCount: boolean;
}

const SCOPE_LABELS: Record<Scope, string> = {
  transactions: 'transactions',
  requests: 'requests',
  urls: 'URLs',
};

const LIST_DEFS: ListDef[] = [
  { key: 'slowest', title: 'Slowest Average Response Times', valueOf: (r) => r.avgResponseTime, format: (v) => `${formatNum(v)} ms`, showErrorCount: false },
  { key: 'throughput', title: 'Highest Throughput', valueOf: (r) => r.throughput, format: (v) => `${formatNum(v)}/s`, showErrorCount: false },
  { key: 'impact', title: 'Highest Performance Impact', valueOf: (r) => r.impact, format: (v) => formatNum(v), showErrorCount: false },
  { key: 'error_rate', title: 'Highest Error Rate', valueOf: (r) => r.errorRate, format: (v) => formatPercent(v), showErrorCount: true },
];

/**
 * Renderer for the Top 10 Lists section — mirrors Performance Analysis Top 10
 * lists for one scope (transactions | requests | urls).
 */
@Injectable()
export class Top10ListsRenderer {
  constructor(
    private readonly utils: ReportUtilsService,
    private readonly dataFetcher: ReportDataFetcherService,
  ) {}

  async renderTop10ListsSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    const config = section.config || {};
    const scope: Scope = ['transactions', 'requests', 'urls'].includes(config.scope as string)
      ? (config.scope as Scope)
      : 'transactions';
    const scenarios = Array.isArray(config.scenarios) ? (config.scenarios as string[]) : [];
    const excludeRampUp = config.excludeRampUp !== false; // default true
    const includeUrl = scope === 'requests' && config.includeUrl === true;
    const requestedLists = Array.isArray(config.lists) ? (config.lists as ListKey[]) : [];
    const enabledDefs = requestedLists.length > 0
      ? LIST_DEFS.filter((d) => requestedLists.includes(d.key))
      : LIST_DEFS;
    const title = section.title || 'Top 10 Lists';
    const comment = section.comment;

    const rows = testRun ? await this.fetchRows(scope, testRun, scenarios, excludeRampUp, userId, roles) : [];

    const header = `${sectionHeader(title)}${commentBlock(comment)}`;

    if (rows.length === 0) {
      return `<section class="top-10-lists-section">${header}${emptyState(`No ${SCOPE_LABELS[scope]} data available for this test run.`)}</section>`;
    }

    const body = enabledDefs
      .map((def) => this.renderList(def, rows, scope, includeUrl))
      .join('');

    return `<section class="top-10-lists-section">${header}${body}</section>`;
  }

  private fetchRows(
    scope: Scope,
    testRun: TestRun,
    scenarios: string[],
    excludeRampUp: boolean,
    userId: string,
    roles: string[],
  ): Promise<Top10Row[]> {
    if (scope === 'transactions') {
      return this.dataFetcher.getTop10TransactionRows(testRun, scenarios, excludeRampUp, userId, roles);
    }
    return this.dataFetcher.getTop10SamplerRows(testRun, scenarios, excludeRampUp, scope === 'urls', userId, roles);
  }

  private renderList(def: ListDef, rows: Top10Row[], scope: Scope, includeUrl: boolean): string {
    const nameHeader = scope === 'urls' ? 'URL' : scope === 'requests' ? 'Request' : 'Transaction';
    const top = [...rows].sort((a, b) => def.valueOf(b) - def.valueOf(a)).slice(0, 10);

    const bodyRows = top
      .map((r, idx) => {
        const rowBg = idx % 2 === 1 ? '#fbfcfd' : '#ffffff';
        const cell = `padding: 12px 16px; border-bottom: 1px solid ${REPORT_COLORS.rowBorder};`;
        const numCell = `${cell} text-align: right; font-variant-numeric: tabular-nums;`;
        const secondary =
          includeUrl && r.secondaryLabel
            ? `<div style="font-size: 11px; color: ${REPORT_COLORS.mutedInk}; margin-top: 2px;">${this.utils.escapeHtml(r.secondaryLabel)}</div>`
            : '';
        const errorCol = def.showErrorCount
          ? `<td style="${numCell}">${formatInt(r.errorCount)}</td>`
          : '';
        return `
      <tr style="background: ${rowBg};">
        <td style="${cell}">${this.utils.escapeHtml(r.label)}${secondary}</td>
        <td style="${cell}">${this.utils.escapeHtml(r.scenarioName)}</td>
        <td style="${numCell} font-weight: 600;">${def.format(def.valueOf(r))}</td>
        <td style="${numCell}">${formatInt(r.callCount)}</td>
        ${errorCol}
      </tr>`;
      })
      .join('');

    const errorHeader = def.showErrorCount ? `<th style="${TH_NUM}">Errors</th>` : '';

    return `
      <div style="margin-top: 24px;">
        ${groupHeader(def.title)}
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="${THEAD_ROW}">
              <th style="${TH_TEXT}">${nameHeader}</th>
              <th style="${TH_TEXT}">Scenario</th>
              <th style="${TH_NUM}">Value</th>
              <th style="${TH_NUM}">Count</th>
              ${errorHeader}
            </tr>
          </thead>
          <tbody style="background: white;">${bodyRows}</tbody>
        </table>
      </div>`;
  }
}
```

- [ ] **Step 4: Run the renderer test to verify it passes**

Run: `cd /Users/daniel/workspace/perfana/apps/api && npx jest src/modules/reports/renderers/top-10-lists-renderer.spec.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reports/renderers/top-10-lists-renderer.ts apps/api/src/modules/reports/renderers/top-10-lists-renderer.spec.ts
git commit -m "feat(reports): top-10-lists renderer"
```

---

### Task 4: Wire the renderer into the compiler + module

**Files:**
- Modify: `apps/api/src/modules/reports/services/report-html-compiler.service.ts` (import, constructor injection, dispatch `case`)
- Modify: `apps/api/src/modules/reports/reports.module.ts` (import + provider)
- Modify: `apps/api/src/modules/reports/services/report-html-compiler.service.spec.ts` (add a routing test if the spec exists; otherwise skip this file edit)

**Interfaces:**
- Consumes (Task 3): `Top10ListsRenderer.renderTop10ListsSection(section, testRun, userId, roles)`.

- [ ] **Step 1: Add the dispatch test (only if the compiler spec exists)**

Check: `ls apps/api/src/modules/reports/services/report-html-compiler.service.spec.ts`. If it exists, add a test mirroring an existing renderer-routing test (e.g. how `transaction_response_times` is asserted) that a `{ type: 'top_10_lists' }` section calls `top10ListsRenderer.renderTop10ListsSection`. If the spec does not exist, skip to Step 2 (the renderer already has direct coverage in Task 3).

- [ ] **Step 2: Import and inject the renderer**

In `apps/api/src/modules/reports/services/report-html-compiler.service.ts`, add the import next to the other renderer imports (after the `GraphsRenderer` import, line ~13):

```typescript
import { Top10ListsRenderer } from '../renderers/top-10-lists-renderer';
```

Add to the constructor parameter list (after `graphsRenderer`, before `placeholderRenderer`):

```typescript
    private readonly top10ListsRenderer: Top10ListsRenderer,
```

- [ ] **Step 3: Add the dispatch case**

In the `switch (section.type)` block (the method that returns `case 'graphs': ...`), add before the `default:` branch:

```typescript
      case 'top_10_lists':
        return await this.top10ListsRenderer.renderTop10ListsSection(section, testRun, userId, roles);
```

- [ ] **Step 4: Register the provider in the module**

In `apps/api/src/modules/reports/reports.module.ts`, add the import (after the `GraphsRenderer` import, line ~32):

```typescript
import { Top10ListsRenderer } from './renderers/top-10-lists-renderer';
```

Add `Top10ListsRenderer,` to the `providers` array (after `GraphsRenderer,`, before `PlaceholderRenderer,`).

- [ ] **Step 5: Type-check + run the reports module tests**

Run: `cd /Users/daniel/workspace/perfana/apps/api && npx jest src/modules/reports && cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/reports/services/report-html-compiler.service.ts apps/api/src/modules/reports/reports.module.ts apps/api/src/modules/reports/services/report-html-compiler.service.spec.ts
git commit -m "feat(reports): wire top_10_lists renderer into compiler + module"
```

---

### Task 5: Frontend config form (`Top10ListsConfigForm`)

**Files:**
- Modify: `apps/web/lib/api/reports.ts` (web-local `REPORT_SECTION_TYPES`, `COMMENTABLE_SECTION_TYPES`, `getSectionTypeLabel` labels map)
- Modify: `apps/web/components/reports/report-generation/SectionConfigs.tsx` (add `Top10ListsConfig` interface + `Top10ListsConfigForm` export)
- Modify: `apps/web/components/reports/report-generation/SectionConfigs.spec.tsx` (add form tests)

> **Prerequisite (do this first — Step 0):** `apps/web` does NOT import `ReportSectionType` from `@perfana/shared`; it maintains its **own** copy in `apps/web/lib/api/reports.ts`. The web `SECTION_CONFIG` (Task 6), the config-form dispatch (Task 6), and `section-summary` (Task 7) all key off this web-local type, so it must include `top_10_lists` or those tasks will not compile.

**Interfaces:**
- Produces:
  ```typescript
  export interface Top10ListsConfig {
    scope?: 'transactions' | 'requests' | 'urls';
    lists?: Array<'slowest' | 'throughput' | 'impact' | 'error_rate'>;
    scenarios?: string[];
    excludeRampUp?: boolean;
    includeUrl?: boolean;
    comment?: string;
  }
  export function Top10ListsConfigForm(props: { config: Top10ListsConfig; onChange: (c: Top10ListsConfig) => void; testRunId?: string }): JSX.Element;
  ```
- Consumes: `SectionConfigShell` (already in this file), `authenticatedFetch` (already imported), MUI `Select`, `MenuItem`, `Checkbox`, `ListItemText`, `FormControlLabel`, `Switch`, `OutlinedInput`.

- [ ] **Step 0: Register `top_10_lists` in the web-local section-type registry**

In `apps/web/lib/api/reports.ts`: append `'top_10_lists'` to `REPORT_SECTION_TYPES` (after `'graphs'`, ~line 28) and to `COMMENTABLE_SECTION_TYPES`, and add `top_10_lists: 'Top 10 Lists',` to the `labels` map inside `getSectionTypeLabel` (it is typed `Record<ReportSectionType, string>`, so this is compiler-enforced). This mirrors Task 1's shared-side registration for the web's independent copy.

- [ ] **Step 1: Write the failing form tests**

In `apps/web/components/reports/report-generation/SectionConfigs.spec.tsx`, add (mock `authenticatedFetch` the same way existing tests in this file do — reuse the file's existing mock; if scenarios are fetched, return `[]` so the component still renders):

```tsx
import { Top10ListsConfigForm } from './SectionConfigs';

describe('Top10ListsConfigForm', () => {
  it('renders the scope selector and hides includeUrl unless scope is requests', () => {
    render(<Top10ListsConfigForm config={{}} onChange={() => {}} testRunId="tr-1" />);
    expect(screen.getByText(/scope/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/show url/i)).not.toBeInTheDocument();
  });

  it('shows the includeUrl toggle when scope is requests', () => {
    render(<Top10ListsConfigForm config={{ scope: 'requests' }} onChange={() => {}} testRunId="tr-1" />);
    expect(screen.getByLabelText(/show url/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/daniel/workspace/perfana/apps/web && npx jest components/reports/report-generation/SectionConfigs.spec.tsx -t Top10ListsConfigForm`
Expected: FAIL — `Top10ListsConfigForm` is not exported.

- [ ] **Step 3: Add the config interface + form**

In `apps/web/components/reports/report-generation/SectionConfigs.tsx`, after the Transaction Response Times section (around line 570), add. Ensure `Checkbox`, `ListItemText`, `OutlinedInput` are imported from `@mui/material` at the top of the file (add any that are missing to the existing MUI import):

```tsx
// ==================== Top 10 Lists Config ====================

const TOP10_LIST_OPTIONS: Array<{ key: NonNullable<Top10ListsConfig['lists']>[number]; label: string }> = [
  { key: 'slowest', label: 'Slowest Average Response Times' },
  { key: 'throughput', label: 'Highest Throughput' },
  { key: 'impact', label: 'Highest Performance Impact' },
  { key: 'error_rate', label: 'Highest Error Rate' },
];

const ALL_TOP10_LIST_KEYS = TOP10_LIST_OPTIONS.map((o) => o.key);

/** @public */
export interface Top10ListsConfig {
  scope?: 'transactions' | 'requests' | 'urls';
  lists?: Array<'slowest' | 'throughput' | 'impact' | 'error_rate'>;
  scenarios?: string[];
  excludeRampUp?: boolean;
  includeUrl?: boolean;
  comment?: string;
}

interface Top10ListsConfigFormProps {
  config: Top10ListsConfig;
  onChange: (config: Top10ListsConfig) => void;
  testRunId?: string;
}

export function Top10ListsConfigForm({ config, onChange, testRunId }: Top10ListsConfigFormProps) {
  const [scenarios, setScenarios] = useState<string[]>([]);

  useEffect(() => {
    if (!testRunId) return;
    const fetchScenarios = async () => {
      try {
        const response = await authenticatedFetch(`/test-runs/${testRunId}/transactions`, { method: 'GET' });
        if (!response.ok) return;
        const transactions = await response.json();
        if (!Array.isArray(transactions)) return;
        const unique = Array.from(
          new Set(transactions.map((t: { scenario_name?: string }) => t.scenario_name).filter(Boolean)),
        );
        setScenarios(unique as string[]);
      } catch {
        setScenarios([]);
      }
    };
    fetchScenarios();
  }, [testRunId]);

  const scope = config.scope ?? 'transactions';
  const selectedLists = config.lists && config.lists.length > 0 ? config.lists : ALL_TOP10_LIST_KEYS;
  const selectedScenarios = config.scenarios ?? [];

  return (
    <SectionConfigShell
      sectionTitle="Top 10 Lists"
      sectionType="Top 10 Lists"
      previewType="top_10_lists"
      previewConfig={config}
      comment={config.comment}
      onCommentChange={(comment) => onChange({ ...config, comment })}
      testRunId={testRunId}
    >
      {/* Scope */}
      <Typography variant="caption" color="text.secondary">Scope</Typography>
      <Select
        value={scope}
        onChange={(e) => onChange({ ...config, scope: e.target.value as Top10ListsConfig['scope'] })}
        fullWidth
        size="small"
      >
        <MenuItem value="transactions">Transactions</MenuItem>
        <MenuItem value="requests">Requests</MenuItem>
        <MenuItem value="urls">URLs</MenuItem>
      </Select>

      {/* Lists (multi-select) */}
      <Typography variant="caption" color="text.secondary">Lists to include</Typography>
      <Select
        multiple
        value={selectedLists}
        onChange={(e) => {
          const value = e.target.value as Top10ListsConfig['lists'];
          onChange({ ...config, lists: Array.isArray(value) ? value : [] });
        }}
        input={<OutlinedInput />}
        renderValue={(selected) =>
          TOP10_LIST_OPTIONS.filter((o) => (selected as string[]).includes(o.key)).map((o) => o.label).join(', ')
        }
        fullWidth
        size="small"
      >
        {TOP10_LIST_OPTIONS.map((o) => (
          <MenuItem key={o.key} value={o.key}>
            <Checkbox checked={selectedLists.includes(o.key)} />
            <ListItemText primary={o.label} />
          </MenuItem>
        ))}
      </Select>

      {/* Scenarios (multi-select; empty = all) */}
      {scenarios.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary">Scenarios (empty = all)</Typography>
          <Select
            multiple
            value={selectedScenarios}
            onChange={(e) => {
              const value = e.target.value as string[];
              onChange({ ...config, scenarios: typeof value === 'string' ? [value] : value });
            }}
            input={<OutlinedInput />}
            renderValue={(selected) => (selected as string[]).join(', ') || 'All scenarios'}
            fullWidth
            size="small"
          >
            {scenarios.map((s) => (
              <MenuItem key={s} value={s}>
                <Checkbox checked={selectedScenarios.includes(s)} />
                <ListItemText primary={s} />
              </MenuItem>
            ))}
          </Select>
        </>
      )}

      {/* includeUrl — requests scope only, mirrors the Compare/Perf-Analysis URL toggle */}
      {scope === 'requests' && (
        <FormControlLabel
          control={
            <Switch
              checked={config.includeUrl ?? false}
              onChange={(e) => onChange({ ...config, includeUrl: e.target.checked })}
            />
          }
          label="Show URL"
        />
      )}
    </SectionConfigShell>
  );
}
```

- [ ] **Step 4: Run the form tests to verify they pass**

Run: `cd /Users/daniel/workspace/perfana/apps/web && npx jest components/reports/report-generation/SectionConfigs.spec.tsx -t Top10ListsConfigForm`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/reports/report-generation/SectionConfigs.tsx apps/web/components/reports/report-generation/SectionConfigs.spec.tsx
git commit -m "feat(web): top_10_lists section config form"
```

---

### Task 6: Palette entry + config-form dispatch in `GenerateReportDialog`

**Files:**
- Modify: `apps/web/components/reports/report-generation/GenerateReportDialog.tsx` (import form, `SECTION_CONFIG` entry, `renderConfigForm` case, icon import)

**Interfaces:**
- Consumes (Task 5): `Top10ListsConfigForm`.

- [ ] **Step 1: Import the form and an icon**

In `apps/web/components/reports/report-generation/GenerateReportDialog.tsx`, add `Top10ListsConfigForm,` to the existing import block from `./SectionConfigs` (after `ComparisonsConfigForm,`, ~line 82). Add an icon import near the other `@mui/icons-material` imports:

```tsx
import { FormatListNumbered as ListNumberedIcon } from '@mui/icons-material';
```

- [ ] **Step 2: Add the `SECTION_CONFIG` palette entry**

In the `SECTION_CONFIG: Record<ReportSectionType, {...}>` object (starts ~line 113), add after the `graphs` entry:

```tsx
  top_10_lists: {
    icon: <ListNumberedIcon />,
    label: 'Top 10 Lists',
    description: 'Ranked top-10 lists (slowest, throughput, impact, error rate) for transactions, requests, or URLs',
    color: '#ff9800',
  },
```

- [ ] **Step 3: Add the dispatch case in `renderConfigForm`**

In `renderConfigForm()` (the `switch` around line 918), add before the `default`/closing:

```tsx
      case 'top_10_lists':
        return <Top10ListsConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
```

- [ ] **Step 4: Type-check the web package (proves `SECTION_CONFIG` Record is exhaustive)**

Run: `cd /Users/daniel/workspace/perfana && npx turbo run type-check --filter=@perfana/web`
Expected: PASS. (A missing `SECTION_CONFIG` key would fail the `Record<ReportSectionType, …>` type.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/reports/report-generation/GenerateReportDialog.tsx
git commit -m "feat(web): add top_10_lists to section palette + config dispatch"
```

---

### Task 7: Collapsed-header summary

**Files:**
- Modify: `apps/web/components/reports/report-generation/section-summary.ts` (add `top_10_lists` case + import type)
- Modify: `apps/web/components/reports/report-generation/section-summary.spec.ts` (add test)

**Interfaces:**
- Consumes (Task 5): `Top10ListsConfig`.

- [ ] **Step 1: Write the failing summary test**

In `apps/web/components/reports/report-generation/section-summary.spec.ts`, add:

```typescript
it('summarizes a top_10_lists section by scope and list count', () => {
  expect(
    sectionSummary({ type: 'top_10_lists', order: 0, config: { scope: 'requests', lists: ['slowest', 'impact'] } } as never),
  ).toBe('Requests · 2 lists');
});

it('defaults top_10_lists to all four lists when none selected', () => {
  expect(
    sectionSummary({ type: 'top_10_lists', order: 0, config: { scope: 'urls' } } as never),
  ).toBe('URLs · 4 lists');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/daniel/workspace/perfana/apps/web && npx jest components/reports/report-generation/section-summary.spec.ts -t top_10_lists`
Expected: FAIL — falls through to the default `comment` branch (returns null), not the scope string.

- [ ] **Step 3: Add the summary case**

In `apps/web/components/reports/report-generation/section-summary.ts`, add `Top10ListsConfig` to the type import from `./SectionConfigs`, and add a case before `default:`:

```typescript
    case 'top_10_lists': {
      const cfg = (section.config ?? {}) as Top10ListsConfig;
      const scopeLabel =
        cfg.scope === 'requests' ? 'Requests' : cfg.scope === 'urls' ? 'URLs' : 'Transactions';
      const count = Array.isArray(cfg.lists) && cfg.lists.length > 0 ? cfg.lists.length : 4;
      return `${scopeLabel} · ${count} list${count === 1 ? '' : 's'}`;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/daniel/workspace/perfana/apps/web && npx jest components/reports/report-generation/section-summary.spec.ts -t top_10_lists`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/reports/report-generation/section-summary.ts apps/web/components/reports/report-generation/section-summary.spec.ts
git commit -m "feat(web): collapsed summary for top_10_lists section"
```

---

## Final verification (after all tasks)

- [ ] **Full gates:** `cd /Users/daniel/workspace/perfana && npm run type-check && npm run lint && npx jest --config apps/api/jest.config.js src/modules/reports && cd apps/web && npx jest components/reports` — all PASS.
- [ ] **Manual smoke:** run `npm run dev`, open a test run's report generation dialog, add a "Top 10 Lists" section, switch scope to Requests, toggle "Show URL", click Preview — the section renders four (or selected) ranked tables; requests scope shows the URL under each request name.
- [ ] **Version bump + PR** per the repo workflow (bump `VERSION` patch, push branch `feat/report-top-10-lists-section`, open PR).

## Spec coverage check

- Top 10 lists in reports → Tasks 3 (renderer), 4 (wiring).
- Standard elements (comment box + preview) → Task 5 uses `SectionConfigShell`.
- Configure which lists → Task 5 `lists` multi-select; Task 3 filters.
- Configure which scenarios → Task 5 `scenarios` multi-select; Task 2 SQL scenario filter.
- Configure scope (transactions/requests/urls) → Task 5 `scope`; Task 2 two fetchers; Task 3 dispatch.
- Requests → toggle to include URLs, compare-card style → Task 5 `includeUrl` (requests only); Task 3 secondary muted line.
- Report style guide → Task 3 uses `report-style.ts` helpers exclusively.
