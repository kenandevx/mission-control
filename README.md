# Mission Control

> **Local-first OpenClaw dashboard** — Boards, logs, worker metrics, and real-time observability.

This README is the single source of truth for installation, operation, development, and security. Keep it updated with every change.

---

## 📋 Table of Contents
- [What it is](#what-it-is)
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Development](#development)
- [Production hardening](#production-hardening)
- [Real-time features](#real-time-features)
- [Troubleshooting](#troubleshooting)
- [Filemap](#filemap)
- [Changelog](#changelog)

---

## What it is

Mission Control provides:
- **Dashboard UI** (Next.js App Router, Tailwind, shadcn/ui)
- **Live logs** (SSR + SSE stream from Postgres `LISTEN/NOTIFY`)
- **Ticket execution worker** (DB-backed queue, concurrency control)
- **Board with real-time updates** (SSE, instant chip movement)
- **Dockerized dev & prod modes** (Postgres, bridge-logger, task-worker)

Design principles:
- **Local-first**: No mandatory cloud dependencies
- **Operationally simple**: One command to start everything
- **Readable logs**: Human previews + raw JSON details
- **Secure by default**: Basic Auth, read-only mounts, non‑root containers

---

## Quick start

### Prerequisites
- Docker & Docker Compose (`docker compose v2+`)
- Node.js 24+
- OpenClaw installed and gateway running on `ws://127.0.0.1:18789`

### 1. First-time setup (one machine, run once)
```bash
./scripts/install.sh
```
This auto-clones the repo, generates credentials, sets up the DB schema, and starts all Docker services.

### 2. Development
```bash
npm run dev   # starts Docker services + Next.js with hot-reload
```
Press `Ctrl+C` to stop everything.

### 3. Update code
```bash
./scripts/update.sh
```

### 4. Stop
```bash
npm run dev:stop   # stop Docker services
# or
docker compose down
```

### 5. Open the app
- **Boards**: http://localhost:3000/boards?board=\<board-id\>
- **Logs**: http://localhost:3000/logs

---

## Architecture

```
┌─────────────────┐    /api/tasks    ┌─────────────────┐
│   Next.js UI    │◄─────────────────►│   PostgreSQL    │
│   (localhost)   │                  │   (Docker)      │
└─────────────────┘                  └─────────────────┘
         │                                    ▲
         │ SSE /api/events                   │
         ▼                                    │
┌─────────────────┐    logs → DB      ┌─────────────────┐
│  task-worker    │───────────────────►│  bridge-logger  │
│  (agent exec)   │                   │  (tail logs)    │
└─────────────────┘                  └─────────────────┘
         ▲
         │ agent runs
         │
┌─────────────────┐
│  OpenClaw       │
│  gateway        │
│  (127.0.0.1:18789)
└─────────────────┘
```

**Components**
- **UI**: Server components for initial render; client components use SSE for live updates.
- **DB**: Single source of truth. `agent_logs`, `tickets`, `boards`, `columns`, `ticket_activity`, `worker_settings`.
- **task-worker**: Event-driven executor. Listens for `ticket_ready` notifications via Postgres `LISTEN/NOTIFY`. Picks tickets with `SELECT ... FOR UPDATE SKIP LOCKED`, runs `openclaw agent`, updates states. No polling.
- **bridge-logger**: Ingests OpenClaw logs into `agent_logs`; emits `pg_notify`.
- **gateway**: OpenClaw gateway for agent–Telegram bridge.

---

## Development

### Scripts
| Script | Purpose |
|--------|---------|
| `scripts/start.sh` | **Unified startup** (Docker + dev server). Use this. |
| `scripts/install.sh` | One-time setup (creates `.env`, starts Docker). Legacy. |
| `scripts/update.sh` | `git pull` and rebuild Docker images. |
| `npm run dev` | Start Next.js dev server only (if Docker already running). |
| `docker compose up -d` | Start Docker services only. |

### Environment variables
See `.env.example`. Important ones:
- `POSTGRES_PASSWORD` — strong random password for DB
- `API_USER` / `API_PASS` — protect `/api/*` endpoints
- `OPENCLAW_GATEWAY_URL` — usually `ws://127.0.0.1:18789`

### Database
Schema & seed applied automatically on first startup (db-init container). To reset:
```bash
docker compose down
docker volume rm mission-control_pgdata
docker compose up -d db-init
```

### Worker metrics API
`GET /api/tasks/worker-metrics` returns:
```json
{
  "enabled": true,
  "maxConcurrency": 3,
  "activeNow": 1,
  "queuedCount": 4,
  "lastTickAt": "2026-03-23T22:00:00Z"
}
```
Used by the WorkerStatus component (top-right).

### Multiple queues
Workers can be partitioned into independent queues by setting the `WORKER_QUEUE` environment variable (default: `default`). Tickets have a `queue_name` field (also defaults to `default`). Only workers with a matching queue name will pick up those tickets. This allows you to run separate worker pools for different priorities or teams without interference. All workers share the same DB and receive the same `ticket_ready` events; they filter at claim time using `queue_name`.

---

## Production hardening

### 1. Authentication
**Enable HTTP Basic Auth** on all `/api/*` routes by setting `API_USER` and `API_PASS` in the environment. If not set, the API is open (dev mode only). **Always set in production.**

### 2. Database isolation
- Do **not** publish port 5432 to the host. The current `docker-compose.yml` exposes it for dev convenience; remove the `ports` mapping in production.
- Use a strong `POSTGRES_PASSWORD`.
- Containers only should be able to reach the DB via the Docker network.

### 3. TLS & reverse proxy
If exposing the dashboard externally, put it behind a reverse proxy (Nginx/Traefik) with TLS termination. Basic Auth adds a second layer.

### 4. Filesystem mounts
`~/.openclaw` is mounted read-only (`:ro`) into `task-worker` and `bridge-logger`. The host files cannot be modified from the container. This is intentional.

### 5. Secrets management
- Never commit `.env` or `.env.local` (they are gitignored).
- In production, use a secrets manager (Docker secrets, HashiCorp Vault, etc.).

### 6. Container user isolation
Run containers as non‑root users where possible. The OpenClaw plugin directory must be owned by the container user to avoid "suspicious ownership" blocks. In dev we use `root` for simplicity; in prod create a `worker` user with matching UID/GID.

### 7. Backups
Backup the Postgres volume regularly:
```bash
docker run --rm \
  -v mission-control_pgdata:/data \
  -v /path/to/backup:/backup \
  alpine \
  tar czf /backup/pgdata-$(date +%F).tar.gz -C /data .
```

---

## Real-time features

- **Live logs**: SSE (`/api/agent/logs/stream`) streams new logs as they are inserted.
- **Board activity**: SSE (`/api/events` → `ticket_activity`) updates the activity list instantly.
- **Ticket execution**: `ticket_ready` notifications wake the worker instantly; no polling.
- **Ticket moves**: `ticket_activity` also triggers a full board reload, so dragged chips update everywhere instantly.
- **Worker status**: `worker_tick` events keep the top‑right status bar current.

---

## Troubleshooting

### DB connection refused (127.0.0.1:5432)
**Cause**: DB container not exposing port to host.  
**Fix**: Ensure `db` service has `ports: ["5432:5432"]` in `docker-compose.yml`, then `docker compose down && docker compose up -d`.

### Password auth failed for "openclaw"
**Cause**: `.env.local` password doesn't match container's `POSTGRES_PASSWORD`.  
**Fix**: Sync them. In `.env.local`:
```
DATABASE_URL=postgresql://openclaw:<actual-password>@localhost:5432/mission_control
OPENCLAW_DATABASE_URL=postgresql://openclaw:<actual-password>@localhost:5432/mission_control
```

### Bridge logger: "Unable to add filesystem"
**Cause**: `fs.watch` fails on some bind mounts.  
**Fix**: Already switched to `fs.watchFile` in `scripts/bridge-logger.mjs`. Pull latest code.

### Bridge logger: "another instance is already running" or "permission denied"
**Cause**: Stale PID lock file in `.runtime/bridge-logger/bridge-logger.lock`.  
**Fix**:
```bash
rm -f .runtime/bridge-logger/bridge-logger.lock
# If permission denied, also do:
chmod 666 .runtime/bridge-logger/bridge-logger.lock
docker compose restart bridge-logger
```

### Worker can't connect to gateway
**Cause**: Container's `127.0.0.1:18789` is not the host gateway.  
**Fix**:
- Set `OPENCLAW_GATEWAY_URL=ws://host.docker.internal:18789` in `docker-compose.yml` for `task-worker`
- Add `extra_hosts: ["host.docker.internal:host-gateway"]`
- In `openclaw.json`, set `"gateway.bind": "lan"` and run `openclaw gateway restart`
- Verify `ss -tlnp | grep 18789` shows `0.0.0.0:18789`

### Agent plugin not found (memory-qdrant)
**Cause**: Incorrect `sourcePath` in `openclaw.json` or bad permissions.  
**Fix**:
1. Ensure `plugins.installs.memory-qdrant.sourcePath = "extensions/memory-qdrant"`
2. `chmod -R 755 ~/.openclaw/extensions/memory-qdrant`
3. Remove stale `memory-lancedb` from `plugins.entries`
4. Restart `task-worker`

### Hydration mismatch (React)
**Cause**: Server/client date formatting differed.  
**Fix**: All dates now use UTC explicitly in both server and client. Hard refresh browser.

---

## Filemap

```
.
├── README.md                 # This document
├── .env.example              # Environment template
├── Dockerfile                # Next.js image
├── docker-compose.yml        # Full stack (dev + prod)
├── package.json              # Dependencies & scripts
├── app/                      # Next.js app router
│   ├── api/
│   │   ├── tasks/            # Main API: boards, tickets, worker settings
│   │   ├── tasks/worker-metrics/  # Worker status metrics
│   │   ├── events/           # SSE endpoint (ticket_activity, worker_tick)
│   │   └── agent/logs/       # Logs query + SSE stream
│   ├── boards/page.tsx       # Boards list page
│   └── logs/page.tsx         # Logs page
├── components/
│   ├── dashboard/
│   │   └── worker-status.tsx # Top-right worker metrics
│   ├── tasks/
│   │   ├── boards/
│   │   │   └── boards-page-client.tsx  # Real-time board UI
│   │   └── modals/           # Create board/list, ticket details
│   └── ui/                    # shadcn/ui primitives
├── hooks/
│   └── use-tasks.ts          # Board state management, reloadBoards()
├── lib/
│   ├── db/
│   │   ├── server-data.ts    # Server data loaders
│   │   └── adapter.ts        # DB abstraction
│   └── tasks/
│       └── worker-core.mjs   # Worker eligibility logic
├── scripts/
│   ├── start.sh              # **Use this** to start everything
│   ├── bridge-logger.mjs     # Log ingestion daemon
│   └── task-worker.mjs       # Ticket execution worker
└── db/
    ├── schema.sql            # Database schema
    └── seed.sql              # Initial data
```

---

## Changelog

### 2026-03-24 (current)
- Rewrote `install.sh` as a proper one-time installer with auto-clone from Git, credential generation, DB setup, and Docker start
- Added `update.sh` for git pull + rebuild + restart workflow
- Removed `start.sh` — dev workflow is now `npm run dev:docker` (Docker) + `npm run dev` (Next.js)
- Cleaned up `package.json` scripts: `dev:docker`, `dev:full`, `dev:stop`
- Removed redundant `docker-compose.dev.yml` and `scripts/dev.sh` (conflicted with main compose)
- Fixed bridge-logger restart loop with PID+timestamp lock file
- Updated quick-start docs to reflect new three-script workflow

### 2026-03-24 (earlier)
- Rewrote `install.sh` as proper first-time setup with Docker image pulls and build
- Rewrote `start.sh` to actually launch Next.js dev server (previously just printed message)
- Updated quick-start docs to mention `install.sh` for first-time setup
- Fixed bridge-logger restart loop caused by stale PID lock file
- Added troubleshooting entry for bridge-logger "another instance" / permission errors
- Updated boards URL format to include board ID query param

### 2026-03-23
- Consolidated docs into single README; removed `SECURITY.md`
- Added unified `.env.example` and `scripts/start.sh`
- Replaced polling with SSE for board activity & logs
- Implemented real-time ticket updates (reload on `ticket_activity`)
- Added worker metrics API (`/api/tasks/worker-metrics`) and improved status UI
- Fixed hydration mismatches (UTC dates)
- Fixed Docker networking for task‑worker → gateway communication
- Updated bridge logger to use `fs.watchFile` (stable on bind mounts)
- Agent config fixes: correct plugin path, permissions, stale entries removed

---

## License & Support

Mission Control is part of OpenClaw. See the main repository for license and community support.