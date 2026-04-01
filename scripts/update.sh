#!/usr/bin/env bash
# ============================================================
# OpenClaw Mission Control — Update Script
# Pull latest changes, install deps, run migrations, rebuild,
# and restart services.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[update]${NC} $1"; }
warn()  { echo -e "${YELLOW}[update]${NC} $1"; }
err()   { echo -e "${RED}[update]${NC} $1" >&2; }
step()  { echo -e "${CYAN}[update]${NC} $1"; }

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║        OpenClaw Mission Control — Update            ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

if [ ! -d .git ]; then
  err "Not a git repository. Run install.sh first."
  exit 1
fi

if [ ! -f package.json ]; then
  err "package.json not found in $PROJECT_ROOT"
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
step "Pulling latest changes (branch: $CURRENT_BRANCH) ..."
git pull --ff-only origin "$CURRENT_BRANCH"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

step "Installing npm dependencies ..."
env -u NODE_ENV npm install --no-audit --no-fund

step "Applying database schema ..."
if [ ! -f db/schema.sql ]; then
  warn "db/schema.sql not found; skipping schema apply."
else
  if ! docker compose ps db 2>/dev/null | grep -q "Up"; then
    warn "Database container is not running; skipping schema apply."
  else
    if ! docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD:-}" db \
      psql -U openclaw -d mission_control < db/schema.sql; then
      warn "Database schema apply failed; continuing so you can inspect logs."
    fi
  fi
fi

step "Building production Next.js ..."
rm -rf .next
if ! env -u NODE_ENV NODE_ENV=production npm run build; then
  err "Next.js production build failed."
  err "This is an application build error, not just an update-script issue."
  exit 1
fi

if [ -f scripts/mc-services.sh ]; then
  step "Restarting Mission Control services ..."
  bash scripts/mc-services.sh restart
fi

info "Update complete."
