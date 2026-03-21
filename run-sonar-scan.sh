#!/bin/bash

# SonarQube Scan Runner Script
# This script runs the SonarQube analysis and uploads results

echo "🔍 Starting SonarQube Analysis..."
echo ""

# Check if SONAR_TOKEN is set
if [ -z "$SONAR_TOKEN" ]; then
  echo "❌ ERROR: SONAR_TOKEN environment variable is not set"
  echo ""
  echo "To generate a token:"
  echo "  1. Open http://localhost:9000"
  echo "  2. Login (default: admin/admin)"
  echo "  3. Go to My Account → Security → Generate Tokens"
  echo "  4. Generate a Project Analysis Token for 'perfana-next-gen'"
  echo ""
  echo "Then run:"
  echo "  export SONAR_TOKEN=your_token_here"
  echo "  ./run-sonar-scan.sh"
  echo ""
  exit 1
fi

# Verify sonar-scanner is installed
if ! command -v sonar-scanner &> /dev/null; then
  echo "❌ ERROR: sonar-scanner is not installed"
  echo "Install via: brew install sonar-scanner"
  exit 1
fi

# Run validation script first
if [ -f "scripts/validate-sonar-config.sh" ]; then
  echo "📋 Running pre-flight validation..."
  bash scripts/validate-sonar-config.sh
  if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Validation failed. Please fix the issues above."
    exit 1
  fi
  echo ""
fi

# Run the scan
echo "🚀 Running sonar-scanner..."
echo ""
sonar-scanner \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.token=$SONAR_TOKEN \
  -Dsonar.projectKey=perfana-next-gen \
  -Dsonar.projectName="Perfana Next Gen" \
  -Dsonar.projectVersion=1.0.0

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ SonarQube scan completed successfully!"
  echo ""
  echo "📊 View results at: http://localhost:9000/dashboard?id=perfana-next-gen"
  echo ""
else
  echo ""
  echo "❌ SonarQube scan failed"
  exit 1
fi
