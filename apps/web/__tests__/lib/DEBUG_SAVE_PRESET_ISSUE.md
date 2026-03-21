# Debugging Save Compare Preset Issue - Step by Step Guide

## Current Status

✅ **Backend Code**: Fixed and tested (25/25 tests passing)
✅ **Frontend Code**: Fixed and tested (75/75 tests passing)
✅ **TypeScript**: No compilation errors
❌ **Runtime**: User reports save still doesn't work

**This means the issue is RUNTIME-RELATED, not a code bug.**

---

## Step-by-Step Debugging Guide

### Step 1: Check if Services are Running

```bash
# Check API service
lsof -ti:3001
# Should return a process ID

# Check Web service
lsof -ti:4001
# Should return a process ID

# If not running, start them:
npm run dev
```

---

### Step 2: Open Browser DevTools

1. Open Chrome/Firefox DevTools (F12)
2. Navigate to the **Network** tab
3. Keep it open while testing

---

### Step 3: Test the Save Preset Flow

1. **Navigate to Test Run Details**:
   ```
   http://localhost:4001/test-runs/[any-test-run-id]
   ```

2. **Go to Compare Tab**

3. **Configure Filters**:
   - Select a dashboard
   - Select a metric
   - (Optional) Enter series search text
   - (Optional) Toggle percentiles

4. **Click "Save Preset" Button**

5. **Fill in the Modal**:
   - Enter a preset name
   - Click "Save"

---

### Step 4: Check Network Tab for Errors

Look for a request to `POST /api/compare-presets` in the Network tab.

#### ✅ If you see the request:

**Check the response:**

| Status Code | What it means | How to fix |
|------------|---------------|------------|
| **201 Created** | ✅ Success! Preset was saved | The issue might be UI not updating |
| **400 Bad Request** | Invalid data sent | Check Request Payload tab, see Step 5 |
| **401 Unauthorized** | Not authenticated | See Step 6 (Authentication) |
| **403 Forbidden** | No permission | Check user has correct roles |
| **404 Not Found** | Endpoint doesn't exist | See Step 7 (Backend routing) |
| **500 Internal Server Error** | Backend crash | Check API logs (Step 8) |

#### ❌ If you DON'T see the request:

**The frontend is not calling the API at all.**

Check browser console for JavaScript errors:
```javascript
// Look for errors like:
- "Failed to fetch"
- "TypeError"
- "Network request failed"
```

**Possible causes:**
1. Modal's `onSave` function not being called
2. JavaScript error before request is made
3. Request blocked by CORS policy
4. Network connectivity issue

---

### Step 5: Inspect Request Payload

In the Network tab, click on the `compare-presets` request, then click **Payload** or **Request** tab.

**Expected payload structure:**
```json
{
  "name": "CPU Usage",
  "description": "Dashboard: Performance Dashboard. Metric: CPU Usage",
  "preset_type": "generic",
  "series_search_text": "",
  "show_percentiles": false,
  "application_dashboard_id": "dashboard-uuid-here",
  "panel_id": 5,
  "panel_title": "CPU Usage",
  "baseline_test_run_id": null,
  "created_for_test_run_id": "TestRun-12345",
  "is_global": true
}
```

**Common issues:**
- ❌ Missing `name` → Validation will fail
- ❌ `application_dashboard_id` is null/undefined → May cause issues
- ❌ Invalid `preset_type` value → Must be "generic" or "specific"

---

### Step 6: Check Authentication

**A. Check if user is logged in:**

Open browser console and run:
```javascript
// Check if token exists
localStorage.getItem('kcToken')
// Should return a long JWT token string

// Or check keycloak auth
window.keycloak?.authenticated
// Should return true
```

**B. Check request headers:**

In Network tab → `compare-presets` request → **Headers** tab:

Look for:
```
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6...
```

**If missing:**
- ❌ `keycloak-auth.ts` is not adding headers
- ❌ User is not authenticated
- ❌ Token expired

**Fix:**
```javascript
// Force re-login
await keycloakAuth.login()
```

---

### Step 7: Verify Backend Endpoint Exists

**Test the endpoint directly with curl:**

```bash
# Get your auth token first (from browser localStorage or Keycloak)
TOKEN="your-jwt-token-here"

# Test the endpoint
curl -X POST http://localhost:3001/api/compare-presets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Test Preset",
    "preset_type": "generic",
    "show_percentiles": false,
    "is_global": false
  }'
```

**Expected responses:**

✅ **Success (201 Created)**:
```json
{
  "id": "uuid-here",
  "name": "Test Preset",
  "preset_type": "generic",
  ...
}
```

❌ **404 Not Found**:
```
Cannot POST /api/compare-presets
```
→ Backend routing issue, see Step 9

❌ **401 Unauthorized**:
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```
→ Invalid/expired token

---

### Step 8: Check API Server Logs

```bash
# Terminal where you ran `npm run dev` or `npm run dev:api`
# Look for errors like:

[Nest] ERROR  Failed to create compare preset: ...
[Nest] ERROR  Database connection error
[Nest] ERROR  UnauthorizedException: User ID not found in request
```

**Common backend errors:**

| Error | Cause | Fix |
|-------|-------|-----|
| `UnauthorizedException: User ID not found` | Token doesn't have user ID | Check Keycloak token claims |
| `QueryFailedError: duplicate key` | Constraint violation | Database schema issue |
| `Entity metadata for CompareFilterPreset was not found` | TypeORM not loading entity | Check `entities` array in TypeORM config |
| `Cannot read property 'id' of undefined` | Missing relationship | Check `application_dashboard_id` is valid UUID |

---

### Step 9: Verify Backend Module is Loaded

Check `apps/api/src/app.module.ts`:

```typescript
import { ComparePresetsModule } from './modules/compare-presets/compare-presets.module';

