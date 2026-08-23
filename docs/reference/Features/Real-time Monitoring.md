---
aliases:
  - Real-time
  - WebSocket
  - Live Monitoring
tags:
  - feature
---

# Real-time Monitoring

Perfana provides real-time updates during test execution and analysis through WebSocket connections and Redis Pub/Sub.

## Architecture

```
Worker (pipeline stages)
  │
  ▼
ProgressReporter ──▶ Redis Pub/Sub
  │
  ▼
API (RealtimeService) ──▶ Socket.IO WebSocket
  │
  ▼
Frontend (hooks) ──▶ UI updates
```

## WebSocket Events

### Test Run Events
| Event | Payload | Description |
|---|---|---|
| `test-run:created` | TestRun object | New test run initialized |
| `test-run:updated` | TestRun object | Status change, completion |
| `test-run:deleted` | TestRun ID | Test run removed |

### Job Progress Events

Emitted by `JobProgressGateway` (`apps/api/src/modules/data-science/gateways/job-progress.gateway.ts`):

The gateway emits the `payload` of each `JobEvent` variant, not the `{ type, payload }` wrapper:

| Event | Payload | Description |
|---|---|---|
| `job:progress` | `JobProgress` | Pipeline stage progress |
| `job:completed` | `JobCompletedEvent['payload']` | Job finished successfully — **terminal** |
| `job:failed` | `JobFailedEvent['payload']` | Job failed |
| `job:blocked` | `JobBlockedInfo` | Blocked by another job on the same scope |
| `job:stuck` | `JobStuckEvent['payload']` | Detected by `StuckJobScanner` |

> [!warning] `job:completed` ends the stream
> `useJobProgress` clears its state on `job:completed` **and** records the job id for 30 seconds,
> so any `job:progress` published afterwards — or a stale polling response — is discarded and
> never rendered. A producer that runs work after its orchestrator returns must delay
> `job:completed` until every stage the UI lists has been reported; see `finalizeProgress` in
> [[Worker Overview]].
>
> `job:failed` also clears the progress state, but it does **not** record the job id, so later
> progress events for a failed job are still accepted. Do not rely on that asymmetry — it is
> incidental, not designed.

## Job Progress Tracking

The Worker reports progress through Redis for each analysis stage:

```typescript
interface JobProgress {
  testRunId: string;
  jobType: 'analyze' | 'refresh' | 'reevaluate';
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'stuck' | 'blocked';
  stage: string;           // stage id, e.g. 'adapt-analysis'
  stageName: string;       // display name, e.g. 'ADAPT analysis'
  stageIndex: number;      // 1-based; 1-11 for analyze-test
  totalStages: number;     // 11 for analyze-test (10 when adapt=false)
  stageProgress: number;   // 0-100%
  overallProgress: number; // 0-100%
  message: string;
}
```

Abridged — see `JobProgress` in `packages/shared/src/types/job-progress.types.ts` for the full
shape (`jobId`, the scope fields, `startedAt`, `lastProgressAt`).

`stageName` comes from `getStageName(stage)`, which looks the id up in `PIPELINE_STAGES` — the
canonical id-to-display-name list, and the third place the analyze stages are enumerated after
`ORCHESTRATED_STAGES` and the worker's own UI-facing `stages` array. An id that is not in
`PIPELINE_STAGES` falls back to the raw id rather than failing, so a new stage silently renders as
`gap-analysis` instead of a human name.

## Incremental Metric Collection

During test execution, metrics are collected in real-time:

- **IncrementalCollectionScheduler** runs every 2 minutes
- Collects latest metrics from Grafana/Dynatrace
- Stores directly in `ds_metrics` hypertable
- Frontend displays live metric graphs

## Frontend Integration

### SocketManager Singleton (`lib/socket.ts`)

- Manages Socket.IO client connection
- Authentication via Keycloak JWT in query params
- Reconnection: exponential backoff (1s → 30s max)

### Custom Hooks

| Hook | Purpose |
|---|---|
| `useTestRunRealtime()` | WebSocket connection and event handling |
| `useDashboardData()` | Dashboard stats with auto-refresh on events |
| `useTestRunsData()` | Test runs list with live updates |
| `useJobProgress()` | Job progress polling and tracking |

### UI Updates

- Dashboard auto-refreshes when test runs change
- Test runs list updates in real-time with new/changed runs
- Sidebar shows live job progress with stage indicators
- Test run detail page shows pipeline progress bar

## Server-Side Implementation

### TestRunsGateway (Socket.IO)
- NestJS WebSocket gateway
- `WebSocketAuthGuard` validates connections
- Broadcasts events to connected clients
- Custom Socket.IO adapter with CORS

### RealtimeService
- Extends `RealtimePublisherService` from `@perfana/shared`
- Subscribes to Redis Pub/Sub channels
- Translates Redis messages to WebSocket events

## Redis Channels

| Channel | Purpose |
|---|---|
| `perfana:job-progress:*` | Per-test-run progress updates |
| `perfana:test-run:events` | Test run lifecycle events |

## Related

- [[Worker Overview]] — Pipeline stages that report progress
- [[Web State Management]] — WebSocket integration in frontend
- [[Architecture Overview]]
