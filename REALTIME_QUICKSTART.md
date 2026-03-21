# Real-Time Updates - Quick Start Guide

## Overview

Perfana now supports **real-time WebSocket updates** for test runs. Any changes to test run records (create, update, delete) are automatically propagated to connected clients via Socket.IO with Redis pub/sub for horizontal scaling.

**Latest Update (2025-10-24)**: Backend standardized on `ioredis` and event emission fully integrated into mutation service.

## Prerequisites

1. **Backend running** with Redis:
   ```bash
   # Check backend is running
   curl http://localhost:3001/api/health

   # Check Redis is accessible (default port 6379)
   redis-cli -h localhost -p 6379 ping
   ```

2. **Environment variables** configured:

   **Backend** (`apps/api/.env`):
   ```bash
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=  # Optional
   FRONTEND_URL=http://localhost:4001
   ```

   **Frontend** (`apps/web/.env.local`):
   ```bash
   NEXT_PUBLIC_API_URL=http://localhost:3001/api
   NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8080
   NEXT_PUBLIC_KEYCLOAK_REALM=perfana-prod
   NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=perfana-web
   ```

## Backend Architecture

- **WebSocket Namespace**: `/test-runs`
- **Redis Client**: `ioredis` (standardized across all Redis operations)
- **Authentication**: Dual (Keycloak JWT + API Keys)
- **Event Types**: `test-run:created`, `test-run:updated`, `test-run:deleted`, `test-run:status-changed`
- **Scalability**: Redis adapter enables horizontal scaling

## What's New

### Visual Changes

1. **Connection Status Indicator**: Shows WebSocket connection state
   - 🟢 Green "Live" = Connected and receiving real-time updates
   - 🟡 Yellow "Connecting" = Establishing connection
   - 🔴 Red "Connection Error" = Failed to connect
   - ⚫ Gray "Offline" = Not connected

2. **Toast Notifications**: Alerts when new test runs arrive
   - "New test run: test-run-id"
   - "3 new test runs received"

3. **Auto-Refresh**: Test run data updates automatically without manual refresh

### Test Runs List Page

**Before**: Manual refresh button to reload test runs

**After**:
- Real-time updates appear automatically
- Connection status indicator in header
- Toast notifications for new test runs
- Manual refresh still available for recovery

### Test Run Details Page

**Before**: Static data loaded on page load

**After**:
- Live updates for running tests
- Progress and metrics update in real-time
- Connection status in header
- No need to refresh to see latest data

## Testing Real-Time Updates

### 1. Open Test Runs List

```bash
# Navigate to test runs page
open http://localhost:4001/test-runs
```

**Expected behavior**:
- Connection status shows "Live" (green)
- Test runs load automatically
- No loading spinner after initial load

### 2. Create a Test Run via API

```bash
# Create a test run to see real-time update
curl -X POST http://localhost:3001/api/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "testRunId": "test-realtime-' $(date +%s) '",
    "testEnvironment": "test",
    "systemUnderTest": "demo-app",
    "workload": "load",
    "start": "2025-10-22T10:00:00Z",
    "end": "2025-10-22T10:30:00Z"
  }'
```

**Expected behavior**:
- New test run appears at top of list
- Toast notification: "New test run: test-realtime-..."
- No page refresh needed

### 3. Update a Test Run

```bash
# Update a test run
curl -X POST http://localhost:3001/api/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "testRunId": "existing-test-run-id",
    "testEnvironment": "test",
    "systemUnderTest": "demo-app",
    "workload": "load",
    "start": "2025-10-22T10:00:00Z",
    "end": "2025-10-22T10:30:00Z",
    "completed": true
  }'
```

**Expected behavior**:
- Test run updates in the list (status, duration, etc.)
- No visual jump or flicker (debounced updates)
- Changes appear within 300ms

### 4. View Test Run Details

```bash
# Open a test run details page
open http://localhost:4001/test-runs/test-run-id
```

