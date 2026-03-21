#!/bin/bash

echo "=== Testing Compare Presets API ==="
echo ""

# Check if API is running
echo "1. Checking if API is running on port 3001..."
if lsof -ti:3001 > /dev/null 2>&1; then
    echo "   ✅ API is running"
else
    echo "   ❌ API is NOT running"
    echo "   Run: npm run dev:api"
    exit 1
fi

# Check if Web is running
echo ""
echo "2. Checking if Web app is running on port 4001..."
if lsof -ti:4001 > /dev/null 2>&1; then
    echo "   ✅ Web app is running"
else
    echo "   ❌ Web app is NOT running"
    echo "   Run: npm run dev:web"
fi

# Check if endpoint exists
echo ""
echo "3. Testing if /api/compare-presets endpoint exists..."
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/compare-presets 2>/dev/null)

if [ "$response" = "401" ]; then
    echo "   ✅ Endpoint exists (requires authentication)"
elif [ "$response" = "404" ]; then
    echo "   ❌ Endpoint NOT FOUND"
    echo "   Check if ComparePresetsModule is loaded in app.module.ts"
elif [ "$response" = "000" ]; then
    echo "   ❌ Cannot connect to API (is it running?)"
else
    echo "   ℹ️  Status code: $response"
fi

# Test GET endpoint
echo ""
echo "4. Testing GET /api/compare-presets (should require auth)..."
get_response=$(curl -s -w "\nHTTP_CODE:%{http_code}" http://localhost:3001/api/compare-presets 2>/dev/null)
http_code=$(echo "$get_response" | grep "HTTP_CODE" | cut -d: -f2)

if [ "$http_code" = "401" ]; then
    echo "   ✅ GET endpoint properly requires authentication"
elif [ "$http_code" = "200" ]; then
    echo "   ⚠️  GET endpoint returned 200 (should require auth)"
else
    echo "   ℹ️  GET returned status: $http_code"
fi

echo ""
echo "5. Testing POST /api/compare-presets (without auth)..."
post_response=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -w "\nHTTP_CODE:%{http_code}" \
  http://localhost:3001/api/compare-presets \
  -d '{"name":"Test","preset_type":"generic","show_percentiles":false,"is_global":false}' 2>/dev/null)
post_code=$(echo "$post_response" | grep "HTTP_CODE" | cut -d: -f2)

if [ "$post_code" = "401" ]; then
    echo "   ✅ POST endpoint properly requires authentication"
elif [ "$post_code" = "403" ]; then
    echo "   ✅ POST endpoint requires authentication (403 Forbidden)"
else
    echo "   ℹ️  POST returned status: $post_code"
fi

echo ""
echo "=== Summary ==="
echo ""
echo "API Status: $(lsof -ti:3001 > /dev/null 2>&1 && echo '✅ Running' || echo '❌ Not Running')"
echo "Web Status: $(lsof -ti:4001 > /dev/null 2>&1 && echo '✅ Running' || echo '❌ Not Running')"
echo "Endpoint Status: $([ "$response" = "401" ] && echo '✅ Exists (auth required)' || echo '❌ Issue detected')"
echo ""
echo "=== Next Steps ==="
echo ""
echo "If both services are running and endpoint exists:"
echo "  1. Open browser DevTools (F12) → Network tab"
echo "  2. Navigate to: http://localhost:4001/test-runs/[test-run-id]"
echo "  3. Go to Compare tab"
echo "  4. Select dashboard and metric"
echo "  5. Click 'Save Preset' button"
echo "  6. Look for 'compare-presets' request in Network tab"
echo "  7. Check Response status and payload"
echo ""
echo "If you see 401 Unauthorized:"
echo "  - Check browser console: localStorage.getItem('kcToken')"
echo "  - Verify Keycloak authentication is working"
echo ""
echo "If you see 400 Bad Request:"
echo "  - Check Request Payload in Network tab"
echo "  - Verify all required fields are being sent"
echo ""
echo "If you don't see any request:"
echo "  - Check browser Console tab for JavaScript errors"
echo "  - Verify 'Save Preset' button click is working"
echo ""
