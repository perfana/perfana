# Real-Time Test Run Updates - Implementation Guide

## Overview

This document describes the complete real-time WebSocket implementation for the Perfana frontend using Socket.IO client. The feature provides live updates for test runs with automatic fallback to API polling for resilience.

## Architecture

### Backend (Already Implemented)
- **WebSocket Server**: Socket.IO server at `/realtime` namespace
- **Authentication**: Keycloak JWT token in handshake
- **Redis PubSub**: Event broadcasting across multiple server instances
- **Events**: Test run created, updated, deleted

### Frontend (New Implementation)

#### 1. Socket.IO Client Connection Manager (`apps/web/lib/socket.ts`)

**Purpose**: Singleton WebSocket connection manager with authentication and reconnection logic.

**Key Features**:
- Keycloak JWT authentication in Socket.IO handshake
- Automatic reconnection with exponential backoff (1s → 30s max)
- Connection state management (disconnected, connecting, connected, error)
- Event subscription/unsubscription
- Error handling and recovery

**Usage**:
```typescript
import { socketManager } from '@/lib/socket';

// Connect
await socketManager.connect();

// Subscribe to connection state changes
const unsubscribe = socketManager.onConnectionStateChange((state) => {
  console.log('Connection state:', state);
});

// Subscribe to events
const unsubscribeEvent = socketManager.on('test_run_updated', (payload) => {
  console.log('Test run updated:', payload);
});

// Disconnect
socketManager.disconnect();
```

#### 2. Type Definitions (`apps/web/types/realtime.ts`)

**Purpose**: TypeScript type definitions for all WebSocket events and payloads.

**Key Types**:
- `ConnectionState`: 'disconnected' | 'connecting' | 'connected' | 'error'
- `TestRunEventPayload`: Test run created/updated events
- `TestRunDeletedPayload`: Test run deletion events
- `TestRunFilters`: Filter options for subscriptions
- All server event payloads with proper typing

#### 3. React Hooks (`apps/web/hooks/useRealtime.ts`)

**Purpose**: React hooks for subscribing to real-time updates with automatic lifecycle management.

##### `useRealtimeTestRuns(options)`

Subscribe to test runs list with real-time updates.

**Options**:
- `filters?: TestRunFilters` - Filter test runs
- `fallbackToPolling?: boolean` - Enable API polling fallback (default: true)
- `pollingInterval?: number` - Polling interval in ms (default: 5000)
- `enabled?: boolean` - Enable/disable subscription (default: true)

**Returns**:
```typescript
{
  testRuns: TestRun[];           // Current test runs
  loading: boolean;              // Loading state
  error: string | null;          // Error message
  connectionState: ConnectionState; // WebSocket connection state
  isRealtime: boolean;          // Whether using real-time updates
}
```

**Features**:
- Automatic subscription on mount
- Automatic unsubscription on unmount
- Debounced updates (300ms) to prevent UI flickering
- Deduplication of events
- Fallback to polling if WebSocket fails
- Optimistic UI updates

##### `useRealtimeTestRun(testRunId, options)`

Subscribe to single test run with real-time updates.

**Options**: Same as `useRealtimeTestRuns` (without filters)

**Returns**:
```typescript
{
  testRun: TestRun | null;      // Current test run
  loading: boolean;
  error: string | null;
  connectionState: ConnectionState;
  isRealtime: boolean;
}
```

#### 4. Connection Status Component (`apps/web/components/realtime/ConnectionStatus.tsx`)

**Purpose**: Visual indicator for WebSocket connection status.

**Variants**:
- `chip`: Compact chip with icon and label
- `icon`: Icon-only circular indicator
- `full`: Full status card with details and reconnect button

**Props**:
```typescript
{
  variant?: 'chip' | 'icon' | 'full';
  position?: 'fixed' | 'static';
  showReconnect?: boolean;
}
```

**Features**:
- Color-coded status (green=connected, yellow=connecting, red=error, gray=offline)
- Tooltip with connection details (socket ID, authentication status)
- Animated transitions and pulse effect
- Manual reconnect button
- Responsive to connection state changes

## Integration

### Test Runs List Page (`apps/web/app/test-runs/page.tsx`)

**Changes**:
1. Replaced manual `loadTestRuns()` polling with `useRealtimeTestRuns()` hook
2. Added connection status indicator to header
3. Implemented toast notifications for new test runs
4. Maintained manual refresh function for error recovery
5. Automatic fallback to polling if WebSocket unavailable

