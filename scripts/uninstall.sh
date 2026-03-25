#!/usr/bin/env bash
# ============================================================
# OpenClaw Mission Control — Uninstall Script
# Completely removes the Mission Control installation:
#   - Host services (task-worker, gateway-sync, bridge-logger)
#   - Docker containers and volumes
#   - Project directory
#   - Convenience symlinks
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[uninstall]${NC} $1"; }
warn()  { echo -e "${YELLOW}[uninstall]${NC} $1"; }
err()   { echo -e "${RED}[uninstall]${NC} $1" >&2; }

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║       OpenClaw Mission Control — Uninstall          ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

warn "This will PERMANENTLY remove:"
echo "  1. Host services (task-worker, gateway-sync, bridge-logger)"
echo "  2. All Docker containers and volumes"
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

# ── Stop host services ───────────────────────────────────────
info "Stopping host services ..."
cd "$PROJECT_ROOT"
bash scripts/mc-services.sh stop 2>&1 | sed 's/^/  /' || true

# ── Docker: stop + remove ───────────────────────────────────
info "Removing Docker containers and volumes ..."
docker compose down --volumes --remove-orphans 2>&1 | tail -3 || true

# ── Remove project dir ───────────────────────────────────────
info "Removing project directory ..."
rm -rf "$PROJECT_ROOT"
echo "  Removed: $PROJECT_ROOT"

# ── Remove convenience symlinks ────────────────────────────────
info "Removing convenience symlinks ..."
for script in install clean update uninstall mc-services dev; do
  symlink="/usr/local/bin/mc-${script}"
  if [ -L "$symlink" ]; then
    rm -f "$symlink"
    echo "  Removed: $symlink"
  fi
done

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║         Uninstall complete.                      ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
info "Mission Control has been completely removed."
echo ""
