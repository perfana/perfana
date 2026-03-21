#!/bin/bash

# SonarQube Configuration Validation Script
# This script validates the SonarQube setup before running a scan

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}SonarQube Configuration Validator${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to print success
success() {
    echo -e "${GREEN}✓${NC} $1"
}

# Function to print warning
warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Function to print error
error() {
    echo -e "${RED}✗${NC} $1"
}

# Function to print info
info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Track validation status
VALIDATION_PASSED=true

# Check 1: sonar-project.properties exists
echo -e "${BLUE}1. Checking configuration file...${NC}"
if [ -f "sonar-project.properties" ]; then
    success "sonar-project.properties found"
else
    error "sonar-project.properties not found"
    VALIDATION_PASSED=false
fi
echo ""

# Check 2: Required directories exist
echo -e "${BLUE}2. Checking source directories...${NC}"
REQUIRED_DIRS=(
    "apps/api/src"
    "apps/web/app"
    "apps/grafana-sync/src"
    "apps/worker/src"
    "packages/shared/src"
)

for dir in "${REQUIRED_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        success "Directory exists: $dir"
    else
        error "Directory missing: $dir"
        VALIDATION_PASSED=false
    fi
done
echo ""

# Check 3: Coverage reports exist
echo -e "${BLUE}3. Checking coverage reports...${NC}"
COVERAGE_FILES=(
    "apps/api/coverage/lcov.info"
    "apps/web/coverage/lcov.info"
    "apps/grafana-sync/coverage/lcov.info"
    "apps/worker/coverage/lcov.info"
)

COVERAGE_FOUND=0
for coverage in "${COVERAGE_FILES[@]}"; do
    if [ -f "$coverage" ]; then
        success "Coverage found: $coverage"
        COVERAGE_FOUND=$((COVERAGE_FOUND + 1))
    else
        warning "Coverage missing: $coverage (run 'npm test -- --coverage')"
    fi
done

if [ $COVERAGE_FOUND -eq 0 ]; then
    error "No coverage reports found. Run: npm test -- --coverage"
    VALIDATION_PASSED=false
else
    success "Found $COVERAGE_FOUND coverage report(s)"
fi
echo ""

# Check 4: TypeScript configuration
echo -e "${BLUE}4. Checking TypeScript configuration...${NC}"
if [ -f "tsconfig.base.json" ]; then
    success "tsconfig.base.json found"
else
    warning "tsconfig.base.json not found"
fi
echo ""

# Check 5: Node.js version
echo -e "${BLUE}5. Checking Node.js version...${NC}"
NODE_VERSION=$(node -v | sed 's/v//')
REQUIRED_VERSION="18.0.0"
if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" = "$REQUIRED_VERSION" ]; then
    success "Node.js version: $NODE_VERSION (>= 18.0.0)"
else
    error "Node.js version: $NODE_VERSION (requires >= 18.0.0)"
    VALIDATION_PASSED=false
fi
echo ""

# Check 6: SonarScanner installed
echo -e "${BLUE}6. Checking SonarScanner installation...${NC}"
if command -v sonar-scanner &> /dev/null; then
    SCANNER_VERSION=$(sonar-scanner --version | head -n1)
    success "SonarScanner installed: $SCANNER_VERSION"
else
    warning "SonarScanner not installed"
    info "Install with: npm install -g sonarqube-scanner"
    info "Or download from: https://docs.sonarqube.org/latest/analysis/scan/sonarscanner/"
    VALIDATION_PASSED=false
fi
echo ""

# Check 7: Environment variables
echo -e "${BLUE}7. Checking environment variables...${NC}"
if [ -z "$SONAR_TOKEN" ]; then
    warning "SONAR_TOKEN not set"
    info "Set with: export SONAR_TOKEN='your-token'"
else
    success "SONAR_TOKEN is set"
fi

if [ -z "$SONAR_HOST_URL" ]; then
    info "SONAR_HOST_URL not set (will use localhost:9000)"
else
    success "SONAR_HOST_URL is set: $SONAR_HOST_URL"
fi
echo ""

# Check 8: SonarQube server reachability (if URL is set)
echo -e "${BLUE}8. Checking SonarQube server connectivity...${NC}"
SONAR_URL="${SONAR_HOST_URL:-http://localhost:9000}"
if curl -s -f -o /dev/null "$SONAR_URL/api/system/status" 2>/dev/null; then
    success "SonarQube server is reachable at $SONAR_URL"
else
    warning "Cannot reach SonarQube server at $SONAR_URL"
    info "Start SonarQube with: docker run -d -p 9000:9000 sonarqube:latest"
fi
echo ""

# Check 9: Test framework
echo -e "${BLUE}9. Checking test framework...${NC}"
if [ -f "apps/api/jest.config.js" ]; then
    success "Jest configured (apps/api)"
fi
if [ -f "apps/grafana-sync/jest.config.js" ]; then
    success "Jest configured (apps/grafana-sync)"
fi
if [ -f "apps/web/jest.config.js" ]; then
    success "Jest configured (apps/web)"
fi
echo ""

# Check 10: Exclusion patterns
echo -e "${BLUE}10. Verifying exclusion patterns...${NC}"
EXCLUDED_PATTERNS=(
    "node_modules"
    "dist"
    ".next"
    "*.entity.ts"
    "*.dto.ts"
    "migrations"
)

for pattern in "${EXCLUDED_PATTERNS[@]}"; do
    if grep -q "$pattern" sonar-project.properties 2>/dev/null; then
        success "Exclusion pattern found: $pattern"
    else
        warning "Exclusion pattern missing: $pattern"
    fi
done
echo ""

# Check 11: Git repository
echo -e "${BLUE}11. Checking Git repository...${NC}"
if [ -d ".git" ]; then
    success "Git repository initialized"
    BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    info "Current branch: $BRANCH"
else
    warning "Not a Git repository"
    info "Git integration provides better blame information"
fi
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Validation Summary${NC}"
echo -e "${BLUE}========================================${NC}"

if [ "$VALIDATION_PASSED" = true ]; then
    echo -e "${GREEN}✓ All critical checks passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Run: npm test -- --coverage (if not done)"
    echo "2. Set: export SONAR_TOKEN='your-token'"
    echo "3. Run: sonar-scanner"
    echo "4. View: http://localhost:9000"
    exit 0
else
    echo -e "${RED}✗ Validation failed${NC}"
    echo ""
    echo "Please fix the issues above before running SonarQube scan."
    echo "See SONARQUBE_SETUP.md for detailed instructions."
    exit 1
fi
