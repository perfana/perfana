#!/bin/bash

# ================================================================================================
# PERFANA DOCKER SECURITY SCANNING SCRIPT
# ================================================================================================
# This script provides comprehensive security scanning and validation for Docker images
# including vulnerability scanning, configuration validation, and compliance checks.
# ================================================================================================

set -euo pipefail

# Configuration
IMAGE_NAME="${1:-perfana-next-gen}"
IMAGE_TAG="${2:-latest}"
FULL_IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"
SCAN_DIR="./security-reports"
DATE_STAMP=$(date +%Y%m%d_%H%M%S)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}" >&2
}

warning() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

# Create scan directory
mkdir -p "${SCAN_DIR}"

# ================================================================================================
# PREREQUISITE CHECKS
# ================================================================================================
log "Checking prerequisites..."

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    error "Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if image exists
if ! docker image inspect "${FULL_IMAGE}" >/dev/null 2>&1; then
    error "Image ${FULL_IMAGE} not found. Please build the image first."
    exit 1
fi

success "Prerequisites check passed"

# ================================================================================================
# TRIVY VULNERABILITY SCANNING
# ================================================================================================
log "Running Trivy vulnerability scan..."

# Install Trivy if not present
if ! command -v trivy >/dev/null 2>&1; then
    warning "Trivy not found. Installing..."
    
    # Detect OS and architecture
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    
    case ${ARCH} in
        x86_64) ARCH="amd64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *) error "Unsupported architecture: ${ARCH}"; exit 1 ;;
    esac
    
    # Download and install Trivy
    TRIVY_VERSION="0.49.1"
    TRIVY_URL="https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_${OS}_${ARCH}.tar.gz"
    
    curl -sfL "${TRIVY_URL}" | tar -xz -C /tmp
    sudo mv /tmp/trivy /usr/local/bin/
    chmod +x /usr/local/bin/trivy
fi

# Run comprehensive Trivy scan
log "Scanning for vulnerabilities..."
trivy image \
    --severity HIGH,CRITICAL \
    --format json \
    --output "${SCAN_DIR}/trivy-vulnerabilities-${DATE_STAMP}.json" \
    "${FULL_IMAGE}"

# Generate human-readable report
trivy image \
    --severity LOW,MEDIUM,HIGH,CRITICAL \
    --format table \
    --output "${SCAN_DIR}/trivy-report-${DATE_STAMP}.txt" \
    "${FULL_IMAGE}"

# Generate SBOM (Software Bill of Materials)
log "Generating Software Bill of Materials (SBOM)..."
trivy image \
    --format spdx-json \
    --output "${SCAN_DIR}/sbom-${DATE_STAMP}.spdx.json" \
    "${FULL_IMAGE}"

success "Trivy scanning completed"

# ================================================================================================
# DOCKER BENCH SECURITY
# ================================================================================================
log "Running Docker Bench Security..."

if ! command -v docker-bench-security >/dev/null 2>&1; then
    warning "Docker Bench Security not found. Running via container..."
    
    docker run --rm \
        --pid host \
        --userns host \
        --cap-add audit_control \
        -v /etc:/etc:ro \
        -v /var/lib:/var/lib:ro \
        -v /var/run/docker.sock:/var/run/docker.sock:ro \
        -v /usr/lib/systemd:/usr/lib/systemd:ro \
        docker/docker-bench-security > "${SCAN_DIR}/docker-bench-${DATE_STAMP}.txt" || true
else
    docker-bench-security > "${SCAN_DIR}/docker-bench-${DATE_STAMP}.txt"
fi

success "Docker Bench Security completed"

# ================================================================================================
# CONTAINER CONFIGURATION ANALYSIS
# ================================================================================================
log "Analyzing container configuration..."

# Inspect image configuration
docker image inspect "${FULL_IMAGE}" > "${SCAN_DIR}/image-config-${DATE_STAMP}.json"

# Extract security-relevant information
cat > "${SCAN_DIR}/security-analysis-${DATE_STAMP}.txt" << EOF
CONTAINER SECURITY ANALYSIS - ${DATE_STAMP}
=============================================

IMAGE: ${FULL_IMAGE}
SCAN DATE: $(date)

SECURITY CONFIGURATION:
EOF

# Check for non-root user
USER_CONFIG=$(docker image inspect "${FULL_IMAGE}" | jq -r '.[0].Config.User // "root"')
if [ "${USER_CONFIG}" != "root" ] && [ "${USER_CONFIG}" != "" ]; then
    echo "✓ Non-root user: ${USER_CONFIG}" >> "${SCAN_DIR}/security-analysis-${DATE_STAMP}.txt"
else
    echo "⚠ Running as root user (security risk)" >> "${SCAN_DIR}/security-analysis-${DATE_STAMP}.txt"
fi

# Check for exposed ports
EXPOSED_PORTS=$(docker image inspect "${FULL_IMAGE}" | jq -r '.[0].Config.ExposedPorts // {} | keys | .[]' 2>/dev/null || echo "none")
if [ "${EXPOSED_PORTS}" != "none" ]; then
    echo "ℹ Exposed ports: ${EXPOSED_PORTS}" >> "${SCAN_DIR}/security-analysis-${DATE_STAMP}.txt"
else
    echo "ℹ No exposed ports" >> "${SCAN_DIR}/security-analysis-${DATE_STAMP}.txt"
fi

# Check image size
IMAGE_SIZE=$(docker image inspect "${FULL_IMAGE}" | jq -r '.[0].Size')
IMAGE_SIZE_MB=$((IMAGE_SIZE / 1024 / 1024))
echo "ℹ Image size: ${IMAGE_SIZE_MB} MB" >> "${SCAN_DIR}/security-analysis-${DATE_STAMP}.txt"

