#!/bin/bash

# ================================================================================================
# Perfana Docker Build Script for macOS M1 (ARM64)
# ================================================================================================
# This script builds Docker images using buildx for ARM64 architecture (M1/M2 Macs)
# Supports both single-platform (arm64) and multi-platform (amd64+arm64) builds
# ================================================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_VERSION="${APP_VERSION:-0.1.0}"
BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
VCS_REF=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_NUMBER="${BUILD_NUMBER:-local}"
REGISTRY="${REGISTRY:-perfana}"

# Build options
PLATFORM="${PLATFORM:-linux/arm64}"  # Default to ARM64 for M1
CACHE_FROM="${CACHE_FROM:-}"
CACHE_TO="${CACHE_TO:-}"
PUSH="${PUSH:-false}"
LOAD="${LOAD:-true}"

# Print header
echo -e "${BLUE}================================================================================================${NC}"
echo -e "${BLUE}Perfana Docker Build for M1 (ARM64)${NC}"
echo -e "${BLUE}================================================================================================${NC}"
echo -e "Platform:      ${GREEN}${PLATFORM}${NC}"
echo -e "Version:       ${GREEN}${APP_VERSION}${NC}"
echo -e "VCS Ref:       ${GREEN}${VCS_REF}${NC}"
echo -e "Build Date:    ${GREEN}${BUILD_DATE}${NC}"
echo -e "Registry:      ${GREEN}${REGISTRY}${NC}"
echo -e "${BLUE}================================================================================================${NC}\n"

# Function to build an image
build_image() {
    local target=$1
    local image_name="${REGISTRY}/perfana-${target}:${APP_VERSION}"
    local latest_tag="${REGISTRY}/perfana-${target}:latest"

    echo -e "${YELLOW}Building ${target} image...${NC}"

    # Build command
    local build_cmd="docker buildx build \
        --platform ${PLATFORM} \
        --target ${target} \
        --build-arg NODE_VERSION=20 \
        --build-arg ALPINE_VERSION=3.20 \
        --build-arg APP_VERSION=${APP_VERSION} \
        --build-arg BUILD_DATE=${BUILD_DATE} \
        --build-arg VCS_REF=${VCS_REF} \
        --build-arg BUILD_NUMBER=${BUILD_NUMBER} \
        --build-arg NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:3001/api} \
        --build-arg NEXT_PUBLIC_KEYCLOAK_URL=${NEXT_PUBLIC_KEYCLOAK_URL:-http://localhost:8080} \
        --build-arg NEXT_PUBLIC_KEYCLOAK_REALM=${NEXT_PUBLIC_KEYCLOAK_REALM:-perfana} \
        --build-arg NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=${NEXT_PUBLIC_KEYCLOAK_CLIENT_ID:-perfana-web} \
        --build-arg NEXT_PUBLIC_USE_KEYCLOAK_AUTH=${NEXT_PUBLIC_USE_KEYCLOAK_AUTH:-true} \
        -t ${image_name} \
        -t ${latest_tag}"

    # Add cache options if specified
    if [ -n "${CACHE_FROM}" ]; then
        build_cmd="${build_cmd} --cache-from ${CACHE_FROM}"
    fi

    if [ -n "${CACHE_TO}" ]; then
        build_cmd="${build_cmd} --cache-to ${CACHE_TO}"
    fi

    # Add push or load option
    if [ "${PUSH}" = "true" ]; then
        build_cmd="${build_cmd} --push"
    elif [ "${LOAD}" = "true" ]; then
        build_cmd="${build_cmd} --load"
    fi

    # Add file path
    build_cmd="${build_cmd} -f Dockerfile ."

    echo -e "${BLUE}Executing: ${build_cmd}${NC}\n"
    eval $build_cmd

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Successfully built ${target} image${NC}\n"
    else
        echo -e "${RED}✗ Failed to build ${target} image${NC}\n"
        exit 1
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --platform PLATFORM    Platform to build for (default: linux/arm64)"
    echo "                         Examples: linux/arm64, linux/amd64, linux/arm64,linux/amd64"
    echo "  --push                 Push images to registry instead of loading locally"
    echo "  --no-load              Don't load images to local Docker (useful for multi-platform)"
    echo "  --version VERSION      Application version (default: 0.1.0)"
    echo "  --registry REGISTRY    Registry prefix (default: perfana)"
    echo "  --web-only             Build only web image"
    echo "  --api-only             Build only API image"
    echo "  --dev                  Build development image"
    echo "  --help                 Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Build for M1 (ARM64) and load to local Docker"
    echo "  $0"
    echo ""
    echo "  # Build for multiple platforms (requires --push or --no-load)"
    echo "  $0 --platform linux/arm64,linux/amd64 --no-load"
    echo ""
    echo "  # Build only web image for M1"
    echo "  $0 --web-only"
    echo ""
    echo "  # Build and push to registry"
    echo "  $0 --push --registry myregistry.com/perfana"
}

