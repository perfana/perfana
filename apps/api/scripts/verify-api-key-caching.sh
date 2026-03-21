#!/bin/bash

# API Key Caching Verification Script
# This script verifies the API key caching implementation is working correctly

set -e

echo "========================================="
echo "API Key Caching Verification"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

API_URL="${API_URL:-http://localhost:3001/api}"
TOKEN=""

# Function to print colored output
print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
  echo -e "$1"
}

# Step 1: Check Redis connection
echo "1. Checking Redis connection..."
if redis-cli ping > /dev/null 2>&1; then
  print_success "Redis is running"
else
  print_error "Redis is not running. Start Redis with: redis-server"
  exit 1
fi
echo ""

# Step 2: Create a test API key
echo "2. Creating test API key..."
CREATE_RESPONSE=$(curl -s -X POST "${API_URL}/api-keys" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "cache-test-key",
    "ttl": "1d"
  }')

TOKEN=$(echo $CREATE_RESPONSE | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  print_error "Failed to create API key"
  echo "Response: $CREATE_RESPONSE"
  exit 1
fi

print_success "API key created: ${TOKEN:0:20}..."
echo ""

# Step 3: Clear cache to start fresh
echo "3. Clearing cache for fresh start..."
CLEAR_RESPONSE=$(curl -s -X POST "${API_URL}/api-keys/cache/clear")
print_success "Cache cleared"
echo ""

# Step 4: First validation (should be CACHE MISS)
echo "4. First validation (expected: CACHE MISS)..."
START_TIME=$(date +%s%3N)
VALIDATE_RESPONSE=$(curl -s -X POST "${API_URL}/api-keys/validate" \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$TOKEN\"}")
END_TIME=$(date +%s%3N)
FIRST_DURATION=$((END_TIME - START_TIME))

IS_VALID=$(echo $VALIDATE_RESPONSE | grep -o '"valid":true' || echo "false")
if [ "$IS_VALID" != "false" ]; then
  print_success "Validation successful (${FIRST_DURATION}ms)"
else
  print_error "Validation failed"
  echo "Response: $VALIDATE_RESPONSE"
  exit 1
fi
echo ""

# Step 5: Get cache stats after first validation
echo "5. Cache statistics after first validation..."
STATS_1=$(curl -s "${API_URL}/api-keys/cache/stats")
HITS_1=$(echo $STATS_1 | grep -o '"hits":[0-9]*' | cut -d':' -f2)
MISSES_1=$(echo $STATS_1 | grep -o '"misses":[0-9]*' | cut -d':' -f2)
print_info "   Hits: $HITS_1, Misses: $MISSES_1"
echo ""

# Step 6: Subsequent validations (should be CACHE HIT)
echo "6. Performing 10 validations (expected: CACHE HIT)..."
TOTAL_DURATION=0
for i in {1..10}; do
  START_TIME=$(date +%s%3N)
  curl -s -X POST "${API_URL}/api-keys/validate" \
    -H "Content-Type: application/json" \
    -d "{\"token\": \"$TOKEN\"}" > /dev/null
  END_TIME=$(date +%s%3N)
  DURATION=$((END_TIME - START_TIME))
  TOTAL_DURATION=$((TOTAL_DURATION + DURATION))
done
AVG_DURATION=$((TOTAL_DURATION / 10))
print_success "10 validations completed (avg: ${AVG_DURATION}ms)"
echo ""

# Step 7: Final cache stats
echo "7. Final cache statistics..."
STATS_2=$(curl -s "${API_URL}/api-keys/cache/stats")
HITS_2=$(echo $STATS_2 | grep -o '"hits":[0-9]*' | cut -d':' -f2)
MISSES_2=$(echo $STATS_2 | grep -o '"misses":[0-9]*' | cut -d':' -f2)
HIT_RATE=$(echo $STATS_2 | grep -o '"hitRate":"[^"]*"' | cut -d'"' -f4)

print_info "   Hits: $HITS_2, Misses: $MISSES_2, Hit Rate: $HIT_RATE"
echo ""

# Step 8: Performance comparison
echo "8. Performance comparison..."
IMPROVEMENT=$((FIRST_DURATION / (AVG_DURATION + 1)))
print_info "   First validation (miss): ${FIRST_DURATION}ms"
print_info "   Average cached validation: ${AVG_DURATION}ms"

if [ $AVG_DURATION -lt $FIRST_DURATION ]; then
  print_success "Cache is ${IMPROVEMENT}x faster than database lookup"
else
  print_warning "Cache performance similar to database (may need optimization)"
fi
echo ""

# Step 9: Test cache invalidation
echo "9. Testing cache invalidation..."
# Get the API key ID from the list
LIST_RESPONSE=$(curl -s "${API_URL}/api-keys")
KEY_ID=$(echo $LIST_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$KEY_ID" ]; then
  DELETE_RESPONSE=$(curl -s -X DELETE "${API_URL}/api-keys/$KEY_ID")
  print_success "API key deleted (cache should be invalidated)"

  # Try validating the deleted key (should fail)
  VALIDATE_DELETED=$(curl -s -X POST "${API_URL}/api-keys/validate" \
    -H "Content-Type: application/json" \
    -d "{\"token\": \"$TOKEN\"}")

  IS_VALID_DELETED=$(echo $VALIDATE_DELETED | grep -o '"valid":true' || echo "false")
  if [ "$IS_VALID_DELETED" = "false" ]; then
    print_success "Deleted key correctly invalidated"
  else
    print_error "Deleted key still validates (cache invalidation failed)"
  fi
else
  print_warning "Could not test cache invalidation (key ID not found)"
fi
echo ""

# Step 10: Check Redis keys
echo "10. Checking Redis cache keys..."
API_KEY_COUNT=$(redis-cli --scan --pattern "api-key:*" | wc -l)
VALIDATION_COUNT=$(redis-cli --scan --pattern "api-key-validation:*" | wc -l)
print_info "   API key caches: $API_KEY_COUNT"
print_info "   Validation caches: $VALIDATION_COUNT"
echo ""

# Summary
echo "========================================="
echo "Verification Summary"
echo "========================================="

# Check if hit rate is acceptable
HIT_RATE_NUM=$(echo $HIT_RATE | sed 's/%//')
if [ $(echo "$HIT_RATE_NUM > 80" | bc -l) -eq 1 ]; then
  print_success "Cache hit rate is excellent (${HIT_RATE})"
elif [ $(echo "$HIT_RATE_NUM > 50" | bc -l) -eq 1 ]; then
  print_warning "Cache hit rate is acceptable but could be improved (${HIT_RATE})"
else
  print_error "Cache hit rate is low (${HIT_RATE})"
fi

# Check if performance improvement is significant
if [ $AVG_DURATION -lt 10 ]; then
  print_success "Cached validation performance is excellent (<10ms)"
elif [ $AVG_DURATION -lt 20 ]; then
  print_success "Cached validation performance is good (<20ms)"
else
  print_warning "Cached validation performance could be improved (${AVG_DURATION}ms)"
fi

# Check if Redis keys are being created
if [ $VALIDATION_COUNT -gt 0 ]; then
  print_success "Redis cache is storing validation results"
else
  print_warning "No validation results in cache (check cache configuration)"
fi

echo ""
echo "========================================="
print_success "Verification completed successfully!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Monitor cache hit rate in production: GET ${API_URL}/api-keys/cache/stats"
echo "2. Adjust cache TTL if needed: API_KEY_CACHE_TTL_SECONDS"
echo "3. Warm cache on startup: POST ${API_URL}/api-keys/cache/warm"
echo ""
