# Dynatrace Hosts Overview Table — Design

**Date:** 2026-07-22
**Status:** Approved (design), pending implementation plan

## Problem

The Dynatrace card's **Hosts** tab (on the test-run detail page) currently renders a
**tab-per-host strip** (`HostsTabContent.tsx`): one MUI `<Tab>` per host entity, each
opening a `HostDetailPanel` (properties + Plotly CPU/mem/disk/net graphs + a problems
table). There is no at-a-glance overview across hosts, and the tab strip does not scale
past a handful of hosts.

We want the Hosts tab to land on a **table of all hosts** showing, per host: average CPU
usage, average memory usage, and a problem indication — with each row drilling into the
existing per-host detail view.

## Decisions (from brainstorming)

- **Metric semantics:** columns show the **average over the test-run window** (the card is
  scoped to a fixed `start_time`/`end_time`). Not peak, not latest.
- **Layout:** the table **replaces** the tab-per-host strip. Row click → existing
  `HostDetailPanel`. Master/detail via local state (no routing — none exists today).
- **Fetching:** a **new batch endpoint** aggregates all hosts server-side (2 Dynatrace calls
  per instance config), instead of N client-side per-host fan-out calls.
- **"Flagged as a problem":** any Dynatrace problem **overlapping the test-run window**.
  Cell shows a severity-colored count chip; hosts with none show a muted "healthy".

## Current state (reference)

All under `apps/web/app/test-runs/[id]/components/dynatrace/`:

- `DynatraceCard.tsx` → `components/DynatraceExpandedContent.tsx` (tab 0 = Hosts).
- `HostsTabContent.tsx` — tab strip; `configs.find(c => c.id === host.dynatraceConfigId) ?? configs[0]` (each host uses its own instance config).
- `HostDetailPanel.tsx` + `HostPropertiesSection.tsx` / `HostPerformanceGraphs.tsx` / `HostProblemsSection.tsx`.
- `hooks/useDynatraceData.ts` — loads configs (`GET /dynatrace`) and mappings
  (`GET /dynatrace/entities/mappings?systemId&environment&workload`); `hostEntities =
  mappings.filter(m => m.entityType === 'HOST')`.

Backend `apps/api/src/modules/dynatrace/`:

- `dynatrace.service.ts`: `fetchHostMetrics` (line ~1322) queries `/api/v2/metrics/query`
  with `builtin:host.cpu.usage` / `builtin:host.mem.usage` (returns **timeseries**);
  `fetchHostProblems` (line ~1469) queries `/api/v2/problems` with
  `type("HOST"),entityId("{hostId}")`. `getEntityMappings` (~line 1119) returns host list.
- No batch/overview endpoint. No internal per-host route. DTOs in `dto/host.dto.ts`.

## Backend design

### New endpoint

`GET /dynatrace/hosts/overview?systemId&environment&workload&startTime&endTime`

Controller method `getHostsOverview` in `dynatrace.controller.ts` (declared with the other
`hosts/...` routes, before parameterized routes). Auth/guards identical to sibling host
endpoints.

### Service method `fetchHostsOverview`

1. Resolve HOST entity mappings for `systemId/environment/workload` (reuse the existing
   mapping lookup used by `getEntityMappings`).
2. Group hosts by `dynatraceConfigId`. For each config (decrypt token via the existing
   path), make **2 Dynatrace calls**:
   - `GET /api/v2/metrics/query` — metrics
     `builtin:host.cpu.usage:avg` and `builtin:host.mem.usage:avg`,
     `entitySelector: type("HOST"),entityId("HOST-A","HOST-B",...)`,
     `from=startTime&to=endTime&resolution=Inf` → **one averaged value per host** over the
     window. Map each result series to its `dt.entity.host` dimension.
   - `GET /api/v2/problems` — `entitySelector: type("HOST"),entityId(...)`,
     `from=startTime&to=endTime` → problems overlapping the window; group by affected host,
     count them, track the worst `severityLevel`.
3. Assemble one row per host, joining metrics + problems + display name from the mapping.

`// ponytail: 2 Dynatrace calls per DISTINCT config. Usually one config → 2 calls total.
Only grows if a system spreads hosts across multiple Dynatrace instances.`