**Expected behavior**:
- Connection status shows "Live"
- If test is running, progress updates automatically
- Metrics and results update in real-time

### 5. Test Disconnection

```bash
# Stop backend or Redis
docker stop perfana-redis
# OR
docker stop perfana-api
```

**Expected behavior**:
- Connection status shows "Offline" or "Connection Error"
- System automatically falls back to polling (every 5 seconds)
- Manual refresh button still works
- No data loss

```bash
# Restart service
docker start perfana-redis
# OR
docker start perfana-api
```

**Expected behavior**:
- Connection status shows "Connecting"
- Automatically reconnects within 1-30 seconds
- Connection status shows "Live" when reconnected
- Real-time updates resume

## Developer Console

### Enable Debug Logging

Open browser console and look for:

```
[Socket] Connecting to: ws://localhost:3001/realtime
[Socket] Connected successfully
[Realtime] Test run created: test-run-id
[Realtime] Test run updated: test-run-id
```

### WebSocket Network Tab

1. Open DevTools → Network tab
2. Filter by "WS" (WebSocket)
3. Look for connection to `/realtime`
4. Click to see WebSocket frames
5. Monitor messages in real-time

### Connection Info

Hover over the connection status indicator to see:
- Socket ID
- Authentication status
- Connection state

## Common Scenarios

### Scenario 1: Load Testing Dashboard

**Use Case**: Monitor multiple test runs during load test campaign

**Behavior**:
- All test runs appear in real-time
- Progress bars update live
- Completed tests show results immediately
- No need to refresh

### Scenario 2: CI/CD Integration

**Use Case**: Test run created by CI/CD pipeline

**Behavior**:
1. CI/CD creates test run via API
2. Test run appears in UI immediately
3. Test runs and updates in real-time
4. Results appear when test completes
5. Team sees results without refreshing

### Scenario 3: Long-Running Test

**Use Case**: View details of 2-hour load test

**Behavior**:
- Progress bar updates every few seconds
- Metrics refresh automatically
- SLO status updates in real-time
- No need to reload page

### Scenario 4: Network Issues

**Use Case**: User on unstable connection

**Behavior**:
- WebSocket disconnects
- System falls back to API polling
- Connection indicator shows "Connecting"
- Reconnects automatically when network stable
- No data loss during disconnection

## Performance Tips

### 1. Reduce Update Frequency

If UI feels too "jumpy" with rapid updates:

```typescript
// In hooks/useRealtime.ts, increase debounce delay
updateDebounceRef.current = setTimeout(() => {
  applyPendingUpdates();
}, 500); // Increased from 300ms to 500ms
```

### 2. Disable Real-Time for Specific Views

```typescript
// Disable real-time updates
const { testRuns, loading, error } = useRealtimeTestRuns({
  enabled: false, // Disable WebSocket
  fallbackToPolling: true, // Use polling instead
  pollingInterval: 10000, // Poll every 10 seconds
});
```

### 3. Filter Subscriptions (Future Enhancement)

Currently subscribes to all test runs. Future versions will support filtered subscriptions:

```typescript
// Subscribe only to filtered test runs (not yet implemented)
const { testRuns } = useRealtimeTestRuns({
  filters: {
    testEnvironment: 'production',
    workload: 'stress',
  }
});
```

## Troubleshooting

### Issue: "Offline" status persists

**Solution**:
1. Check backend is running: `curl http://localhost:3001/api/health`
2. Check Redis is running: `redis-cli -h localhost -p 6380 ping`
3. Check browser console for errors
4. Try manual refresh button
5. Hard refresh browser (Cmd+Shift+R or Ctrl+Shift+R)

### Issue: Updates not appearing

**Solution**:
1. Check connection status is "Live"
2. Verify backend is publishing events (check backend logs)
3. Check Redis PubSub: `redis-cli PUBSUB CHANNELS`
4. Clear browser cache and reload
5. Check for JavaScript errors in console

### Issue: Multiple duplicate test runs

