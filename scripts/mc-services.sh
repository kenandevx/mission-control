#!/usr/bin/env bash
# ============================================================
# OpenClaw Mission Control — Service Supervisor
# Manages all persistent services as background daemons.
#
# Usage:
#   mc-services start     — start all services
#   mc-services stop      — stop all services
#   mc-services restart   — stop then start
#   mc-services status    — show running status + recent log lines
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="$PROJECT_ROOT/.runtime"
PID_DIR="$RUNTIME_DIR/pids"
LOG_DIR="$RUNTIME_DIR/logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

# ── Load .env if present ────────────────────────────────────
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

# ── Service definitions ─────────────────────────────────────
SERVICES="task-worker gateway-sync bridge-logger agenda-scheduler agenda-worker nextjs"

declare -A SERVICE_CMDS
declare -A SERVICE_LOG_FILES
declare -A SERVICE_PIDS

for svc in $SERVICES; do
  SERVICE_PIDS[$svc]="$PID_DIR/${svc}.pid"
  SERVICE_LOG_FILES[$svc]="$LOG_DIR/${svc}.log"
done

SERVICE_CMDS[task-worker]="node scripts/task-worker.mjs"
SERVICE_CMDS[gateway-sync]="node scripts/gateway-sync.mjs"
SERVICE_CMDS[bridge-logger]="node scripts/bridge-logger.mjs"
SERVICE_CMDS[agenda-scheduler]="node scripts/agenda-scheduler.mjs"
SERVICE_CMDS[agenda-worker]="node scripts/agenda-worker.mjs"
SERVICE_CMDS[nextjs]="cd \"$PROJECT_ROOT\" && npm start"

# ── Helpers ────────────────────────────────────────────────
pid_running() {
  local pid=$1
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

kill_port() {
  local port=$1
  if command -v fuser >/dev/null 2>&1; then
    fuser -k 3000/tcp 2>/dev/null || true
    sleep 1
  fi
  # Fallback: also try to kill any remaining next-server directly
  local pid
  pid=$(lsof -ti:3000 2>/dev/null) || true
  if [ -n "$pid" ]; then
    kill -9 "$pid" 2>/dev/null || true
    sleep 0.5
  fi
}

start_service() {
  local svc=$1
  local pid_file="${SERVICE_PIDS[$svc]}"
  local log_file="${SERVICE_LOG_FILES[$svc]}"
  local cmd="${SERVICE_CMDS[$svc]}"

  # ── Pre-start cleanup ─────────────────────────────────────
  # nextjs: kill anything holding its port and wait for release
  if [ "$svc" = "nextjs" ]; then
    if command -v fuser >/dev/null 2>&1; then
      fuser -k 3000/tcp 2>/dev/null || true
      # Wait up to 5s for port to be released
      for i in $(seq 1 10); do
        fuser 3000/tcp >/dev/null 2>&1 || break
        sleep 0.5
      done
    fi
  fi

  if pid_running "$(cat "$pid_file" 2>/dev/null)"; then
    echo "  $svc — already running (pid $(cat "$pid_file"))"
    return 0
  fi

  echo -n "  Starting $svc... "
  cd "$PROJECT_ROOT"
  (
    exec bash -c "$cmd" >> "$log_file" 2>&1
  ) &
  local new_pid=$!
  echo "$new_pid" > "$pid_file"
  sleep 0.5
  if pid_running "$new_pid"; then
    echo "pid $new_pid"
  else
    echo "FAILED — check $log_file"
    rm -f "$pid_file"
    return 1
  fi
}

stop_service() {
  local svc=$1
  local pid_file="${SERVICE_PIDS[$svc]}"
  local pid
  pid="$(cat "$pid_file" 2>/dev/null)" || true

  # Try PID file first; fall back to pkill if stale/missing
  if [ -n "$pid" ] && pid_running "$pid"; then
    echo -n "  Stopping $svc (pid $pid)... "
    kill "$pid" 2>/dev/null
    local count=0
    while pid_running "$pid" && [ $count -lt 10 ]; do
      sleep 0.5
      count=$((count + 1))
    done
    if pid_running "$pid"; then
      kill -9 "$pid" 2>/dev/null
      sleep 0.2
    fi
    echo "stopped"
  else
    # Fallback: pkill by process name
    case "$svc" in
      task-worker)
        pkill -f "task-worker.mjs" 2>/dev/null && echo "  $svc — killed via pkill" || echo "  $svc — not running"
        ;;
      gateway-sync)
        pkill -f "gateway-sync.mjs" 2>/dev/null && echo "  $svc — killed via pkill" || echo "  $svc — not running"
        ;;
      bridge-logger)
        pkill -f "bridge-logger.mjs" 2>/dev/null && echo "  $svc — killed via pkill" || echo "  $svc — not running"
        ;;
      agenda-scheduler)
        pkill -f "agenda-scheduler.mjs" 2>/dev/null && echo "  $svc — killed via pkill" || echo "  $svc — not running"
        ;;
      agenda-worker)
        pkill -f "agenda-worker.mjs" 2>/dev/null && echo "  $svc — killed via pkill" || echo "  $svc — not running"
        ;;
      nextjs)
        kill_port 3000
        echo "  $svc — port 3000 cleared"
        ;;
    esac
  fi
  rm -f "$pid_file"
}

status_service() {
  local svc=$1
  local pid_file="${SERVICE_PIDS[$svc]}"
  local log_file="${SERVICE_LOG_FILES[$svc]}"

  if pid_running "$(cat "$pid_file" 2>/dev/null)"; then
    echo "  $svc — RUNNING (pid $(cat "$pid_file"))"
    [ -f "$log_file" ] && echo "    Last:" && tail -2 "$log_file" | sed 's/^/      /'
  else
    echo "  $svc — STOPPED"
  fi
}

# ── Commands ───────────────────────────────────────────────
CMD="${1:-status}"

case "$CMD" in
  start)
    echo "[mc-services] Starting services..."
    for svc in $SERVICES; do
      if [ "${2:-}" = "--dev" ] && [ "$svc" = "nextjs" ]; then
        echo "  $svc — skipped (--dev mode)"
        continue
      fi
      start_service "$svc"
    done
    echo "[mc-services] All services started."
    ;;
  stop)
    echo "[mc-services] Stopping services..."
    for svc in $SERVICES; do
      stop_service "$svc"
    done
    echo "[mc-services] All services stopped."
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  status)
    echo "[mc-services] Service status:"
    for svc in $SERVICES; do
      status_service "$svc"
    done
    ;;
  *)
    echo "Usage: mc-services {start|stop|restart|status}"
    exit 1
    ;;
esac