# Parse command line arguments
BUILD_WEB=true
BUILD_API=true
BUILD_DEV=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --push)
            PUSH=true
            LOAD=false
            shift
            ;;
        --no-load)
            LOAD=false
            shift
            ;;
        --version)
            APP_VERSION="$2"
            shift 2
            ;;
        --registry)
            REGISTRY="$2"
            shift 2
            ;;
        --web-only)
            BUILD_API=false
            BUILD_DEV=false
            shift
            ;;
        --api-only)
            BUILD_WEB=false
            BUILD_DEV=false
            shift
            ;;
        --dev)
            BUILD_WEB=false
            BUILD_API=false
            BUILD_DEV=true
            shift
            ;;
        --help)
            show_usage
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_usage
            exit 1
            ;;
    esac
done

# Check if building multi-platform with --load
if [[ "${PLATFORM}" == *","* ]] && [ "${LOAD}" = "true" ]; then
    echo -e "${RED}Error: Cannot use --load with multiple platforms${NC}"
    echo -e "${YELLOW}Use --push to push to registry or --no-load to build without loading${NC}"
    exit 1
fi

# Ensure builder is using the multiplatform driver
echo -e "${YELLOW}Ensuring multiplatform builder is active...${NC}"
docker buildx use multiplatform || docker buildx create --name multiplatform --use

# Build images
if [ "${BUILD_WEB}" = "true" ]; then
    build_image "web"
fi

if [ "${BUILD_API}" = "true" ]; then
    build_image "api"
fi

if [ "${BUILD_DEV}" = "true" ]; then
    build_image "development"
fi

# Summary
echo -e "${BLUE}================================================================================================${NC}"
echo -e "${GREEN}✓ Build completed successfully!${NC}"
echo -e "${BLUE}================================================================================================${NC}"

if [ "${LOAD}" = "true" ]; then
    echo -e "\nBuilt images (loaded to local Docker):"
    [ "${BUILD_WEB}" = "true" ] && echo -e "  ${GREEN}●${NC} ${REGISTRY}/perfana-web:${APP_VERSION}"
    [ "${BUILD_API}" = "true" ] && echo -e "  ${GREEN}●${NC} ${REGISTRY}/perfana-api:${APP_VERSION}"
    [ "${BUILD_DEV}" = "true" ] && echo -e "  ${GREEN}●${NC} ${REGISTRY}/perfana-development:${APP_VERSION}"
    echo -e "\nRun with:"
    [ "${BUILD_WEB}" = "true" ] && echo -e "  docker run -p 3000:3000 ${REGISTRY}/perfana-web:${APP_VERSION}"
    [ "${BUILD_API}" = "true" ] && echo -e "  docker run -p 3001:3001 ${REGISTRY}/perfana-api:${APP_VERSION}"
fi

if [ "${PUSH}" = "true" ]; then
    echo -e "\n${GREEN}Images pushed to registry${NC}"
fi

echo ""
