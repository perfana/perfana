#!/bin/bash

# Build script for perfana-ds-worker Docker image
# Builds for macOS M1 (arm64) architecture using buildx

set -e

# Navigate to project root
cd "$(dirname "$0")/.."

# Build the image
echo "Building perfana-ds-worker Docker image for arm64..."
docker buildx build \
  --platform linux/arm64 \
  -f docker/Dockerfile \
  -t perfana-ds-worker:latest \
  --load \
  .

echo "✅ Build complete: perfana-ds-worker:latest"
