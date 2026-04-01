#!/usr/bin/env bash
# ============================================================
# OpenClaw Mission Control — Uninstall Script
# Removes Docker container, volume, and project directory.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║       OpenClaw Mission Control — Uninstall           ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

echo "This will permanently remove:"
echo "  - DB container"
echo "  - DB volume"
echo "  - $PROJECT_ROOT"
echo ""
read -rp "Type 'yes' to confirm: " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

docker rm -f mission-control-db-1
docker volume rm mission-control_pgdata 2>/dev/null || true
rm -rf "$PROJECT_ROOT"

echo ""
echo "Uninstall complete."
