---
aliases:
  - State Management
tags:
  - app/web
  - patterns
---

# Web State Management

Perfana uses a **hybrid state management** approach combining React Context, React Query, WebSocket, and local component state.

## React Context (Application State)

### AuthContext

Global authentication state.

| State | Type | Description |
|---|---|---|
| `user` | `User` | Current user (id, email, name, roles, orgs) |
| `isLoading` | `boolean` | Auth initialization status |

**Methods**: `login()`, `logout()`, `hasRole(role)`, `hasAnyRole(roles)`

### OrganizationContext

Organization selection and membership.

| State | Type | Description |
|---|---|---|
| `currentOrganizationId` | `string` | Selected org ID |
| `currentOrganization` | `Organization` | Full org object |
| `organizations` | `Organization[]` | Accessible organizations |
| `isReady` | `boolean` | Org selection complete |
| `isSelectorReadOnly` | `boolean` | Single-org non-admin |
| `isAdmin` | `boolean` | Global admin role |

**Behavior**:
- Auto-selects single org for non-admin users
- Admins with multiple orgs must explicitly select
- Persists selection to `localStorage`

### SidebarContext

Sidebar UI state: `isOpen`, `isMobile`, `toggle()`, `open()`, `close()`

## React Query (Server State)

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});
```

**Key queries**: Organizations, Teams, Test Runs, Dashboard Statistics, API Keys, Integration configs.

## WebSocket (Real-time State)

Socket.IO connection managed by `SocketManager` singleton.

**Events received**:
- `test-run:created` — New test run
- `test-run:updated` — Status change
- `test-run:deleted` — Deletion
- `job-progress:update` — Pipeline stage progress

**Connection**: Exponential backoff reconnection (1s → 30s max).

## Custom Hooks

### Data Fetching
| Hook | Purpose |
|---|---|
| `useDashboardData()` | Dashboard stats with real-time sync |
| `useTestRunsData()` | Test runs list with WebSocket updates |
| `useTestRunData()` | Single test run details |
| `useTestRunRealtime()` | WebSocket connection management |
| `useJobProgress()` | Job progress tracking |
| `useOrganizations()` | Organizations listing |
| `useTeams()` | Teams listing |
| `useOrganizationMembers()` | Members listing |

### Integration CRUD
| Hook | Purpose |
|---|---|
| `useGrafanaIntegration()` | Grafana config CRUD |
| `useDynatraceIntegration()` | Dynatrace config CRUD |
| `usePyroscopeIntegration()` | Pyroscope config CRUD |
| `useTracingIntegration()` | Tracing config CRUD |
| `useApiKeys()` | API keys management |

## API Client

`authenticatedFetch()` wrapper in `lib/api.ts`:
- Automatic `Authorization: Bearer` header injection
- Keycloak token refresh on 401
- Fallback to traditional token refresh
- Debug logging to `localStorage`

## Runtime Configuration

Supports dynamic env vars for containerized deployments:

1. Build with placeholders: `__RUNTIME_NEXT_PUBLIC_API_URL__`
2. At runtime, fetch actual config from `/api/config`
3. Store in `window.__ENV__`
4. Priority: `window.__ENV__` > `process.env` > defaults

## Related

- [[Web Overview]]
- [[API Authentication]] — Backend auth details
- [[Real-time Monitoring]] — WebSocket event system
