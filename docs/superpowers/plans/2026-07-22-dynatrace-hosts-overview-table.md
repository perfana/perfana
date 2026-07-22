# Dynatrace Hosts Overview Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Dynatrace card's per-host tab strip with an overview table (avg CPU %, avg memory %, problem flag per host) whose rows drill into the existing `HostDetailPanel`.

**Architecture:** One new batch API endpoint (`GET /dynatrace/hosts/overview`) aggregates all hosts server-side — 2 Dynatrace calls per instance config (a split-by-host metrics query + a `type("HOST")` problems query) — returning one row per host. The frontend Hosts tab becomes a master/detail: a table (master) that selects a host to render the unchanged `HostDetailPanel` (detail).

**Tech Stack:** NestJS + TypeORM + axios (API, Jest); Next.js + MUI + `@testing-library/react` (web, Jest). Dynatrace Environment API v2.

## Global Constraints

- **Metric semantics:** table columns show the **average over the test-run window** (`builtin:host.cpu.usage:avg`, `builtin:host.mem.usage:avg`, `resolution=Inf`). CPU/mem metrics are already 0–100 percentages — no unit conversion.
- **Problem flag:** "flagged" = any Dynatrace problem **overlapping** the test-run window (`from`/`to` on `/api/v2/problems`). Show count + worst severity; hosts with none show "healthy".
- **Fail-soft per config:** if one Dynatrace instance's calls fail, that config's hosts still appear with null metrics / 0 problems — never blank the whole table. Log the error.
- **Route ordering:** `hosts/overview` MUST be declared before the `hosts/:hostId/*` routes (Nest matches in declaration order).
- **camelCase entity props** when using `repo.create()` (project rule) — N/A here (no new persistence).
- Use the safe error pattern: `err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error'`.

---

## File Structure

- `apps/api/src/modules/dynatrace/dto/host.dto.ts` — add `HostOverviewRow` interface.
- `apps/api/src/modules/dynatrace/dynatrace.service.ts` — add `fetchHostsOverview` + 2 private helpers + a module-level severity helper.
- `apps/api/src/modules/dynatrace/dynatrace.service.spec.ts` — add `fetchHostsOverview` describe block.
- `apps/api/src/modules/dynatrace/dynatrace.controller.ts` — add `getHostsOverview` route.
- `apps/web/lib/dynatrace.ts` — add `HostOverviewRow` interface + `fetchHostsOverview` helper.
- `apps/web/app/test-runs/[id]/components/dynatrace/HostsOverviewTable.tsx` — new presentational table.
- `apps/web/app/test-runs/[id]/components/dynatrace/HostsOverviewTable.test.tsx` — new.
- `apps/web/app/test-runs/[id]/components/dynatrace/HostsTabContent.tsx` — rewrite as master/detail.
- `apps/web/app/test-runs/[id]/components/dynatrace/HostsTabContent.test.tsx` — new.

---

## Task 1: Backend — `fetchHostsOverview` service method + DTO

**Files:**
- Modify: `apps/api/src/modules/dynatrace/dto/host.dto.ts`
- Modify: `apps/api/src/modules/dynatrace/dynatrace.service.ts`
- Test: `apps/api/src/modules/dynatrace/dynatrace.service.spec.ts`

**Interfaces:**
- Consumes: existing `this.getEntityMappings(userId, roles, systemId, environment, workload)` → `DynatraceEntityMapping[]` (each has `entityId`, `entityType`, `entityDisplayName`, `dynatraceConfigId`); `this.repository.findById(id)` → config (`{ host, apiToken }`); `this.normalizeUrl(host)`; `this.proxyOpts(config)`; `DynatraceService.DEFAULT_TIMEOUT_MS`.
- Produces: `fetchHostsOverview(systemId: string, environment: string, workload: string, startTime: Date, endTime: Date, userId: string, roles: string[]): Promise<HostOverviewRow[]>` — consumed by Task 2 (controller).

- [ ] **Step 1: Add the `HostOverviewRow` interface**

In `apps/api/src/modules/dynatrace/dto/host.dto.ts`, append after `HostProblemResponse` (line 57):

```ts
/**
 * One row of the Hosts-tab overview table: average CPU/mem over the test-run
 * window plus a problem flag. `null` metric = no data returned for that host.
 */
export interface HostOverviewRow {
  hostId: string;
  displayName: string;
  dynatraceConfigId: string;
  cpuAvg: number | null;
  memAvg: number | null;
  problemCount: number;
  worstSeverity: string | null;
}
```

