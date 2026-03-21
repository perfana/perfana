# Port Conflict Fix - Durable Solution

## Problem
Every time code changes were made, nodemon would restart the API server but fail with:
```
Error: listen EADDRINUSE: address already in use :::3001
```

This happened because:
1. Nodemon wasn't sending proper termination signals to the old process
2. The NestJS application wasn't handling graceful shutdown
3. Old processes remained bound to ports 3001 and 3002

## Durable Solution Implemented

### 1. Nodemon Configuration (`apps/api/nodemon.json`)
Created a nodemon configuration file with:
- **Signal**: `SIGTERM` - Sends termination signal to the process
- **Delay**: 1000ms - Waits 1 second before restarting (gives time for cleanup)
- **Verbose**: Enabled for better debugging
- **Watch**: Only watches the `dist` directory (compiled output)

```json
{
  "watch": ["dist"],
  "ext": "js",
  "signal": "SIGTERM",
  "delay": 1000,
  "restartable": "rs",
  "verbose": true
}
```

### 2. Graceful Shutdown in NestJS Applications

#### API Service (`apps/api/src/main.ts`)
Added graceful shutdown handlers:
```typescript
// Enable graceful shutdown
app.enableShutdownHooks();

// Handle termination signals
const signals = ['SIGTERM', 'SIGINT'];
signals.forEach(signal => {
  process.on(signal, async () => {
    logger.log(`Received ${signal}, closing application gracefully...`);
    try {
      await app.close();
      logger.log('Application closed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  });
});
```

#### Grafana Sync Service (`apps/grafana-sync/src/main.ts`)
Applied the same graceful shutdown handlers.

## How It Works

1. **On Code Change**: TypeScript compiler detects changes and recompiles
2. **Nodemon Detects Change**: Sees the compiled JS file changed in `dist/`
3. **Sends SIGTERM**: Nodemon sends a SIGTERM signal to the running process
4. **Graceful Shutdown**: NestJS application receives SIGTERM
   - Closes all active connections
   - Stops accepting new requests
   - Releases the port binding
   - Exits cleanly
5. **Wait Period**: Nodemon waits 1 second (delay)
6. **Restart**: Nodemon starts a new process
7. **Success**: New process binds to port 3001 without conflicts

## Benefits

- ✅ **Automatic**: No manual intervention needed
- ✅ **Reliable**: Proper signal handling prevents zombie processes
- ✅ **Clean**: No forceful kills or port conflicts
- ✅ **Fast**: 1-second delay keeps development responsive
- ✅ **Safe**: Prevents data corruption from abrupt shutdowns
- ✅ **Comprehensive**: Applied to both API and Grafana Sync services

## Verification

To verify the fix is working:
1. Make a code change in `apps/api/src/`
2. Watch the console output
3. You should see:
   - "Received SIGTERM, closing application gracefully..."
   - "Application closed successfully"
   - "[nodemon] restarting due to changes..."
   - "Perfana API running on http://localhost:3001"

No more `EADDRINUSE` errors!

## Additional Notes

- The `app.enableShutdownHooks()` method tells NestJS to properly clean up lifecycle hooks
- Signal handlers ensure database connections and other resources are closed properly
- The 1-second delay in nodemon gives enough time for cleanup without being noticeable
- This pattern is production-ready and follows NestJS best practices
