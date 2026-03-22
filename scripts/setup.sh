#!/usr/bin/env bash
set -euo pipefail

# Perfana Development Setup
# Usage: ./scripts/setup.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[setup]${NC} $1"; }
warn() { echo -e "${YELLOW}[setup]${NC} $1"; }
fail() { echo -e "${RED}[setup]${NC} $1"; exit 1; }

# Check prerequisites
command -v node >/dev/null 2>&1 || fail "Node.js is required. Install from https://nodejs.org (v18+)"
command -v docker >/dev/null 2>&1 || fail "Docker is required. Install from https://docs.docker.com/get-docker/"

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  fail "Node.js 18+ required, found v$(node -v)"
fi

info "Node.js $(node -v) detected"

# Install dependencies
info "Installing dependencies..."
npm install

# Copy env files if they don't exist
for app in apps/api apps/worker apps/grafana-sync; do
  if [ -f "$app/.env.example" ] && [ ! -f "$app/.env" ]; then
    cp "$app/.env.example" "$app/.env"
    info "Created $app/.env from example"
  fi
done

# Start infrastructure
info "Starting infrastructure (Postgres, Redis, Keycloak)..."
docker compose -f docker-compose.infra.yml up -d

# Wait for Postgres
info "Waiting for Postgres..."
for i in $(seq 1 30); do
  if docker exec perfana-postgres pg_isready -U perfana >/dev/null 2>&1; then
    info "Postgres is ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    fail "Postgres did not start in time"
  fi
  sleep 2
done

# Wait for Keycloak
info "Waiting for Keycloak..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:8080/health/ready >/dev/null 2>&1; then
    info "Keycloak is ready"
    break
  fi
  if [ "$i" -eq 60 ]; then
    warn "Keycloak not ready yet — it may still be starting. Check http://localhost:8080"
    break
  fi
  sleep 2
done

echo ""
info "Setup complete! Run 'npm run dev' to start all services."
echo ""
echo "  API:      http://localhost:3001/api/docs"
echo "  Web:      http://localhost:4001"
echo "  Keycloak: http://localhost:8080 (admin/admin)"
echo "  Login:    perfana@example.com / perfana"
echo ""
