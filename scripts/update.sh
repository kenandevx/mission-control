#!/usr/bin/env bash
set -euo pipefail

# Mission Control — Update script
# Pulls latest code, rebuilds changed images, restarts services.

set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[update]${NC} $1"; }
warn()  { echo -e "${YELLOW}[update]${NC} $1"; }
err()   { echo -e "${RED}[update]${NC} $1" >&2; }

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║       Mission Control — Update         ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# ── Must be inside a git repo ────────────────────────────────────────────────
if [ ! -d .git ]; then
  err "Not a git repository. Run install.sh first."
  exit 1
fi

# ── Git pull ─────────────────────────────────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
info "Current branch: $CURRENT_BRANCH"
info "Pulling latest changes ..."
git pull origin "$CURRENT_BRANCH"

# Check if package.json changed (might need npm install)
NEED_NPM=$(git diff HEAD~1 --name-only | grep -q "package.json\|package-lock.json" && echo "yes" || echo "no")

# ── Docker rebuild ───────────────────────────────────────────────────────────
info "Building changed images ..."
docker compose build --pull bridge-logger task-worker gateway-sync 2>&1 | tail -5

# ── Restart services ─────────────────────────────────────────────────────────
info "Restarting services ..."
docker compose up -d --build db-init
docker compose up -d --build bridge-logger task-worker gateway-sync

# ── npm install (if needed) ─────────────────────────────────────────────────
if [ "$NEED_NPM" = "yes" ]; then
  info "package.json changed — running npm install ..."
  npm install
fi

# ── Verify ──────────────────────────────────────────────────────────────────
sleep 3
DB_STATUS=$(docker compose ps db --format "{{.Status}}" 2>/dev/null || echo "unknown")
BL_STATUS=$(docker compose ps bridge-logger --format "{{.Status}}" 2>/dev/null || echo "unknown")
echo ""
info "Service status:"
echo "  db              : $DB_STATUS"
echo "  bridge-logger   : $BL_STATUS"
echo "  task-worker     : $(docker compose ps task-worker --format '{{.Status}}' 2>/dev/null || echo unknown)"
echo "  gateway-sync    : $(docker compose ps gateway-sync --format '{{.Status}}' 2>/dev/null || echo unknown)"
echo ""
info "Update complete. Restart your dev server (npm run dev) if running."
echo ""