**Before**:
```typescript
const [testRuns, setTestRuns] = useState<TestRun[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  loadTestRuns();
}, []);
```

**After**:
```typescript
const {
  testRuns: realtimeTestRuns,
  loading: realtimeLoading,
  error: realtimeError,
  connectionState,
  isRealtime,
} = useRealtimeTestRuns({
  fallbackToPolling: true,
  pollingInterval: 5000,
  enabled: true,
});
```

### Test Run Details Page (`apps/web/app/test-runs/[id]/page.tsx`)

**Changes**:
1. Replaced manual test run loading with `useRealtimeTestRun()` hook
2. Added connection status to header
3. Live updates for test run status, metrics, and results
4. Automatic fallback to polling
5. Maintained backward compatibility with existing components

**Before**:
```typescript
useEffect(() => {
  const loadTestRun = async () => {
    const data = await fetchTestRun(testRunId, searchParams);
    setTestRun(data);
  };
  loadTestRun();
}, [testRunId]);
```

**After**:
```typescript
const {
  testRun: realtimeTestRun,
  loading: realtimeLoading,
  error: realtimeError,
  connectionState,
  isRealtime,
} = useRealtimeTestRun(testRunId, {
  fallbackToPolling: true,
  pollingInterval: 5000,
  enabled: true,
});
```

## Environment Configuration

### Required Environment Variables

**Backend** (already configured):
```bash
REDIS_URL=redis://localhost:6380
REDIS_PASSWORD=redis_dev_password
FRONTEND_URL=http://localhost:4001
```

**Frontend**:
```bash
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8080
NEXT_PUBLIC_KEYCLOAK_REALM=perfana-prod
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=perfana-web
```

The WebSocket connection automatically derives the WS URL from `NEXT_PUBLIC_API_URL`:
- `http://localhost:3001/api` → `ws://localhost:3001/realtime`
- `https://api.example.com/api` → `wss://api.example.com/realtime`

## Event Flow

### Test Run Created
1. Backend publishes `test_run:created` to Redis
2. RealtimeService broadcasts `test_run_created` to all subscribed clients
3. Frontend hook receives event
4. New test run is prepended to the list
5. Toast notification shown (if not initial load)

### Test Run Updated
1. Backend publishes `test_run:updated` to Redis
2. RealtimeService broadcasts `test_run_updated` to all subscribed clients
3. Frontend hook receives event and adds to pending updates
4. Debounced update (300ms) applies changes to prevent flickering
5. UI updates with new data

### Test Run Deleted
1. Backend publishes `test_run:deleted` to Redis
2. RealtimeService broadcasts `test_run_deleted` to all subscribed clients
3. Frontend hook receives event
4. Test run is removed from the list
5. If viewing details page, error message is shown

## Error Handling

### Connection Failures
- Automatic reconnection with exponential backoff
- Maximum 10 reconnection attempts
- Fallback to API polling if reconnection fails
- User-friendly error messages

### Authentication Errors
- Redirect to Keycloak login page
- Token refresh handled by Keycloak library
- Connection re-established after token refresh

### Subscription Errors
- Error displayed to user
- Manual retry via refresh button
- Fallback to API polling

## Performance Optimizations

### Debounced Updates
- 300ms debounce for `test_run_updated` events
- Prevents UI flickering during rapid updates
- Batches multiple updates together

### Deduplication
- Tracks notified test runs to prevent duplicate notifications
- Prevents duplicate test runs in the list

### React.memo
- List items memoized to prevent unnecessary re-renders
- Only re-render when test run data changes

### Efficient Subscriptions
- Automatic cleanup on component unmount
- Unsubscribe from unused events
- Single WebSocket connection shared across components

## Testing

### Manual Testing Checklist

#### Connection Status
- [x] Connect to WebSocket on page load
- [x] Show "Live" indicator when connected
- [x] Show "Connecting" during connection
- [x] Show "Offline" when disconnected
- [x] Show "Connection Error" on failure
- [x] Reconnect button works
- [x] Tooltip shows connection details

#### Test Runs List
- [x] Initial test runs load correctly
- [x] New test run appears in real-time
- [x] Test run updates reflect immediately
- [x] Deleted test run is removed
- [x] Toast notification for new test runs
- [x] Manual refresh works
- [x] Fallback to polling if WebSocket fails
- [x] Filters work correctly

#### Test Run Details
- [x] Initial test run loads correctly
- [x] Live updates for running tests
- [x] Status changes reflect immediately
- [x] Metrics update in real-time
- [x] Manual refresh works
- [x] Fallback to polling if WebSocket fails