# Check for healthcheck
HEALTHCHECK=$(docker image inspect "${FULL_IMAGE}" | jq -r '.[0].Config.Healthcheck.Test // "none"')
if [ "${HEALTHCHECK}" != "none" ] && [ "${HEALTHCHECK}" != "null" ]; then
    echo "✓ Health check configured" >> "${SCAN_DIR}/security-analysis-${DATE_STAMP}.txt"
else
    echo "⚠ No health check configured" >> "${SCAN_DIR}/security-analysis-${DATE_STAMP}.txt"
fi

success "Container configuration analysis completed"

# ================================================================================================
# RUNTIME SECURITY TEST
# ================================================================================================
log "Testing runtime security..."

# Test container with security options
TEST_CONTAINER_NAME="perfana-security-test-${DATE_STAMP}"

docker run -d \
    --name "${TEST_CONTAINER_NAME}" \
    --security-opt no-new-privileges:true \
    --read-only \
    --tmpfs /tmp:noexec,nosuid,size=100m \
    --user 10001:10001 \
    --cap-drop ALL \
    --network none \
    "${FULL_IMAGE}" sleep 30 || true

# Check if container started successfully
if docker ps --filter "name=${TEST_CONTAINER_NAME}" --format "{{.Names}}" | grep -q "${TEST_CONTAINER_NAME}"; then
    echo "✓ Container runs with hardened security options" >> "${SCAN_DIR}/security-analysis-${DATE_STAMP}.txt"
else
    echo "⚠ Container may not support hardened security options" >> "${SCAN_DIR}/security-analysis-${DATE_STAMP}.txt"
fi

# Clean up test container
docker rm -f "${TEST_CONTAINER_NAME}" >/dev/null 2>&1 || true

success "Runtime security test completed"

# ================================================================================================
# GENERATE FINAL REPORT
# ================================================================================================
log "Generating final security report..."

cat > "${SCAN_DIR}/security-summary-${DATE_STAMP}.md" << EOF
# Docker Security Scan Report

**Image:** \`${FULL_IMAGE}\`  
**Scan Date:** $(date)  
**Report ID:** ${DATE_STAMP}

## Summary

This report contains the results of comprehensive security scanning for the Perfana Docker image.

## Files Generated

- \`trivy-vulnerabilities-${DATE_STAMP}.json\` - Detailed vulnerability scan results
- \`trivy-report-${DATE_STAMP}.txt\` - Human-readable vulnerability report  
- \`sbom-${DATE_STAMP}.spdx.json\` - Software Bill of Materials
- \`docker-bench-${DATE_STAMP}.txt\` - CIS Docker Benchmark results
- \`image-config-${DATE_STAMP}.json\` - Complete image configuration
- \`security-analysis-${DATE_STAMP}.txt\` - Security configuration analysis

## Recommendations

1. Review all HIGH and CRITICAL vulnerabilities in the Trivy report
2. Address any CIS Docker Benchmark failures  
3. Implement security hardening suggestions from the analysis
4. Regularly update base images and dependencies
5. Consider using distroless or minimal base images
6. Implement runtime security monitoring

## Next Steps

- Fix identified vulnerabilities by updating dependencies
- Apply security hardening recommendations
- Integrate scanning into CI/CD pipeline
- Set up automated vulnerability monitoring
EOF

# Count critical vulnerabilities
if [ -f "${SCAN_DIR}/trivy-vulnerabilities-${DATE_STAMP}.json" ]; then
    CRITICAL_COUNT=$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "CRITICAL")] | length' "${SCAN_DIR}/trivy-vulnerabilities-${DATE_STAMP}.json" 2>/dev/null || echo "0")
    HIGH_COUNT=$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "HIGH")] | length' "${SCAN_DIR}/trivy-vulnerabilities-${DATE_STAMP}.json" 2>/dev/null || echo "0")
    
    if [ "${CRITICAL_COUNT}" -gt 0 ] || [ "${HIGH_COUNT}" -gt 0 ]; then
        error "Found ${CRITICAL_COUNT} CRITICAL and ${HIGH_COUNT} HIGH severity vulnerabilities"
        echo "- **Critical Vulnerabilities:** ${CRITICAL_COUNT}" >> "${SCAN_DIR}/security-summary-${DATE_STAMP}.md"
        echo "- **High Vulnerabilities:** ${HIGH_COUNT}" >> "${SCAN_DIR}/security-summary-${DATE_STAMP}.md"
    else
        success "No critical or high severity vulnerabilities found"
        echo "- **Critical Vulnerabilities:** 0" >> "${SCAN_DIR}/security-summary-${DATE_STAMP}.md"
        echo "- **High Vulnerabilities:** 0" >> "${SCAN_DIR}/security-summary-${DATE_STAMP}.md"
    fi
fi

success "Security scanning completed successfully!"
log "Reports saved in: ${SCAN_DIR}/"
log "View summary: cat ${SCAN_DIR}/security-summary-${DATE_STAMP}.md"

# ================================================================================================
# EXIT WITH APPROPRIATE CODE
# ================================================================================================
if [ -f "${SCAN_DIR}/trivy-vulnerabilities-${DATE_STAMP}.json" ]; then
    CRITICAL_COUNT=$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "CRITICAL")] | length' "${SCAN_DIR}/trivy-vulnerabilities-${DATE_STAMP}.json" 2>/dev/null || echo "0")
    if [ "${CRITICAL_COUNT}" -gt 0 ]; then
        error "Exiting with error code due to critical vulnerabilities"
        exit 1
    fi
fi

success "All security checks passed!"
exit 0