#!/usr/bin/env bash
# ============================================================
# OpenClaw Mission Control — Clean Script
# Stops all host services, removes Docker containers and volumes,
# re-pulls latest git, and re-initializes everything.
# Use when you want a fresh start without re-cloning.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[clean]${NC} $1"; }
warn()  { echo -e "${YELLOW}[clean]${NC} $1"; }
err()   { echo -e "${RED}[clean]${NC} $1" >&2; }
step()  { echo -e "${CYAN}[clean]${NC} $1"; }

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║       OpenClaw Mission Control — Clean             ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

if [ ! -d .git ]; then
  err "Not a git repository. Run install.sh first."
  exit 1
fi

warn "This will:"
echo "  1. Stop all host services (task-worker, gateway-sync, bridge-logger)"
echo "  2. Stop and remove all Docker containers"
echo "  3. Remove Docker volumes (including all database data)"
echo "  4. Keep your .env file"
echo "  5. Git pull latest"
echo "  6. Re-initialize database and restart all services"
echo ""
read -rp "Continue? [y/N] " confirm
if [ "${confirm,,}" != "y" ]; then
  info "Aborted."
  exit 0
fi
echo ""

# ── Stop host services ───────────────────────────────────────
step "Stopping host services ..."
bash scripts/mc-services.sh stop 2>&1 | sed 's/^/  /' || true

# ── Docker: stop + remove containers + volumes ────────────────
step "Stopping Docker services ..."
docker compose down --volumes --remove-orphans 2>&1 | tail -3 || true

# ── Pull latest ──────────────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
step "Pulling latest (branch: $CURRENT_BRANCH) ..."
git pull origin "$CURRENT_BRANCH" 2>&1 | tail -3

# ── Sync .env.local ──────────────────────────────────────────
[ -f .env ] && cp .env .env.local

# ── Runtime dirs ─────────────────────────────────────────────
mkdir -p .runtime/bridge-logger .runtime/pids .runtime/logs
touch .runtime/bridge-logger/bridge-logger.lock .runtime/bridge-logger/offsets.json
chmod 666 .runtime/bridge-logger/bridge-logger.lock .runtime/bridge-logger/offsets.json

# ── Docker: start DB ────────────────────────────────────────
step "Starting database ..."
docker compose up -d db
docker compose up -d db-init

step "Waiting for database to be ready ..."
until docker compose exec -T db pg_isready -U openclaw -d mission_control >/dev/null 2>&1; do
  printf "."
  sleep 1
done
echo ""
info "Database ready."

step "Waiting for schema initialization ..."
while docker compose ps db-init 2>/dev/null | grep -q "Up"; do
  printf "."
  sleep 1
done
echo ""
info "Schema initialized."

# ── npm install + build ─────────────────────────────────────
step "Installing npm dependencies ..."
npm install 2>&1 | tail -3

step "Building production Next.js ..."
npm run build 2>&1 | tail -5

# ── Restart host services ────────────────────────────────────
step "Starting host services ..."
bash scripts/mc-services.sh start 2>&1 | sed 's/^/  /'

echo ""
info "Clean complete — all services restarted with latest code."
echo ""