### Response DTO — `HostsOverviewResponse` (`dto/host.dto.ts`)

```ts
interface HostOverviewRow {
  hostId: string;              // dt.entity.host id
  displayName: string;         // from entity mapping
  dynatraceConfigId: string;   // which instance the row belongs to
  cpuAvg: number | null;       // avg builtin:host.cpu.usage over window, % (null = no data)
  memAvg: number | null;       // avg builtin:host.mem.usage over window, % (null = no data)
  problemCount: number;        // problems overlapping the window
  worstSeverity: string | null;// AVAILABILITY|ERROR|PERFORMANCE|RESOURCE_CONTENTION|... or null
}
type HostsOverviewResponse = HostOverviewRow[];
```

### Edge cases

- **No metric data** for a host in the window (host didn't exist yet, or Dynatrace returned
  no series) → `cpuAvg`/`memAvg` = `null` → rendered as "—".
- **No hosts mapped** → `[]` → table shows empty state.
- **A config's Dynatrace call fails** → that config's hosts get null metrics / zero
  problems and are still listed (fail-soft per config, matching the resilient per-host
  behaviour today); log the error. One bad instance must not blank the whole table.
- `builtin:host.cpu.usage` and `builtin:host.mem.usage` are already 0–100 percentages;
  no unit conversion — display as `%`.

## Frontend design

### New component `HostsOverviewTable.tsx`

MUI `<Table>`. Columns: **Host · CPU avg % · Memory avg % · Problems**.

- CPU/Memory: `{value.toFixed(1)}%` or "—" when null.
- Problems: `problemCount > 0` → severity-colored `<Chip>` with the count (color from
  `worstSeverity`); else a muted "healthy" label.
- Default sort: hosts with problems first, then CPU avg descending.
- Whole row clickable (cursor pointer + hover) → selects that host.
- Loading: skeleton rows while the overview fetch is in flight. Empty: "No hosts found".

### `HostsTabContent.tsx` — master/detail

Replace the tab strip with local `selectedHostId` state:

- `selectedHostId == null` → render `HostsOverviewTable` (fetches via the new helper).
- `selectedHostId != null` → render a "← Back to hosts" button + the **existing**
  `HostDetailPanel` for the selected host, passing the same
  `configs.find(c => c.id === host.dynatraceConfigId) ?? configs[0]` config it uses today.

`HostDetailPanel` and its three sections are unchanged.

### New lib helper `fetchHostsOverview` (`apps/web/lib/dynatrace.ts`)

`fetchHostsOverview(systemId, environment, workload, startTime, endTime)` →
`authenticatedFetch('/dynatrace/hosts/overview?...')` returning `HostsOverviewResponse`.
Mirrors the existing `fetchHostMetrics` / `fetchHostProblems` helpers.

## Out of scope (YAGNI — add when asked)

- Sortable column headers (fixed default sort only).
- In-row CPU/mem sparklines.
- Live auto-refresh / polling.
- A dedicated per-host URL route.

## Testing

- **API:** `dynatrace.service.spec.ts` — `fetchHostsOverview` against a mocked Dynatrace
  client: (a) host grouping by `dynatraceConfigId`, (b) metrics-series → per-host avg
  mapping, (c) problem overlap → count + worst severity, (d) null-metric host handling,
  (e) fail-soft when one config's call rejects.
- **Frontend:** the table is presentational; covered by the API spec + manual verification
  (open the Hosts tab on a test run with Dynatrace hosts, confirm rows + drill-down + back).

## Files touched

- `apps/api/src/modules/dynatrace/dynatrace.controller.ts` — new `getHostsOverview` route.
- `apps/api/src/modules/dynatrace/dynatrace.service.ts` — new `fetchHostsOverview`.
- `apps/api/src/modules/dynatrace/dto/host.dto.ts` — `HostsOverviewResponse` / `HostOverviewRow`.
- `apps/api/src/modules/dynatrace/dynatrace.service.spec.ts` — new spec cases.
- `apps/web/lib/dynatrace.ts` — `fetchHostsOverview` helper + types.
- `apps/web/app/test-runs/[id]/components/dynatrace/HostsOverviewTable.tsx` — new.
- `apps/web/app/test-runs/[id]/components/dynatrace/HostsTabContent.tsx` — master/detail rewrite.