### Integration Testing

```typescript
// Test WebSocket connection
describe('WebSocket Connection', () => {
  it('should connect with valid token', async () => {
    await socketManager.connect();
    expect(socketManager.isConnected()).toBe(true);
  });

  it('should reconnect after disconnect', async () => {
    socketManager.disconnect();
    await socketManager.connect();
    expect(socketManager.isConnected()).toBe(true);
  });
});

// Test real-time hooks
describe('useRealtimeTestRuns', () => {
  it('should receive initial test runs', async () => {
    const { result } = renderHook(() => useRealtimeTestRuns());
    await waitFor(() => {
      expect(result.current.testRuns.length).toBeGreaterThan(0);
    });
  });

  it('should update on test_run_created event', async () => {
    const { result } = renderHook(() => useRealtimeTestRuns());
    // Emit test_run_created event
    // Verify test run is added
  });
});
```

## Troubleshooting

### WebSocket Connection Fails
1. Check backend is running: `http://localhost:3001/api/health`
2. Check Redis is running: `redis-cli -h localhost -p 6380 -a redis_dev_password ping`
3. Check CORS configuration in backend
4. Check firewall/proxy settings
5. Verify Keycloak token is valid

### Events Not Received
1. Check subscription confirmed: Look for `subscription_confirmed` event in console
2. Check Redis PubSub: `redis-cli -h localhost -p 6380 -a redis_dev_password PUBSUB CHANNELS`
3. Verify backend publishes events: Check backend logs
4. Check event filtering on frontend

### UI Not Updating
1. Check React DevTools for state changes
2. Verify event payload structure matches types
3. Check debounce timing (300ms delay)
4. Verify component is not memoized incorrectly

### High CPU/Memory Usage
1. Check for memory leaks: Ensure cleanup functions are called
2. Monitor WebSocket message frequency
3. Increase debounce delay if too many updates
4. Consider pagination for large datasets

## Future Enhancements

### Planned Features
- [ ] Filter-specific subscriptions (only subscribe to filtered test runs)
- [ ] Compressed message payloads for bandwidth optimization
- [ ] Offline support with local storage caching
- [ ] Multi-tab synchronization via BroadcastChannel
- [ ] WebSocket connection pooling
- [ ] Metrics dashboard for connection health

### Performance Improvements
- [ ] Virtual scrolling for large test run lists
- [ ] Incremental updates (only send changed fields)
- [ ] Binary protocol (MessagePack) for smaller payloads
- [ ] Selective field subscriptions

### Enhanced User Experience
- [ ] Sound/visual notifications for important events
- [ ] Connection quality indicator (latency, packet loss)
- [ ] Offline mode with sync on reconnect
- [ ] Real-time collaboration features

## Dependencies

### New Dependencies
- `socket.io-client`: ^4.8.1 (WebSocket client library)

### Backend Dependencies (Already Installed)
- `@nestjs/websockets`: WebSocket server support
- `@nestjs/platform-socket.io`: Socket.IO adapter for NestJS
- `socket.io`: Socket.IO server
- `ioredis`: Redis client for PubSub

## References

### Documentation
- [Socket.IO Client Documentation](https://socket.io/docs/v4/client-api/)
- [NestJS WebSockets](https://docs.nestjs.com/websockets/gateways)
- [React Hooks Best Practices](https://react.dev/reference/react)

### Backend Implementation
- `apps/api/src/modules/realtime/realtime.gateway.ts` - WebSocket gateway
- `apps/api/src/modules/realtime/realtime.service.ts` - Real-time service
- `apps/api/src/modules/realtime/realtime.module.ts` - Module configuration

### Frontend Implementation
- `apps/web/lib/socket.ts` - WebSocket connection manager
- `apps/web/hooks/useRealtime.ts` - React hooks for real-time updates
- `apps/web/components/realtime/ConnectionStatus.tsx` - Connection status indicator
- `apps/web/types/realtime.ts` - Type definitions

## Support

For issues or questions:
1. Check backend logs: `docker logs perfana-api`
2. Check Redis logs: `docker logs perfana-redis`
3. Enable debug logging: Set `enableLogging: true` in socket config
4. Use browser DevTools Network tab to inspect WebSocket traffic
5. Check `/api/docs` for API documentation

---

**Implementation Date**: 2025-10-22
**Status**: ✅ Complete
**Version**: 1.0.0
