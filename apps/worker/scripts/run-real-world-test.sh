#!/bin/bash

# Real-World MetricsPipeline Test Runner
# This script helps run the real-world integration test safely

set -e

echo "🚀 Running Real-World MetricsPipeline Test"
echo "========================================="
echo ""

# Check if database connection is available
echo "📡 Checking database connection..."
if ! psql "$DATABASE_URL" -c '\q' 2>/dev/null; then
    echo "❌ Database connection failed. Please check DATABASE_URL environment variable."
    echo "   Expected format: postgresql://user:password@host:port/database"
    exit 1
fi
echo "✅ Database connection OK"
echo ""

# Check if test data exists
echo "📊 Checking test data availability..."
TEST_RUN_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM test_runs WHERE test_run_id = 'MyAfterburner-acc-loadTest-00002';" 2>/dev/null | xargs)
PANEL_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM ds_panels WHERE test_run_id = 'MyAfterburner-acc-loadTest-00002';" 2>/dev/null | xargs)
METRICS_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM ds_metrics WHERE test_run_id = 'MyAfterburner-acc-loadTest-00002';" 2>/dev/null | xargs)

if [ "$TEST_RUN_COUNT" -eq "0" ]; then
    echo "❌ Test run 'MyAfterburner-acc-loadTest-00002' not found in test_runs table"
    exit 1
fi

if [ "$PANEL_COUNT" -eq "0" ]; then
    echo "❌ No panel data found for test run 'MyAfterburner-acc-loadTest-00002'"
    exit 1
fi

echo "✅ Test data found:"
echo "   - Test run: 1"
echo "   - Panels: $PANEL_COUNT"
echo "   - Existing metrics: $METRICS_COUNT"
echo ""

# Warn about data modification
echo "⚠️  WARNING: This test will temporarily modify ds_metrics data!"
echo "   - Original metrics data will be backed up"
echo "   - Data will be cleared during testing"
echo "   - Original data will be restored after testing"
echo ""

# Ask for confirmation unless running in CI
if [ "${CI:-}" != "true" ]; then
    read -p "Continue with the test? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Test cancelled by user"
        exit 0
    fi
fi

echo "🧪 Running the real-world integration test..."
echo ""

# Run the test
npm run test:real-world

echo ""
echo "✅ Real-world test completed!"
echo ""
echo "📊 Final data verification..."
FINAL_METRICS_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM ds_metrics WHERE test_run_id = 'MyAfterburner-acc-loadTest-00002';" 2>/dev/null | xargs)

if [ "$FINAL_METRICS_COUNT" -eq "$METRICS_COUNT" ]; then
    echo "✅ Original data successfully restored ($FINAL_METRICS_COUNT records)"
else
    echo "⚠️  Data count mismatch: expected $METRICS_COUNT, found $FINAL_METRICS_COUNT"
    echo "   Please check if data restoration completed successfully"
fi

echo ""
echo "🎉 Real-world test run complete!"