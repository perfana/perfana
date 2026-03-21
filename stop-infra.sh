#!/bin/bash
# ================================================================================================
# Perfana Next-Gen Infrastructure Stop Script
# ================================================================================================
# Stops all infrastructure services.
# Use --clean to also remove volumes (database data, etc.)
# ================================================================================================

set -o errexit
set -o pipefail

COMPOSE_FILE="docker-compose.infra.yml"

if [ "${1:-}" = "--clean" ]; then
  echo "Stopping infrastructure and removing volumes..."
  docker compose -f "$COMPOSE_FILE" down -v
  echo "Infrastructure stopped and volumes removed."
else
  echo "Stopping infrastructure..."
  docker compose -f "$COMPOSE_FILE" down
  echo "Infrastructure stopped. Data volumes preserved."
  echo "Use './stop-infra.sh --clean' to also remove volumes."
fi