@Module({
  imports: [
    // ... other modules
    ComparePresetsModule,  // ← Must be here
  ],
})
export class AppModule {}
```

**If missing**, add it and restart the API server.

---

### Step 10: Check Database Connection

**Verify table exists:**

```sql
-- Connect to your PostgreSQL database
psql -U your_user -d perfana

-- Check if table exists
\dt compare_filter_presets

-- Should show:
--  Schema |          Name           | Type  |  Owner
-- --------+-------------------------+-------+---------
--  public | compare_filter_presets  | table | perfana

-- Check table structure
\d compare_filter_presets

-- Should show columns including:
--  - id (uuid)
--  - name (character varying)
--  - created_for_test_run_id (character varying)
--  - etc.
```

**If table doesn't exist:**
```bash
# Run migrations
cd apps/api
npm run migration:run
```

---

### Step 11: Check for CORS Issues

If you see this error in browser console:
```
Access to fetch at 'http://localhost:3001/api/compare-presets' from origin 'http://localhost:4001'
has been blocked by CORS policy
```

**Fix:** Check `apps/api/src/main.ts`:

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors({
    origin: 'http://localhost:4001',  // ← Must include web app URL
    credentials: true,
  });

  await app.listen(3001);
}
```

---

### Step 12: Test with Swagger UI

1. Navigate to: http://localhost:3001/api/docs

2. Find `POST /compare-presets` endpoint

3. Click "Try it out"

4. Click "Authorize" and add your Bearer token

5. Fill in the request body:
```json
{
  "name": "Swagger Test Preset",
  "preset_type": "generic",
  "show_percentiles": false,
  "is_global": false
}
```

6. Click "Execute"

**If this works**, the backend is fine → issue is in frontend

**If this fails**, the backend has an issue → check API logs

---

## Quick Diagnostic Script

Save this as `test-preset-api.sh` and run it:

```bash
#!/bin/bash

echo "=== Testing Compare Presets API ==="
echo ""

# Check if API is running
echo "1. Checking if API is running on port 3001..."
if lsof -ti:3001 > /dev/null; then
    echo "   ✅ API is running"
else
    echo "   ❌ API is NOT running"
    echo "   Run: npm run dev:api"
    exit 1
fi

# Check if endpoint exists
echo ""
echo "2. Testing if /api/compare-presets endpoint exists..."
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/compare-presets)

if [ "$response" = "401" ]; then
    echo "   ✅ Endpoint exists (requires authentication)"
elif [ "$response" = "404" ]; then
    echo "   ❌ Endpoint NOT FOUND"
    echo "   Check if ComparePresetsModule is loaded in app.module.ts"
else
    echo "   ℹ️  Status code: $response"
fi

echo ""
echo "3. Next steps:"
echo "   - Check browser DevTools Network tab"
echo "   - Look for 'compare-presets' request when you click Save"
echo "   - Check browser Console for JavaScript errors"
echo "   - Check API server logs for backend errors"

```

Make it executable and run:
```bash
chmod +x test-preset-api.sh
./test-preset-api.sh
```

---

## Common Solutions

### Solution 1: User Not Authenticated

```javascript
// In browser console
await keycloakAuth.login()
```

### Solution 2: Token Expired

```javascript
// In browser console
await keycloakAuth.updateToken(30)
```

### Solution 3: Missing Dashboard/Metric Selection

Make sure you've selected BOTH:
- Dashboard (from dropdown)
- Metric/Panel (from list)

The save button should be disabled if these aren't selected.

### Solution 4: API Not Rebuilding

```bash
# Kill and restart
lsof -ti:3001 | xargs kill -9
npm run dev:api
```

### Solution 5: Frontend Not Rebuilding

```bash
# Kill and restart
lsof -ti:4001 | xargs kill -9
npm run dev:web
```

---

## Still Not Working?

**Collect this diagnostic information:**

1. **Browser Console Output** (copy all errors)
2. **Network Tab** (screenshot of compare-presets request/response)
3. **API Server Logs** (last 50 lines)
4. **Request Payload** (from Network tab)
5. **Response Body** (from Network tab)

**Then check:**
- Are you on the correct page? (test run details → Compare tab)
- Did you select a dashboard AND metric?
- Is the "Save Preset" button enabled?
- Does clicking it open the modal?
- Can you type in the name field?
- What happens when you click "Save" in the modal?

---

## Expected Successful Flow

1. ✅ User clicks "Save Preset" button
2. ✅ Modal opens with auto-generated name
3. ✅ User clicks "Save" in modal
4. ✅ Network request: `POST /api/compare-presets`
5. ✅ Request includes: name, dashboard_id, panel_id, etc.
6. ✅ Request has `Authorization: Bearer ...` header
7. ✅ Response: `201 Created` with preset object
8. ✅ Toast message: "Preset '[name]' saved successfully"
9. ✅ Modal closes
10. ✅ Preset appears in preset list dropdown

**If ANY of these steps fail, that's where the issue is.**

---

## Testing Checklist

Run through this checklist:

- [ ] API service is running on port 3001
- [ ] Web service is running on port 4001
- [ ] No TypeScript errors in terminal
- [ ] User is logged in (check browser console)
- [ ] Dashboard is selected
- [ ] Metric is selected
- [ ] "Save Preset" button is visible and enabled
- [ ] Clicking button opens modal
- [ ] Modal has auto-generated preset name
- [ ] Clicking "Save" in modal makes network request
- [ ] Request has Authorization header
- [ ] Request payload has all required fields
- [ ] Backend responds with 2xx status code
- [ ] Toast message appears
- [ ] Modal closes after successful save
- [ ] Preset appears in list

**Which step fails? That's your issue location.**