- [ ] **Step 2: Write the failing test**

In `apps/api/src/modules/dynatrace/dynatrace.service.spec.ts`, add this describe block inside the top-level `describe('DynatraceService', ...)` (e.g. after the existing host-related blocks). It reuses `mockDynatraceConfig`, `repository`, `mockedAxios`, `mockUserId`, `mockRoles` from the file's setup.

```ts
describe('fetchHostsOverview', () => {
  const start = new Date('2026-07-22T10:00:00.000Z');
  const end = new Date('2026-07-22T10:30:00.000Z');

  const hostMappings = [
    { id: 'm1', entityId: 'HOST-A', entityType: 'HOST', entityDisplayName: 'web-1', dynatraceConfigId: 'config-123' },
    { id: 'm2', entityId: 'HOST-B', entityType: 'HOST', entityDisplayName: 'web-2', dynatraceConfigId: 'config-123' },
    { id: 'm3', entityId: 'SERVICE-X', entityType: 'SERVICE', entityDisplayName: 'svc', dynatraceConfigId: 'config-123' },
  ];

  const metricSeries = (hostId: string, value: number) => ({
    dimensionMap: { 'dt.entity.host': hostId },
    dimensions: [hostId],
    values: [value],
  });

  it('returns avg CPU/mem and problem flag per host, ignoring non-HOST mappings', async () => {
    repository.getEntityMappings.mockResolvedValue(hostMappings as never);
    repository.findById.mockResolvedValue(mockDynatraceConfig as never);
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.endsWith('/api/v2/metrics/query')) {
        // First call = CPU, second = memory; return both hosts each time with distinct values
        return Promise.resolve({ data: { result: [{ data: [metricSeries('HOST-A', 42), metricSeries('HOST-B', 17)] }] } });
      }
      if (url.endsWith('/api/v2/problems')) {
        return Promise.resolve({ data: { problems: [
          { severityLevel: 'PERFORMANCE', affectedEntities: [{ entityId: { id: 'HOST-A' } }] },
          { severityLevel: 'AVAILABILITY', affectedEntities: [{ entityId: { id: 'HOST-A' } }] },
        ] } });
      }
      return Promise.resolve({ data: {} });
    });

    const rows = await service.fetchHostsOverview('sys-1', 'prod', 'load', start, end, mockUserId, mockRoles);

    expect(rows).toHaveLength(2);
    const a = rows.find(r => r.hostId === 'HOST-A')!;
    expect(a).toMatchObject({ displayName: 'web-1', cpuAvg: 42, memAvg: 42, problemCount: 2, worstSeverity: 'AVAILABILITY' });
    const b = rows.find(r => r.hostId === 'HOST-B')!;
    expect(b).toMatchObject({ displayName: 'web-2', cpuAvg: 17, memAvg: 17, problemCount: 0, worstSeverity: null });
  });

  it('returns [] when there are no HOST mappings', async () => {
    repository.getEntityMappings.mockResolvedValue([
      { id: 'm3', entityId: 'SERVICE-X', entityType: 'SERVICE', entityDisplayName: 'svc', dynatraceConfigId: 'config-123' },
    ] as never);
    const rows = await service.fetchHostsOverview('sys-1', 'prod', 'load', start, end, mockUserId, mockRoles);
    expect(rows).toEqual([]);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('null-fills metrics for hosts with no metric data', async () => {
    repository.getEntityMappings.mockResolvedValue([hostMappings[0]] as never);
    repository.findById.mockResolvedValue(mockDynatraceConfig as never);
    mockedAxios.get.mockResolvedValue({ data: { result: [{ data: [] }], problems: [] } });
    const rows = await service.fetchHostsOverview('sys-1', 'prod', 'load', start, end, mockUserId, mockRoles);
    expect(rows[0]).toMatchObject({ hostId: 'HOST-A', cpuAvg: null, memAvg: null, problemCount: 0 });
  });

  it('fails soft: a config whose Dynatrace call rejects still lists its hosts with null metrics', async () => {
    repository.getEntityMappings.mockResolvedValue([hostMappings[0]] as never);
    repository.findById.mockResolvedValue(mockDynatraceConfig as never);
    mockedAxios.get.mockRejectedValue(new Error('boom'));
    const rows = await service.fetchHostsOverview('sys-1', 'prod', 'load', start, end, mockUserId, mockRoles);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hostId: 'HOST-A', cpuAvg: null, memAvg: null, problemCount: 0, worstSeverity: null });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && npx jest dynatrace.service.spec --t "fetchHostsOverview"`
