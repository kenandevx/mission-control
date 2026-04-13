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

# Stash any local modifications so the pull can proceed cleanly
STASH_CREATED=false
if ! git diff --quiet || ! git diff --cached --quiet; then
  step "Stashing local changes before pull ..."
  if git stash push -m "update-script-auto-stash"; then
    STASH_CREATED=true
  else
    warn "git stash failed — discarding local tracked-file changes to allow pull."
    git checkout -- .
  fi
fi

step "Pulling latest changes (branch: $CURRENT_BRANCH) ..."
if ! git pull --ff-only origin "$CURRENT_BRANCH"; then
  err "git pull failed. The remote may have diverged. Restore your stash with: git stash pop"
  exit 1
fi

# Restore stashed changes; if they conflict with the incoming version, keep theirs
if [ "$STASH_CREATED" = true ]; then
  step "Restoring local changes ..."
  if ! git stash pop; then
    warn "Stash pop had conflicts — keeping upstream version and dropping local stash."
    git checkout -- . 2>/dev/null || true
    git stash drop 2>/dev/null || true
  fi
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

unset NODE_ENV NPM_CONFIG_PRODUCTION npm_config_production

step "Installing npm dependencies ..."
npm install --include=dev --no-audit --no-fund

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
  exit 1
fi

if [ -f scripts/mc-services.sh ]; then
  step "Restarting Mission Control services ..."
  bash scripts/mc-services.sh restart
fi

info "Update complete."
