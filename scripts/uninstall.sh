#!/usr/bin/env bash
# ============================================================
# OpenClaw Mission Control — Uninstall Script
# Completely removes the Mission Control installation:
#   - Host services
#   - Docker containers, network, and volumes for this project
#   - Project directory
#   - Convenience symlinks
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-mission-control}"
PGDATA_VOLUME="${COMPOSE_PROJECT_NAME}_pgdata"
NETWORK_NAME="${COMPOSE_PROJECT_NAME}_default"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[uninstall]${NC} $1"; }
warn()  { echo -e "${YELLOW}[uninstall]${NC} $1"; }
err()   { echo -e "${RED}[uninstall]${NC} $1" >&2; }

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║       OpenClaw Mission Control — Uninstall           ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

warn "This will PERMANENTLY remove:"
echo "  1. Host services (task-worker, gateway-sync, bridge-logger, agenda-scheduler, agenda-worker, nextjs)"
echo "  2. Mission Control Docker containers, network, and volumes"
echo "  3. The project directory: $PROJECT_ROOT"
echo "  4. Convenience symlinks: /usr/local/bin/mc-*"
echo ""
warn "Your .env file will be DELETED (database passwords, API credentials)."
echo ""
read -rp "Type 'yes' to confirm: " confirm
if [ "$confirm" != "yes" ]; then
  info "Aborted."
  exit 0
fi
echo ""

# ── Stop host services ──────────────────────────────────────
if [ -d "$PROJECT_ROOT" ]; then
  info "Stopping host services ..."
  cd "$PROJECT_ROOT"
  bash scripts/mc-services.sh stop 2>&1 | sed 's/^/  /' || true
else
  warn "Project directory not found, skipping host service stop via mc-services.sh"
fi

# ── Remove Docker resources for this project ────────────────
info "Removing Mission Control Docker resources ..."

# First try compose-based cleanup if compose file exists
if [ -f "$PROJECT_ROOT/docker-compose.yml" ] || [ -f "$PROJECT_ROOT/compose.yml" ] || [ -f "$PROJECT_ROOT/compose.yaml" ]; then
  (
    cd "$PROJECT_ROOT"
    docker compose -p "$COMPOSE_PROJECT_NAME" down --volumes --remove-orphans 2>&1 | sed 's/^/  /'
  ) || warn "docker compose down reported an issue, continuing with targeted cleanup ..."
else
  warn "Compose file not found, using targeted Docker cleanup only ..."
fi

# Explicit targeted container cleanup in case compose context/project drifted
for name in \
  "${COMPOSE_PROJECT_NAME}-db-1" \
  "${COMPOSE_PROJECT_NAME}-db-init-1"
do
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$name"; then
    info "Removing container: $name"
    docker rm -f "$name" >/dev/null 2>&1 || warn "Failed to remove container: $name"
  fi
done

# Remove known project network
if docker network ls --format '{{.Name}}' | grep -Fxq "$NETWORK_NAME"; then
  info "Removing network: $NETWORK_NAME"
  docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || warn "Failed to remove network: $NETWORK_NAME"
fi

# Remove known project volume
if docker volume ls --format '{{.Name}}' | grep -Fxq "$PGDATA_VOLUME"; then
  info "Removing volume: $PGDATA_VOLUME"
  docker volume rm -f "$PGDATA_VOLUME" >/dev/null 2>&1 || warn "Failed to remove volume: $PGDATA_VOLUME"
fi

# ── Verify Docker cleanup ───────────────────────────────────
remaining_containers="$(docker ps -a --format '{{.Names}}' | grep -E "^${COMPOSE_PROJECT_NAME}-(db|db-init)-1$" || true)"
remaining_networks="$(docker network ls --format '{{.Name}}' | grep -E "^${NETWORK_NAME}$" || true)"
remaining_volumes="$(docker volume ls --format '{{.Name}}' | grep -E "^${PGDATA_VOLUME}$" || true)"

if [ -n "$remaining_containers" ] || [ -n "$remaining_networks" ] || [ -n "$remaining_volumes" ]; then
  err "Some Mission Control Docker resources still remain."
  [ -n "$remaining_containers" ] && err "Remaining containers:" && echo "$remaining_containers" | sed 's/^/  /'
  [ -n "$remaining_networks" ] && err "Remaining networks:" && echo "$remaining_networks" | sed 's/^/  /'
  [ -n "$remaining_volumes" ] && err "Remaining volumes:" && echo "$remaining_volumes" | sed 's/^/  /'
  err "Project directory was NOT removed so you can inspect/fix manually."
  exit 1
fi

info "Mission Control Docker resources removed."

# ── Remove convenience symlinks ─────────────────────────────
info "Removing convenience symlinks ..."
for script in install clean update uninstall mc-services dev; do
  target="/usr/local/bin/mc-${script}"
  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -f "$target"
    echo "  Removed: $target"
  fi
done

# ── Remove project dir ──────────────────────────────────────
if [ -d "$PROJECT_ROOT" ]; then
  info "Removing project directory ..."
  rm -rf "$PROJECT_ROOT"
  echo "  Removed: $PROJECT_ROOT"
else
  warn "Project directory already absent: $PROJECT_ROOT"
fi

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║               Uninstall complete.                    ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
info "Mission Control has been removed."
echo ""