Expected: FAIL — `service.fetchHostsOverview is not a function`.

- [ ] **Step 4: Implement the service method + helpers**

In `apps/api/src/modules/dynatrace/dynatrace.service.ts`:

First, import the new type. Find the existing host DTO import (it currently imports `HostMetricsResponse`, `HostProblemResponse`, etc.) and add `HostOverviewRow` to it.

Add this module-level helper near the top of the file (after imports, before the `@Injectable()` class):

```ts
// Rough severity ranking so the overview can surface the "worst" problem per host.
const DT_SEVERITY_RANK: Record<string, number> = {
  AVAILABILITY: 6,
  ERROR: 5,
  PERFORMANCE: 4,
  RESOURCE_CONTENTION: 3,
  CUSTOM_ALERT: 2,
  MONITORING_UNAVAILABLE: 1,
  INFO: 0,
};

function worseSeverity(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return (DT_SEVERITY_RANK[candidate] ?? -1) > (DT_SEVERITY_RANK[current] ?? -1) ? candidate : current;
}
```

Add these methods to the `DynatraceService` class (place next to `fetchHostMetrics` / `fetchHostProblems`, ~line 1531):

```ts
/**
 * Batch host overview for the Hosts tab: one row per HOST entity mapped to the
 * given system/environment/workload, with average CPU/mem over [startTime,endTime]
 * and a count of problems overlapping the window. Hosts are grouped by their own
 * Dynatrace instance config; each config costs 2 Dynatrace calls. Fails soft per
 * config so one bad instance never blanks the whole table.
 */
async fetchHostsOverview(
  systemId: string,
  environment: string,
  workload: string,
  startTime: Date,
  endTime: Date,
  userId: string,
  roles: string[],
): Promise<HostOverviewRow[]> {
  const mappings = await this.getEntityMappings(userId, roles, systemId, environment, workload);
  const hosts = (mappings ?? []).filter((m: { entityType: string }) => m.entityType === 'HOST') as Array<{
    entityId: string;
    entityDisplayName: string;
    dynatraceConfigId: string;
  }>;
  if (hosts.length === 0) return [];

  // ponytail: 2 Dynatrace calls per DISTINCT config. Usually one config → 2 total.
  const byConfig = new Map<string, typeof hosts>();
  for (const h of hosts) {
    const list = byConfig.get(h.dynatraceConfigId) ?? [];
    list.push(h);
    byConfig.set(h.dynatraceConfigId, list);
  }

  const from = startTime.toISOString();
  const to = endTime.toISOString();
  const rows: HostOverviewRow[] = [];

  for (const [configId, configHosts] of byConfig) {
    const base = configHosts.map((h) => ({
      hostId: h.entityId,
      displayName: h.entityDisplayName,
      dynatraceConfigId: configId,
    }));
    try {
      const config = await this.repository.findById(configId);
      if (!config) throw new Error(`Dynatrace configuration ${configId} not found`);

      const baseUrl = this.normalizeUrl(config.host);
      const proxyOpts = await this.proxyOpts(config);
      const entityIds = configHosts.map((h) => `"${h.entityId}"`).join(',');
      const entitySelector = `type("HOST"),entityId(${entityIds})`;

      const [cpuMap, memMap, problemsMap] = await Promise.all([
        this.queryHostMetricAverages(baseUrl, config.apiToken, 'builtin:host.cpu.usage', entitySelector, from, to, proxyOpts),
        this.queryHostMetricAverages(baseUrl, config.apiToken, 'builtin:host.mem.usage', entitySelector, from, to, proxyOpts),
        this.queryHostProblemCounts(baseUrl, config.apiToken, entitySelector, from, to, proxyOpts),
      ]);

      for (const b of base) {
        const p = problemsMap.get(b.hostId);
        rows.push({
          ...b,
          cpuAvg: cpuMap.get(b.hostId) ?? null,
          memAvg: memMap.get(b.hostId) ?? null,
          problemCount: p?.count ?? 0,
          worstSeverity: p?.worst ?? null,
        });
      }
    } catch (error) {
      this.logger.warn(`fetchHostsOverview: failed for config ${configId}`, {
        error: error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error',
      });
      for (const b of base) {
        rows.push({ ...b, cpuAvg: null, memAvg: null, problemCount: 0, worstSeverity: null });
      }
    }
  }

  return rows;
}

/** One /metrics/query call → Map<hostId, avgValue> over the window (resolution=Inf gives one value per host). */
private async queryHostMetricAverages(
  baseUrl: string,
  apiToken: string,
  metric: string,
  entitySelector: string,
  from: string,
  to: string,
  proxyOpts: Record<string, unknown>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const response = await axios.get(`${baseUrl}/api/v2/metrics/query`, {
    headers: { Authorization: `Api-Token ${apiToken}`, 'Content-Type': 'application/json' },
    params: {
      metricSelector: `${metric}:splitBy("dt.entity.host"):avg`,
      entitySelector,
      from,
      to,
      resolution: 'Inf',
    },
    timeout: DynatraceService.DEFAULT_TIMEOUT_MS,
    ...proxyOpts,
  });

  const series = response.data?.result?.[0]?.data ?? [];
  for (const s of series) {
    const hostId: string | undefined = s?.dimensionMap?.['dt.entity.host'] ?? s?.dimensions?.[0];
    if (!hostId) continue;
    const value = (s?.values ?? []).find((v: number | null) => v !== null && v !== undefined);
    if (typeof value === 'number') map.set(hostId, value);
  }
  return map;
}

/** One /problems call → Map<hostId, {count, worst}> for problems overlapping the window. */
private async queryHostProblemCounts(
  baseUrl: string,
  apiToken: string,
  entitySelector: string,
  from: string,
  to: string,
  proxyOpts: Record<string, unknown>,
): Promise<Map<string, { count: number; worst: string | null }>> {
  const map = new Map<string, { count: number; worst: string | null }>();
  const response = await axios.get(`${baseUrl}/api/v2/problems`, {
    headers: { Authorization: `Api-Token ${apiToken}`, 'Content-Type': 'application/json' },
    params: { entitySelector, from, to, fields: 'affectedEntities' },
    timeout: DynatraceService.DEFAULT_TIMEOUT_MS,
    ...proxyOpts,
  });

  const problems = response.data?.problems ?? [];
  for (const problem of problems) {
    const severity: string | null = problem?.severityLevel ?? null;
    const affected = problem?.affectedEntities ?? [];
    for (const e of affected) {
      const id: string | undefined = e?.entityId?.id;
      if (!id) continue;
      const cur = map.get(id) ?? { count: 0, worst: null };
      cur.count += 1;
      cur.worst = worseSeverity(cur.worst, severity);
      map.set(id, cur);
    }
  }
  return map;
}
```

