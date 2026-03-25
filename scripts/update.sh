#!/usr/bin/env bash
# ============================================================
# OpenClaw Mission Control — Update Script
# Pulls latest git changes, rebuilds Next.js, restarts host services.
# Safe to run on an existing install.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[update]${NC} $1"; }
warn()  { echo -e "${YELLOW}[update]${NC} $1"; }
err()   { echo -e "${RED}[update]${NC} $1" >&2; }
step()  { echo -e "${CYAN}[update]${NC} $1"; }

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║       OpenClaw Mission Control — Update             ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

if [ ! -d .git ]; then
  err "Not a git repository. Run install.sh first."
  exit 1
fi

# ── Git pull ────────────────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
info "Branch: $CURRENT_BRANCH"
step "Pulling latest changes ..."
git pull origin "$CURRENT_BRANCH" 2>&1 | tail -3

# ── Detect changed files ─────────────────────────────────────
CHANGED=$(git diff HEAD~1 --name-only 2>/dev/null || echo "")
NEED_NPM="no"
if echo "$CHANGED" | grep -qE "package\.json|package-lock\.json"; then
  NEED_NPM="yes"
fi

# ── .env.local sync ─────────────────────────────────────────
if echo "$CHANGED" | grep -q "^.env$"; then
  step "Syncing .env to .env.local ..."
  cp .env .env.local
fi

# ── npm install ─────────────────────────────────────────────
if [ "$NEED_NPM" = "yes" ]; then
  step "package.json changed — running npm install ..."
  npm install 2>&1 | tail -3
fi

# ── Build if source files changed ─────────────────────────
BUILD_CHANGED="no"
if echo "$CHANGED" | grep -qE "src/|pages/|app/|next\.config\.|tailwind\.config\.|postcss\.|package\.json"; then
  BUILD_CHANGED="yes"
fi

if [ "$BUILD_CHANGED" = "yes" ]; then
  step "Source files changed — rebuilding Next.js ..."
  npm run build 2>&1 | tail -5
else
  info "No source changes — skipping build."
fi

# ── Restart host services ────────────────────────────────────
step "Restarting host services ..."
bash scripts/mc-services.sh restart 2>&1 | sed 's/^/  /'

# ── Convenience symlinks for new scripts ────────────────────
INSTALLED_AFTER=$(ls "$SCRIPT_DIR"/*.sh 2>/dev/null | xargs -I{} basename {} .sh | sort)
for script in $INSTALLED_AFTER; do
  symlink="/usr/local/bin/mc-${script}"
  source_file="$SCRIPT_DIR/${script}.sh"
  [ -f "$source_file" ] && [ ! -e "$symlink" ] && ln -sf "$source_file" "$symlink" && info "Added: /usr/local/bin/mc-${script}"
done

echo ""
info "Update complete."
echo ""
