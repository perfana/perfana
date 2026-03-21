#!/bin/bash

# Fix LCOV paths for SonarQube analysis
# This script converts relative paths in lcov.info files to absolute paths
# that SonarQube can understand

set -e

echo "🔧 Fixing LCOV coverage paths for SonarQube..."

# Function to fix paths in a coverage file
fix_coverage_paths() {
  local app_name=$1
  local coverage_dir=$2
  local path_prefix=$3

  if [ -f "$coverage_dir/lcov.info" ]; then
    echo "  ✓ Fixing paths for $app_name..."
    sed "s|^SF:${path_prefix}|SF:${coverage_dir%/coverage}/|g" "$coverage_dir/lcov.info" > "$coverage_dir/lcov-fixed.info"
    echo "    Created: $coverage_dir/lcov-fixed.info"
  else
    echo "  ⚠ No coverage found for $app_name (skipping)"
  fi
}

# Fix API coverage (root-level coverage directory)
if [ -f "coverage/apps/api/lcov.info" ]; then
  echo "  ✓ Fixing paths for API (root coverage)..."
  sed 's|^SF:src/|SF:apps/api/src/|g' coverage/apps/api/lcov.info > coverage/apps/api/lcov-fixed.info
  echo "    Created: coverage/apps/api/lcov-fixed.info"
fi

# Fix Web coverage (app-level coverage directory)
if [ -f "apps/web/coverage/lcov.info" ]; then
  echo "  ✓ Fixing paths for Web..."
  sed 's|^SF:|SF:apps/web/|g' apps/web/coverage/lcov.info > apps/web/coverage/lcov-fixed.info
  echo "    Created: apps/web/coverage/lcov-fixed.info"
fi

# Fix Grafana Sync coverage (app-level coverage directory)
if [ -f "apps/grafana-sync/coverage/lcov.info" ]; then
  echo "  ✓ Fixing paths for Grafana Sync..."
  sed 's|^SF:src/|SF:apps/grafana-sync/src/|g' apps/grafana-sync/coverage/lcov.info > apps/grafana-sync/coverage/lcov-fixed.info
  echo "    Created: apps/grafana-sync/coverage/lcov-fixed.info"
fi

# Fix Worker coverage (app-level coverage directory)
if [ -f "apps/worker/coverage/lcov.info" ]; then
  echo "  ✓ Fixing paths for Worker..."
  sed 's|^SF:src/|SF:apps/worker/src/|g' apps/worker/coverage/lcov.info > apps/worker/coverage/lcov-fixed.info
  echo "    Created: apps/worker/coverage/lcov-fixed.info"
fi

echo ""
echo "✅ Coverage paths fixed successfully!"
echo ""
echo "📊 Coverage files ready for SonarQube:"
echo "   - coverage/apps/api/lcov-fixed.info"
echo "   - apps/web/coverage/lcov-fixed.info"
echo "   - apps/grafana-sync/coverage/lcov-fixed.info"
echo "   - apps/worker/coverage/lcov-fixed.info"