Note: `proxyOpts` is typed `Record<string, unknown>` here for the helper signature; if `this.proxyOpts(config)`'s return type differs, match its actual type (check the existing `fetchHostMetrics` usage — it spreads `...proxyOpts` the same way).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && npx jest dynatrace.service.spec --t "fetchHostsOverview"`
Expected: PASS (4 tests).

- [ ] **Step 6: Type-check**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "host.dto|dynatrace.service" || echo clean`
Expected: `clean` (remember `noUncheckedIndexedAccess` is on — the code above guards array/`Map` access).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/dynatrace/dto/host.dto.ts apps/api/src/modules/dynatrace/dynatrace.service.ts apps/api/src/modules/dynatrace/dynatrace.service.spec.ts
git commit -m "feat(dynatrace): fetchHostsOverview batch service for Hosts-tab table

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend — `GET /dynatrace/hosts/overview` controller route

**Files:**
- Modify: `apps/api/src/modules/dynatrace/dynatrace.controller.ts`

**Interfaces:**
- Consumes: `this.dynatraceService.fetchHostsOverview(systemId, environment, workload, start, end, userId, roles)` (Task 1); `HostOverviewRow` from `./dto/host.dto`.
- Produces: `GET /dynatrace/hosts/overview?systemId&environment&workload&startTime&endTime` → `HostOverviewRow[]` — consumed by Task 3 (web lib helper).

- [ ] **Step 1: Add `HostOverviewRow` to the DTO import**

In `dynatrace.controller.ts` line 29, extend the import:

```ts
import { StoreHostPropertiesDto, HostPropertiesResponse, HostMetricsResponse, HostProblemResponse, HostOverviewRow } from './dto/host.dto';
```

- [ ] **Step 2: Add the route BEFORE the `hosts/:hostId/*` routes**

Insert immediately after the `testConnection` handler (after line 89, before the `// Host Endpoints` comment at line 91):

```ts
  @Get('hosts/overview')
  @ApiOperation({ summary: 'Per-host overview (avg CPU/mem + problem flag) for a test-run window' })
  @ApiResponse({
    status: 200,
    description: 'Host overview rows',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hostId: { type: 'string' },
          displayName: { type: 'string' },
          dynatraceConfigId: { type: 'string' },
          cpuAvg: { type: 'number', nullable: true },
          memAvg: { type: 'number', nullable: true },
          problemCount: { type: 'number' },
          worstSeverity: { type: 'string', nullable: true },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid or missing query parameters' })
  async getHostsOverview(
    @Query('systemId') systemId: string,
    @Query('environment') environment: string,
    @Query('workload') workload: string,
    @Query('startTime') startTime: string,
    @Query('endTime') endTime: string,
    @UserCtx() ctx: UserContext,
  ): Promise<HostOverviewRow[]> {
    if (!systemId || !environment || !workload) {
      throw new BadRequestException('systemId, environment and workload query parameters are required');
    }
    if (!startTime || !endTime) {
      throw new BadRequestException('startTime and endTime query parameters are required');
    }
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format for startTime or endTime');
    }
    return this.dynatraceService.fetchHostsOverview(systemId, environment, workload, start, end, ctx.userId, ctx.roles);
  }
```

- [ ] **Step 3: Type-check**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json 2>&1 | grep dynatrace.controller || echo clean`
Expected: `clean`.

- [ ] **Step 4: Verify existing controller tests still pass**

Run: `cd apps/api && npx jest dynatrace.controller.spec`
Expected: PASS (no regressions; new route needs no new controller test — it's thin validation over the service covered in Task 1).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/dynatrace/dynatrace.controller.ts
git commit -m "feat(dynatrace): GET /dynatrace/hosts/overview route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Web — `fetchHostsOverview` lib helper

**Files:**
- Modify: `apps/web/lib/dynatrace.ts`

**Interfaces:**
- Consumes: `GET /dynatrace/hosts/overview` (Task 2) via `authenticatedFetch`.
- Produces: `HostOverviewRow` interface + `fetchHostsOverview(systemId, environment, workload, startTime, endTime): Promise<HostOverviewRow[]>` — consumed by Tasks 4 & 5.

- [ ] **Step 1: Add the interface + helper**

In `apps/web/lib/dynatrace.ts`, append after `fetchHostProblems`/`storeHostProperties` (end of the "Host Entity Support" section, ~line 522):

```ts
export interface HostOverviewRow {
  hostId: string;
  displayName: string;
  dynatraceConfigId: string;
  cpuAvg: number | null;
  memAvg: number | null;
  problemCount: number;
  worstSeverity: string | null;
}

export async function fetchHostsOverview(
  systemId: string,
  environment: string,
  workload: string,
  startTime: string,
  endTime: string,
): Promise<HostOverviewRow[]> {
  const params = new URLSearchParams({ systemId, environment, workload, startTime, endTime });
  const response = await authenticatedFetch(`/dynatrace/hosts/overview?${params.toString()}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to fetch host overview');
  }

  return response.json();
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && npx tsc --project tsconfig.build.json --noEmit 2>&1 | grep "lib/dynatrace" || echo clean`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/dynatrace.ts
git commit -m "feat(dynatrace): web fetchHostsOverview helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Web — `HostsOverviewTable` component

**Files:**
- Create: `apps/web/app/test-runs/[id]/components/dynatrace/HostsOverviewTable.tsx`
- Test: `apps/web/app/test-runs/[id]/components/dynatrace/HostsOverviewTable.test.tsx`

**Interfaces:**
- Consumes: `HostOverviewRow` (Task 3).
- Produces: default export `HostsOverviewTable` with props `{ hosts: HostEntity[]; rows: HostOverviewRow[]; loading: boolean; onSelectHost: (hostId: string) => void }` where `HostEntity = { id: string; entityId: string; entityDisplayName: string; dynatraceConfigId: string }` — consumed by Task 5. Renders one row per `host`, looking up stats from `rows` by `hostId === entityId`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/test-runs/[id]/components/dynatrace/HostsOverviewTable.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import HostsOverviewTable from './HostsOverviewTable';

const hosts = [
  { id: 'm1', entityId: 'HOST-A', entityDisplayName: 'web-1', dynatraceConfigId: 'c1' },
  { id: 'm2', entityId: 'HOST-B', entityDisplayName: 'web-2', dynatraceConfigId: 'c1' },
];

const rows = [
  { hostId: 'HOST-A', displayName: 'web-1', dynatraceConfigId: 'c1', cpuAvg: 42.34, memAvg: 60.1, problemCount: 2, worstSeverity: 'AVAILABILITY' },
  { hostId: 'HOST-B', displayName: 'web-2', dynatraceConfigId: 'c1', cpuAvg: null, memAvg: 17, problemCount: 0, worstSeverity: null },
];

describe('HostsOverviewTable', () => {
  it('renders a row per host with formatted CPU/mem and problem indicators', () => {
    render(<HostsOverviewTable hosts={hosts} rows={rows} loading={false} onSelectHost={jest.fn()} />);
    expect(screen.getByText('web-1')).toBeInTheDocument();
    expect(screen.getByText('web-2')).toBeInTheDocument();
    expect(screen.getByText('42.3%')).toBeInTheDocument(); // rounded to 1 dp
    expect(screen.getByText('—')).toBeInTheDocument();       // HOST-B cpuAvg null
    expect(screen.getByText('2')).toBeInTheDocument();        // problem count chip
    expect(screen.getByText('healthy')).toBeInTheDocument();  // HOST-B no problems
  });

  it('calls onSelectHost with the entityId when a row is clicked', () => {
    const onSelect = jest.fn();
    render(<HostsOverviewTable hosts={hosts} rows={rows} loading={false} onSelectHost={onSelect} />);
    fireEvent.click(screen.getByText('web-1'));
    expect(onSelect).toHaveBeenCalledWith('HOST-A');
  });

  it('shows an empty state when there are no hosts', () => {
    render(<HostsOverviewTable hosts={[]} rows={[]} loading={false} onSelectHost={jest.fn()} />);
    expect(screen.getByText('No hosts found')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx jest HostsOverviewTable`
Expected: FAIL — cannot find module `./HostsOverviewTable`.

- [ ] **Step 3: Implement the component**

Create `apps/web/app/test-runs/[id]/components/dynatrace/HostsOverviewTable.tsx`:

```tsx
'use client';

import {
  Box,
  Chip,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { HostOverviewRow } from '@/lib/dynatrace';

interface HostEntity {
  id: string;
  entityId: string;
  entityDisplayName: string;
  dynatraceConfigId: string;
}

interface HostsOverviewTableProps {
  hosts: HostEntity[];
  rows: HostOverviewRow[];
  loading: boolean;
  onSelectHost: (hostId: string) => void;
}

const SEVERITY_COLOR: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  AVAILABILITY: 'error',
  ERROR: 'error',
  PERFORMANCE: 'warning',
  RESOURCE_CONTENTION: 'warning',
  CUSTOM_ALERT: 'info',
  MONITORING_UNAVAILABLE: 'info',
  INFO: 'info',
};

function fmtPct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

export default function HostsOverviewTable({ hosts, rows, loading, onSelectHost }: HostsOverviewTableProps) {
  if (hosts.length === 0) {
    return (
      <Box py={4} textAlign="center">
        <Typography color="text.secondary">No hosts found</Typography>
      </Box>
    );
  }

  const byId = new Map(rows.map((r) => [r.hostId, r]));

  // problems first, then CPU avg descending (null CPU sinks to the bottom)
  const sorted = [...hosts].sort((a, b) => {
    const ra = byId.get(a.entityId);
    const rb = byId.get(b.entityId);
    const pa = (ra?.problemCount ?? 0) > 0 ? 1 : 0;
    const pb = (rb?.problemCount ?? 0) > 0 ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (rb?.cpuAvg ?? -1) - (ra?.cpuAvg ?? -1);
  });

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" aria-label="hosts overview">
        <TableHead>
          <TableRow>
            <TableCell>Host</TableCell>
            <TableCell align="right">CPU avg</TableCell>
            <TableCell align="right">Memory avg</TableCell>
            <TableCell align="center">Problems</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((host) => {
            const r = byId.get(host.entityId);
            const pending = loading && !r;
            return (
              <TableRow
                key={host.id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => onSelectHost(host.entityId)}
              >
                <TableCell>{host.entityDisplayName}</TableCell>
                <TableCell align="right">{pending ? <Skeleton width={40} /> : fmtPct(r?.cpuAvg)}</TableCell>
                <TableCell align="right">{pending ? <Skeleton width={40} /> : fmtPct(r?.memAvg)}</TableCell>
                <TableCell align="center">
                  {pending ? (
                    <Skeleton width={60} sx={{ mx: 'auto' }} />
                  ) : r && r.problemCount > 0 ? (
                    <Chip
                      size="small"
                      color={r.worstSeverity ? SEVERITY_COLOR[r.worstSeverity] ?? 'default' : 'default'}
                      label={r.problemCount}
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      healthy
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx jest HostsOverviewTable`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/test-runs/[id]/components/dynatrace/HostsOverviewTable.tsx apps/web/app/test-runs/[id]/components/dynatrace/HostsOverviewTable.test.tsx
git commit -m "feat(dynatrace): HostsOverviewTable component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Web — rewrite `HostsTabContent` as master/detail

**Files:**
- Modify: `apps/web/app/test-runs/[id]/components/dynatrace/HostsTabContent.tsx`
- Test: `apps/web/app/test-runs/[id]/components/dynatrace/HostsTabContent.test.tsx`

**Interfaces:**
- Consumes: `fetchHostsOverview`, `HostOverviewRow` (Task 3); `HostsOverviewTable` (Task 4); existing `HostDetailPanel` (unchanged); props `{ hostEntities: DynatraceEntityMapping[]; testRun: TestRun; configs: DynatraceConfig[] }` (unchanged — the parent `DynatraceExpandedContent` passes these already).
- Produces: nothing downstream (leaf UI).

Note: `DynatraceEntityMapping` here carries `systemUnderTestId`, `testEnvironment`, `workload`, `entityId`, `entityDisplayName`, `dynatraceConfigId` — the overview query params are derived from the first host entity (all hosts in this tab share the same system/env/workload).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/test-runs/[id]/components/dynatrace/HostsTabContent.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HostsTabContent from './HostsTabContent';

jest.mock('@/lib/dynatrace', () => ({
  fetchHostsOverview: jest.fn().mockResolvedValue([]),
}));

// Render a marker instead of the real detail panel (it fetches on mount).
jest.mock('./HostDetailPanel', () => ({
  __esModule: true,
  default: ({ host }: { host: { entityDisplayName: string } }) => (
    <div>detail-for-{host.entityDisplayName}</div>
  ),
}));

const hostEntities = [
  {
    id: 'm1', entityId: 'HOST-A', entityDisplayName: 'web-1', entityType: 'HOST',
    dynatraceConfigId: 'c1', systemUnderTestId: 'sys-1', testEnvironment: 'prod', workload: 'load',
    level: 'host', createdAt: '', updatedAt: '',
  },
];

const testRun = { id: 'tr-1', start_time: '2026-07-22T10:00:00Z', end_time: '2026-07-22T10:30:00Z' } as never;
const configs = [{ id: 'c1', label: 'DT' }] as never;

describe('HostsTabContent', () => {
  it('shows the overview table, then the host detail after clicking a row, then back', async () => {
    render(<HostsTabContent hostEntities={hostEntities} testRun={testRun} configs={configs} />);

    // master: table row present
    const row = await screen.findByText('web-1');
    expect(screen.queryByText('detail-for-web-1')).not.toBeInTheDocument();

    // drill in
    fireEvent.click(row);
    expect(screen.getByText('detail-for-web-1')).toBeInTheDocument();

    // back to master
    fireEvent.click(screen.getByRole('button', { name: /back to hosts/i }));
    await waitFor(() => expect(screen.getByText('web-1')).toBeInTheDocument());
    expect(screen.queryByText('detail-for-web-1')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx jest HostsTabContent`
Expected: FAIL — current `HostsTabContent` renders tabs, not a table/back button (`web-1` appears as a tab but there's no "Back to hosts" button, and `detail-for-web-1` renders immediately in a tab panel).

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `apps/web/app/test-runs/[id]/components/dynatrace/HostsTabContent.tsx` with:

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, Button } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { TestRun } from '@/types/test-runs';
import { DynatraceConfig, fetchHostsOverview, HostOverviewRow } from '@/lib/dynatrace';
import HostDetailPanel from './HostDetailPanel';
import HostsOverviewTable from './HostsOverviewTable';

interface DynatraceEntityMapping {
  id: string;
  entityId: string;
  entityDisplayName: string;
  entityType: string;
  dynatraceConfigId: string;
  systemUnderTestId: string;
  testEnvironment?: string;
  workload?: string;
  level: string;
  createdAt: string;
  updatedAt: string;
}

interface HostsTabContentProps {
  hostEntities: DynatraceEntityMapping[];
  testRun: TestRun;
  configs: DynatraceConfig[];
}

export default function HostsTabContent({ hostEntities, testRun, configs }: HostsTabContentProps) {
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [rows, setRows] = useState<HostOverviewRow[]>([]);
  const [loading, setLoading] = useState(false);

  const first = hostEntities[0];

  const loadOverview = useCallback(async () => {
    if (!first || !testRun.start_time || !testRun.end_time) {
      setRows([]);
      return;
    }
    try {
      setLoading(true);
      const data = await fetchHostsOverview(
        first.systemUnderTestId,
        first.testEnvironment ?? '',
        first.workload ?? '',
        testRun.start_time,
        testRun.end_time,
      );
      setRows(data);
    } catch (error) {
      console.error('Failed to fetch host overview:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [first, testRun.start_time, testRun.end_time]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const selectedHost = hostEntities.find((h) => h.entityId === selectedHostId) ?? null;

  if (selectedHost) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => setSelectedHostId(null)} sx={{ mb: 2 }}>
          Back to hosts
        </Button>
        <HostDetailPanel
          host={selectedHost}
          testRun={testRun}
          // Each host belongs to a specific Dynatrace instance; use its own config, not always the first
          config={configs.find((c) => c.id === selectedHost.dynatraceConfigId) ?? configs[0]}
        />
      </Box>
    );
  }

  return (
    <HostsOverviewTable
      hosts={hostEntities}
      rows={rows}
      loading={loading}
      onSelectHost={setSelectedHostId}
    />
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx jest HostsTabContent`
Expected: PASS.

- [ ] **Step 5: Type-check the web app**

Run: `cd apps/web && npx tsc --project tsconfig.build.json --noEmit 2>&1 | grep -E "HostsTabContent|HostsOverviewTable|lib/dynatrace" || echo clean`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/test-runs/[id]/components/dynatrace/HostsTabContent.tsx apps/web/app/test-runs/[id]/components/dynatrace/HostsTabContent.test.tsx
git commit -m "feat(dynatrace): Hosts tab overview table with drill-down to host detail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Lint + type-check both apps**

Run: `cd apps/api && npx eslint src/modules/dynatrace --ext .ts && cd ../web && npx eslint 'app/test-runs/[id]/components/dynatrace/**' lib/dynatrace.ts`
Expected: no errors.

- [ ] **Full affected test runs**

Run: `cd apps/api && npx jest dynatrace && cd ../web && npx jest dynatrace Hosts`
Expected: all green.

- [ ] **Manual smoke** (per the spec's testing note)

Open a test run with a Dynatrace card that has mapped HOST entities → Hosts tab. Confirm: a table lists every host with CPU avg %, Memory avg %, and a problem chip / "healthy"; clicking a row opens that host's existing detail panel (graphs + problems); "Back to hosts" returns to the table. Verify a host with no metric data shows "—" rather than a crash.

---

## Notes / deliberate simplifications (ponytail ceilings)

- **2 Dynatrace calls per distinct instance config.** Normal case = 1 config → 2 calls total. Only grows if a system spreads hosts across multiple Dynatrace instances. Upgrade path: none needed unless instance counts get large.
- **Severity ranking** (`DT_SEVERITY_RANK`) is a fixed heuristic for "worst" — Dynatrace has no canonical ordering. Adjust the map if product wants a different priority.
- **Problem→host attribution** uses `affectedEntities[].entityId.id`. If a Dynatrace tenant returns problems without `affectedEntities` populated, counts will be 0; `fields=affectedEntities` is requested explicitly to avoid that.
- Out of scope (YAGNI): sortable column headers, in-row sparklines, live auto-refresh, per-host URL route.
