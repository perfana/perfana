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
| Event | Payload | Description |
|---|---|---|
| `job-progress:update` | JobProgress | Pipeline stage progress |

## Job Progress Tracking

The Worker reports progress through Redis for each analysis stage:

```typescript
interface JobProgress {
  testRunId: string;
  jobType: 'analyze' | 'refresh' | 'reevaluate';
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'stuck' | 'blocked';
  currentStage: number;    // 1-9
  totalStages: number;     // 9
  stageName: string;       // e.g., "ADAPT Analysis"
  stageProgress: number;   // 0-100%
  overallProgress: number; // 0-100%
}
```

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