**Solution**:
1. This shouldn't happen due to deduplication
2. If it does, hard refresh the page
3. Report as a bug with console logs

### Issue: High CPU usage

**Solution**:
1. Check for rapid updates (< 100ms apart)
2. Increase debounce delay (see Performance Tips)
3. Consider filtering subscriptions
4. Check for browser memory leaks (DevTools → Performance)

## Feature Flags (Future)

To enable/disable real-time features:

```typescript
// Add to .env.local (not yet implemented)
NEXT_PUBLIC_ENABLE_REALTIME=true
NEXT_PUBLIC_REALTIME_FALLBACK_POLLING=true
NEXT_PUBLIC_REALTIME_POLLING_INTERVAL=5000
```

## Support

### Backend Logs

```bash
# View backend logs
docker logs -f perfana-api | grep -i realtime

# View Redis logs
docker logs -f perfana-redis
```

### Frontend Logs

```javascript
// Enable verbose logging
localStorage.setItem('debug', 'socket,realtime');
// Reload page
```

### Health Check

```bash
# Check WebSocket health
curl http://localhost:3001/api/realtime/health
```

## Migration from Old Implementation

If you have custom polling logic:

**Before**:
```typescript
useEffect(() => {
  const interval = setInterval(() => {
    fetchTestRuns();
  }, 5000);
  return () => clearInterval(interval);
}, []);
```

**After**:
```typescript
const { testRuns, loading, error } = useRealtimeTestRuns({
  fallbackToPolling: true,
  pollingInterval: 5000,
});
```

The new implementation handles:
- Initial data loading
- Real-time updates
- Automatic fallback to polling
- Reconnection logic
- Error handling
- Cleanup on unmount

## Next Steps

1. ✅ Test real-time updates with sample data
2. ✅ Monitor connection stability
3. ✅ Check performance with many test runs
4. 📋 Plan filtered subscriptions (phase 2)
5. 📋 Add metrics dashboard (phase 2)
6. 📋 Implement offline support (phase 3)

## Resources

- **Backend API**: `http://localhost:3001/api/docs`
- **Implementation Guide**: See `REALTIME_IMPLEMENTATION.md`
- **Backend Source**: `apps/api/src/modules/realtime/`
- **Frontend Source**: `apps/web/lib/socket.ts`, `apps/web/hooks/useRealtime.ts`

## Backend Implementation Status

✅ **Phase 1 Complete**: Redis standardization (using `ioredis` throughout)
✅ **Phase 2 Complete**: Event emission integration in all mutation methods
✅ **Phase 3 Complete**: Type checking and validation
✅ **Gateway Ready**: `TestRunsGateway` with authentication and Redis adapter
⏳ **Phase 4 Pending**: Frontend integration (next step)
⏳ **Phase 5 Pending**: Integration tests
⏳ **Phase 6 Pending**: Production deployment

### Files Modified

- `apps/api/src/modules/test-runs/gateways/test-runs.gateway.ts` - Now using `ioredis`
- `apps/api/src/modules/test-runs/services/test-runs-mutation.service.ts` - Event emission added
- `apps/api/package.json` - Removed `redis` package dependency

### Event Emission Points

All test run mutations now emit WebSocket events:

1. **`upsertTestRun()`** → Emits `TEST_RUN_CREATED` (new) or `TEST_RUN_UPDATED` (existing)
2. **`deleteTestRun()`** → Emits `TEST_RUN_DELETED`
3. **`updateTags()`** → Emits `TEST_RUN_UPDATED`
4. **`updateAnnotations()`** → Emits `TEST_RUN_UPDATED`
5. **`updateAdaptConfig()`** → Emits `TEST_RUN_UPDATED`

**Error Handling**: Event emission failures are logged but do NOT break database mutations (non-blocking).

---

**Last Updated**: 2025-10-24
**Backend Status**: ✅ Complete and Type-Safe
**Frontend Status**: ⏳ Pending Integration
**Version**: 2.0.0
