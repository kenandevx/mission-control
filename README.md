# OpenClaw Mission Control v1.0.0

> **Local-first OpenClaw dashboard** — Boards, real-time logs, worker queue management, and agent observability.

Mission Control is a self-hosted operations dashboard for [OpenClaw](https://github.com/claw-arsenal/mission-control). It gives you a live Kanban board, real-time agent log streaming, a ticket execution queue with worker metrics, and per-agent status pages — all running on your own infrastructure with PostgreSQL as the single source of truth.

---

## Table of Contents

- [What it is](#what-it-is)
- [Product features](#product-features)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Codebase structure](#codebase-structure)
- [Scripts and runtime](#scripts-and-runtime)
- [Setup and development](#setup-and-development)
- [Production deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)

---

## What it is

Mission Control solves the problem of operating a multi-agent OpenClaw deployment without good visibility into what agents are doing.

It gives operators:

- A **live Kanban board** where tickets can be created, assigned to agents, and dragged between columns
- **Real-time log streaming** via SSE — watch agent activity as it happens, filtered by agent/type/level
- A **ticket execution worker** that picks up queued work, runs OpenClaw agents, and reports results back to Telegram
- **Agent status pages** showing model, queue depth, recent heartbeat, and per-agent log history
- **Plan approval workflows** — agents can generate execution plans that require human sign-off before running
- **Multi-queue isolation** — worker pools can be partitioned by queue name for separate priority tiers

---

## Product features

### Dashboard (`/dashboard`)

The overview page shows:

- **Section cards**: total tickets, in-progress count, in-review count, completed count (with completion %), and 24-hour log event count
- **Activity chart**: placeholder for trend visualization (ready to wire up)
- **Data table**: list of all tickets across the default board, sortable and searchable
- **Activity feed**: recent workspace events from `activity_logs`

### Boards / Kanban (`/boards`)

Full Kanban board with three view modes — **Kanban**, **List**, and **Grid** — toggled from the toolbar.

Features:
- **Boards**: create, rename, copy, delete boards; each board has its own set of columns and tickets
- **Columns (Lists)**: create and reorder columns; delete non-default columns; columns have a color key (neutral, info, warning, success)
- **Tickets**: create, edit, move (drag-and-drop), copy, delete; assignees stored as ID/name pairs; priority (low/medium/high/urgent); due dates; tags
- **Ticket detail modal**: edit title, description, priority, assignees, due date, execution mode; manage subtasks, comments, attachments, and activity log
- **Activity log (ticket)**: every execution event is written to `ticket_activity` including agent responses, plan generation, worker pickup, completion, and failures. Agent responses are shown prominently in a dedicated block (🤖 Agent badge + full response text). Clickable in the board live feed to open the relevant ticket directly.
- **Execution modes**: `direct` (agent runs immediately) or `planned` (plan is generated first, then requires approval)
- **Real-time via SSE**: board state stays in sync through Server-Sent Events — ticket moves and activity appear instantly without a full reload

### Agents (`/agents`)

Per-agent status page showing:
- Agent card grid with status badge (running/idle/degraded), model, last heartbeat, queue depth
- Stats cards: total agents, running count, responses in the last hour, memory operations in the last hour
- Optional debug overlay (enabled via `NEXT_PUBLIC_AGENT_DEBUG_OVERLAY=true`)
- Runtime data collected via `openclaw sessions --all-agents --json`

### Logs (`/logs`)

Live agent log explorer with:
- **SSE streaming** (`/api/agent/logs/stream`) — new rows prepend instantly
- Pagination, level filtering (info/warning/error), event type filtering, agent filtering
- **Log details modal** — full message, raw JSON payload, metadata (session key, channel type, direction, correlation ID, retry count)
- **Clear logs button** — wipe agent logs for a fresh start

Log types tracked: `workflow` (chat messages), `tool` (tool calls and outcomes), `memory` (qdrant/vector operations), `system` (startup, shutdown, errors)

### Approvals (`/approvals`)

Dedicated page listing tickets in `awaiting_plan_approval` state. Operators can approve or reject plans inline, which transitions the ticket to `queued` (approved) or `draft` (rejected) in the database and notifies the worker.

### Health endpoint (`/health`)

`GET /health` returns `200` with `{ ok: true, db: true }` when the database is reachable, or `503` if not. Used by Docker healthchecks.

---

## How it works

### Ticket lifecycle

A ticket moves through the following states:

```
open → planning → awaiting_approval → queued → executing → done
                 ↘ (rejected) → draft    ↘ (failed) → failed
```

1. **Created** — ticket lands in a column with `execution_state = open`
2. **Direct mode** — worker picks it up when it reaches the In Progress column and `execution_state` is `queued` or `ready_to_execute`
3. **Planned mode** — worker calls the agent to generate a plan; ticket goes to `awaiting_approval`; operator approves or rejects in the UI or via Telegram
4. **Auto-approve** — tickets with `auto_approve = true` are promoted to `queued` automatically by the worker on each tick
5. **Execution** — worker calls `openclaw agent --agent <id> --message <prompt> --json` with Telegram session context if `telegram_chat_id` is set
6. **Result** — on success the ticket moves to the Done/completed column; on failure it stays in place with `execution_state = failed`

### Real-time updates

The system uses Postgres `LISTEN/NOTIFY` as the event bus:

| Event | Triggered by | SSE stream |
|---|---|---|
| `ticket_ready` | Ticket transitions to `queued`/`ready_to_execute` | Wakes task-worker via `sql.listen()` |
| `worker_tick` | Worker completes a tick | `/api/events` → `worker_tick` event |
| `ticket_activity` | Activity row inserted | `/api/events` → `ticket_activity` event |
| `agent_logs` | Log row inserted | `/api/agent/logs/stream` → `log_row` event |

The UI subscribes to SSE endpoints and prepends/updates rows in real time.

### Worker ticket picking

The worker uses a transaction with `SELECT ... FOR UPDATE SKIP LOCKED` to atomically claim up to `maxConcurrency` tickets without conflicts between multiple worker instances:

```sql
SELECT ... FROM tickets
WHERE column_id = ANY($inProgressIds)
  AND execution_state IN ('queued', 'ready_to_execute')
  AND queue_name = $myQueue
  AND assigned_agent_id <> ''
  AND (scheduled_for IS NULL OR scheduled_for <= now())
ORDER BY updated_at ASC
FOR UPDATE SKIP LOCKED
LIMIT $capacityLeft
```

After claiming, the worker updates `execution_state = 'picked_up'` and calls `openclaw agent`.

### Bridge logger

The bridge-logger (`scripts/bridge-logger.mjs`) runs as a long-lived daemon that:

1. Scans `~/.openclaw/agents/<agentId>/sessions/*.jsonl` for new session log lines
2. Scans `/tmp/openclaw/openclaw-*.log` for gateway log entries
3. Parses each line as JSON, normalizes it into an `agent_logs` row
4. Deduplicates within a 30-second window
5. Inserts into the DB and emits `pg_notify('agent_logs', insertedId)`
6. Falls back to dead-letter file if DB insert fails, and replays every 30 seconds

### Gateway sync

The gateway-sync script (`scripts/gateway-sync.mjs`) runs on startup and one-time import:

1. Reads `openclaw sessions --all-agents --json` to get all known sessions
2. Upserts agent records into the `agents` table (status, model, last heartbeat)
3. Imports recent session events into `agent_logs`
4. Resolves `OPENCLAW_GATEWAY_TOKEN` from DB `app_settings` if not in environment

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (SSE)                           │
│   /boards  /logs  /agents  /dashboard  /approvals         │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP + SSE
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Next.js App (port 3000)                       │
│   Server Components + API Routes + SSE endpoints            │
└─────────────┬─────────────────────────┬───────────────────┘
              │                         │
              │ HTTP/REST               │ LISTEN/NOTIFY
              ▼                         ▼
┌───────────────────────┐   ┌─────────────────────────────────┐
│   PostgreSQL DB       │◄──│      task-worker (host)         │
│   (Docker only)       │   │  Picks tickets via SKIP LOCKED  │
│                       │   │  Runs openclaw agent            │
└───────────────────────┘   │  Writes activity + status       │
        ▲                   └──────────────┬────────────────┘
        │ LISTEN/NOTIFY                     │ openclaw agent │
        │                                   ▼                │
┌───────────────┐   ┌─────────────────────────────────────────┐
│ bridge-logger │   │          OpenClaw Gateway              │
│ (host) tails  │   │         (ws://127.0.0.1:18789)        │
│ openclaw logs │   └─────────────────────────────────────────┘
└───────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│              gateway-sync (host)                            │
│  Imports openclaw sessions + agents into DB on startup      │
└─────────────────────────────────────────────────────────────┘
```

### Services

| Service | Where | Why |
|---|---|---|
| PostgreSQL | Docker | No host dependency, portable |
| Next.js | Host (or Docker) | Node.js 24+ on host, hot-reload dev |
| task-worker | Host | Calls openclaw binary + needs `~/.openclaw` access |
| gateway-sync | Host | Calls openclaw binary |
| bridge-logger | Host | Tails log files from `~/.openclaw` |

### Services

| Service | Type | Responsibility |
|---|---|---|
| `app` | Next.js (Node.js) | UI, API routes, SSE streams |
| `db` | PostgreSQL 15 | All persistent data |
| `db-init` | One-shot container | Runs schema + seed SQL on first start |
| `task-worker` | Long-lived Node.js process | Event-driven ticket executor |
| `bridge-logger` | Long-lived Node.js process | Log file ingestion → DB |
| `gateway-sync` | One-shot Node.js process | Import sessions from openclaw CLI |

### Data flow

- **Tickets**: Created/updated via `POST /api/tasks` → written to `tickets` → `pg_notify('ticket_ready')` wakes worker → worker builds a structured prompt (title, description, subtasks, notes/comments, metadata) → calls `openclaw agent` → writes agent's response + completion/failure to `ticket_activity` → updates `execution_state`
- **Logs**: Session JSONL lines parsed by bridge-logger → `agent_logs` rows → `pg_notify('agent_logs')` → SSE stream to browser
- **Activity**: All mutations write to `ticket_activity` and `activity_logs` → `pg_notify('ticket_activity')` → SSE → UI activity feed
- **Worker metrics**: `GET /api/tasks/worker-metrics` reads `worker_settings` + active/queued ticket counts

### Real-time channels

All real-time channels use Server-Sent Events (SSE) over HTTP/1.1:

- `GET /api/events` — worker ticks + ticket activity
- `GET /api/agent/logs/stream` — new agent log rows

Both send a `ping` comment every 20 seconds to keep connections alive through proxies.

---

## Codebase structure

```
mission-control/
├── app/                          # Next.js App Router pages and API routes
│   ├── api/
│   │   ├── tasks/               # Boards, tickets, columns, worker settings
│   │   │   ├── route.ts          # GET (all boards/columns/tickets) + POST (all actions)
│   │   │   └── worker-metrics/   # GET — returns {enabled, maxConcurrency, activeNow, queuedCount}
│   │   ├── events/               # GET — SSE stream for ticket_activity + worker_tick
│   │   ├── agent/
│   │   │   ├── logs/
│   │   │   │   ├── route.ts      # GET — paginated log query
│   │   │   │   └── stream/       # GET — SSE stream for new log rows
│   │   ├── notifications/        # POST — push notifications
│   │   ├── setup/                # POST — first-run setup
│   │   └── _proxy.ts             # Proxy utility for authenticated gateway calls
│   ├── agents/
│   │   ├── page.tsx             # Agent list + status cards
│   │   └── [agentId]/page.tsx   # Per-agent detail page
│   ├── approvals/               # Pending plan approvals page
│   ├── boards/
│   │   └── page.tsx             # Kanban board page (server → client handoff)
│   ├── dashboard/
│   │   └── page.tsx             # Overview with section cards + activity feed
│   ├── logs/
│   │   └── page.tsx             # Live log explorer page
│   ├── login/                   # Login screen
│   ├── setup/                   # First-run setup wizard
│   ├── health/
│   │   └── route.ts            # GET /health → 200/503
│   └── layout.tsx               # Root layout with sidebar + providers
│
├── components/
│   ├── agents/                 # Agent list, log explorer, status badges, debug overlay
│   ├── approvals/              # ApprovalsList + pending count hook
│   ├── auth/                   # Login screen + hero graphic
│   ├── dashboard/             # Section cards, activity feed, chart, data table
│   ├── layout/               # App sidebar, nav sections, page header
│   ├── tasks/
│   │   ├── boards/           # BoardsPageClient (main board UI with SSE)
│   │   ├── kanban/           # KanbanView, KanbanColumn
│   │   ├── list/             # ListView
│   │   ├── grid/            # GridView
│   │   └── modals/          # CreateBoard, CreateList, TicketDetails, AssigneeMini, etc.
│   └── ui/                   # shadcn/ui primitives
│
├── hooks/
│   └── use-tasks.ts          # All board/ticket state: create, move, save, SSE wiring, reloadBoards()
│
├── lib/
│   ├── db/
│   │   ├── adapter.ts        # Type-safe DB read/write operations
│   │   ├── server-data.ts   # SSR data loaders (getBoardsPageData, getDashboardData, etc.)
│   │   └── index.ts          # DB export
│   ├── runtime/
│   │   ├── collector.ts     # collectRuntimeSnapshots() — reads openclaw sessions CLI
│   │   ├── merge.ts         # mergeAgentWithRuntime() — overlay runtime data on DB agents
│   │   └── types.ts         # RuntimeSnapshot, RuntimeAssignee types
│   ├── agent-log-utils.ts   # Log formatting helpers
│   ├── local-db.ts          # getSql() — shared postgres connection
│   └── utils.ts             # General utilities (clsx, date-fns wrappers)
│
├── types/
│   ├── agents.ts            # Agent, AgentLog, AgentRuntime, AgentRuntimeMeta types
│   └── tasks.ts            # Ticket, Board, Column, BoardState, CreateTicketForm, etc.
│
├── scripts/
│   ├── task-worker.mjs      # Ticket execution worker (event-driven + polling fallback)
│   ├── bridge-logger.mjs   # Session/gateway log file ingestion daemon
│   ├── gateway-sync.mjs    # One-shot openclaw session import
│   ├── db-init.sh          # SQL schema + seed runner (used by db-init container)
│   ├── db-setup.mjs        # DB migration/seed CLI (for npm scripts)
│   ├── install.sh           # First-time setup: clone, env, Docker build/start
│   ├── update.sh           # git pull + Docker rebuild + service restart
│   ├── uninstall.sh         # Stop and remove Docker services + volumes
│   ├── openclaw.container.json  # Legacy: was for in-container task-worker; task-worker now runs on host
│   └── repair-agent-log-attribution.mjs  # Fix log rows with missing agent_id
│
├── db/
│   ├── schema.sql          # All tables, indexes, constraints, triggers
│   └── seed.sql            # Default workspace, boards, columns, demo tickets
│
├── docker-compose.yml       # Dev stack: all services with host port 3000 + 5432
├── docker-compose.prod.yml  # Prod overrides: no DB port, non-root user, restart policies
├── Dockerfile               # Multi-stage build: deps → builder → runner (non-root)
└── package.json             # Scripts, dependencies (Next.js 16, postgres.js, shadcn/ui)
```

### Key API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/tasks` | GET | Fetch all boards, columns, tickets, worker settings |
| `/api/tasks` | POST | All board/ticket mutations (createBoard, createTicket, moveTicket, etc.) |
| `/api/tasks/worker-metrics` | GET | Queue depth, active count, concurrency settings |
| `/api/events` | GET | SSE: `worker_tick` + `ticket_activity` events |
| `/api/agent/logs/stream` | GET | SSE: `log_row` events for live log view |
| `/api/agent/logs` | GET | Paginated log query with filters |
| `/health` | GET | Liveness probe |

### Database tables

| Table | Purpose |
|---|---|
| `workspaces` | Top-level isolation unit (one workspace per install) |
| `profiles` | User accounts |
| `boards` | Named board containers |
| `columns` | Columns within a board (Backlog, In Progress, etc.) |
| `tickets` | Tickets with execution state, assignees, priority, scheduling |
| `ticket_subtasks` | Checklist items on a ticket |
| `ticket_comments` | Comments on a ticket |
| `ticket_attachments` | File attachments (stored as data: URIs) |
| `ticket_activity` | All state-change events on a ticket |
| `agents` | Registered agents (maps openclaw agent ID → UUID) |
| `agent_sessions` | Telegram session continuity (chat_id → session_key) |
| `agent_logs` | Ingested log entries from bridge-logger |
| `activity_logs` | Workspace-level activity feed |
| `worker_settings` | Worker enabled/disabled, poll interval, max concurrency |
| `app_settings` | Single-row settings: gateway token, setup completed flag |
| `notification_channels` | Notification routing config |

---

## Scripts and runtime

### Install and update scripts

| Script | Purpose |
|---|---|
| `./scripts/mc-services.sh` | Service supervisor for all host-level daemons. `start` / `stop` / `restart` / `status` for task-worker, gateway-sync, bridge-logger, and Next.js. |
| `./scripts/dev.sh` | Development mode launcher. Starts all services + Next.js dev server in foreground with hot-reload. Ctrl+C stops everything. |
| `./scripts/install.sh` | **Bootstrap install.** Clones repo (or pulls latest), generates `.env`, starts Docker DB, runs `npm install`, builds production Next.js, starts all host services, creates `/usr/local/bin/mc-*` shortcuts. |
| `./scripts/update.sh` | **Update existing install.** Git pull, detects changed files, rebuilds Next.js if needed, restarts host services. |
| `./scripts/clean.sh` | **Fresh start.** Stops all services + Docker, removes volumes, re-pulls latest, re-initializes DB, rebuilds Next.js, restarts everything. |
| `./scripts/uninstall.sh` | **Complete removal.** Stops all services, removes Docker volumes, deletes project dir, removes `mc-*` shortcuts. |
| `./scripts/db-init.sh` | **DB schema init.** SQL schema + seed data. Run automatically on first start via `db-init` container. |

### Runtime worker scripts

| Script | Runs on | Purpose |
|---|---|---|
| `task-worker.mjs` | Host daemon (via mc-services) | Event-driven ticket executor. Listens for `ticket_ready` notifications. Polls every `poll_interval_seconds` as fallback. Uses `SELECT ... FOR UPDATE SKIP LOCKED` to prevent double-pickup. |
| `bridge-logger.mjs` | Host daemon (via mc-services) | Long-lived daemon. Tails session JSONL files + gateway log files. Deduplicates within 30s window. Inserts into `agent_logs`. Emits `pg_notify('agent_logs')`. Dead-letter file on insert failure, replay every 30s. |
| `gateway-sync.mjs` | Host one-shot (via mc-services) | On startup, imports all openclaw sessions into the DB. Resolves gateway token from `app_settings` if not in env. |

### npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Docker DB, host services, and Next.js dev server in foreground. Blocks terminal. **Ctrl+C or `npm run dev:stop` to stop.** |
| `npm run dev:stop` | Stop Docker DB container and all host service daemons. Use this after `npm run dev` to clean up. |
| `npm run dev:db` | Start Docker DB container + db-init only |
| `npm run dev:services` | Start host service daemons only (task-worker, gateway-sync, bridge-logger) |
| `npm run build` | Build Next.js for production |
| `npm run start` | Start production Next.js server (used by mc-services) |
| `npm run db:setup` | Run schema + seed SQL |
| `npm run db:reset` | Drop all tables and re-run schema + seed |
| `npm run bridge:logger` | Run bridge-logger directly (for debugging) |
| `npm run worker:tasks` | Run task-worker directly (for debugging) |
| `npm run bridge:logger:check` | Syntax-check bridge-logger.mjs |
| `npm run worker:tasks:check` | Syntax-check task-worker.mjs |
| `mc-services start` | Start all 4 host daemons: task-worker, gateway-sync, bridge-logger, Next.js |
| `mc-services stop` | Stop all 4 host daemons |
| `mc-services status` | Show service status + last log lines |

---

## Setup and development

### Prerequisites

- Docker + Docker Compose (`docker compose v2+`)
- Node.js 24+
- OpenClaw installed and gateway running on `ws://127.0.0.1:18789`

### Required host-level dependencies

Mission Control's `task-worker` runs `openclaw agent` on the host, so it needs the OpenClaw runtime accessible. These are not optional:

| Dependency | Path | Why |
|---|---|---|
| OpenClaw runtime | `~/.openclaw/` | Agents, credentials, auth profiles — read by task-worker on the host |
| OpenClaw binary | `/usr/bin/openclaw` | task-worker calls this to execute agents |
| OpenClaw gateway | `ws://127.0.0.1:18789` | Must be running for agent execution |
| SSH keys | `~/.ssh/` | Only needed if pushing to git from the host |

> **Note:** The task-worker runs on the host as a native process (not in Docker), so `~/.openclaw` is accessed directly. It is not possible to run Mission Control without a working OpenClaw installation on the host.

### First-time setup (bootstrap)

**One-line install (recommended):**
```bash
curl -fsSL https://raw.githubusercontent.com/claw-arsenal/mission-control/main/install.sh | bash
```

This clones the repo into `~/.openclaw/workspace/mission-control`, generates `.env`, starts the PostgreSQL Docker container, runs `npm install`, starts all host-level services, and creates convenience shortcuts in `/usr/local/bin/mc-*`.

**After install, shortcuts are available:**
```bash
mc-services start   # start all host daemons (task-worker, gateway-sync, bridge-logger, Next.js)
mc-services stop    # stop all host daemons
mc-services status  # check status + recent log lines
mc-update          # pull latest + rebuild + restart all services
mc-clean           # reset containers + volumes + fresh install (keeps .env)
bash dev.sh         # start dev mode (Docker + services + Next.js, Ctrl+C to stop)
```

**For development:** `npm run dev` starts everything in foreground. When done, `npm run dev:stop` to clean up.

### Development

```bash
# Full dev start: Docker DB + services + Next.js dev (hot-reload) in foreground.
# Blocks terminal. Stop with Ctrl+C or 'npm run dev:stop'.
npm run dev

# Stop everything started by 'npm run dev'
npm run dev:stop

# Start only parts separately
npm run dev:db        # Docker DB + schema only
npm run dev:services  # Host daemons only (if DB already running)
```

### Updating code

```bash
./scripts/update.sh
# Then restart your dev server if it was running
```

### Opening the app

- **Dashboard**: http://localhost:3000/dashboard
- **Boards**: http://localhost:3000/boards
- **Logs**: http://localhost:3000/logs
- **Agents**: http://localhost:3000/agents
- **Approvals**: http://localhost:3000/approvals

### Environment variables

See `.env.example`. Key variables:

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | *(generated)* | PostgreSQL password |
| `API_USER` / `API_PASS` | *(generated)* | Basic Auth credentials for `/api/*` routes |
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | OpenClaw gateway WebSocket URL |
| `OPENCLAW_GATEWAY_TOKEN` | *(empty)* | Gateway auth token (if required) |
| `DATABASE_URL` | *(set by docker-compose)* | PostgreSQL connection string |

### Database reset

```bash
mc-services stop
docker compose down --volumes
docker compose up -d db db-init
mc-services start
```

### Multi-queue workers

Set `WORKER_QUEUE=high-priority` (or any name) when starting the task-worker. Tickets have a `queue_name` field defaulting to `default`. Workers only pick up tickets with matching queue names.

---

## Production deployment

### 1. Environment

Create `.env` (gitignored) with strong credentials:

```bash
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
API_USER=admin
API_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
OPENCLAW_GATEWAY_URL=ws://host.docker.internal:18789
OPENCLAW_GATEWAY_TOKEN=your-token-here
```

### 2. Start the production stack

Only the PostgreSQL database runs in Docker. All other services run as native host daemons managed by `mc-services`:

```bash
# Start DB
docker compose up -d db db-init

# Build + start all host services
npm run build
mc-services start
```

The dev `docker-compose.yml` already exposes port 5432. In production, remove that port mapping or use the production override:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d db db-init
```

The production override removes the host port binding for Postgres.

### 3. Reverse proxy with TLS

Put the Next.js app (port 3000) behind Nginx or Traefik with TLS termination and Basic Auth:

```nginx
upstream mission_control {
  server 127.0.0.1:3000;
}

server {
  listen 443 ssl http2;
  server_name dashboard.example.com;

  ssl_certificate /etc/letsencrypt/...;
  ssl_certificate_key /etc/letsencrypt/...;

  # Basic Auth (use API_USER/API_PASS)
  auth_basic "Restricted";
  auth_basic_user_file /etc/nginx/.htpasswd;

  location / {
    proxy_pass http://mission_control;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

### 4. Backups

```bash
docker run --rm \
  -v mission-control_pgdata:/data \
  -v /backups:/backup \
  alpine \
  tar czf /backup/pgdata-$(date +%F).tar.gz -C /data .
```

### 5. Security checklist

- [ ] `POSTGRES_PASSWORD` is strong (>20 chars, random)
- [ ] `API_USER`/`API_PASS` set (not left as defaults)
- [ ] Postgres port 5432 **not** published to the host (prod compose removes this)
- [ ] All containers run as non-root (`user: "nodejs"` in compose)
- [ ] TLS enabled on the reverse proxy
- [ ] `.env` gitignored; backups encrypted at rest
- [ ] `gateway.bind` set to `"lan"` or `"auto"` in host `openclaw.json` so containers can reach it
- [ ] Docker log rotation configured (`log-opts`)

### 6. Updating production

```bash
git pull
./scripts/update.sh
```

---

## Troubleshooting

### DB connection refused (127.0.0.1:5432)

**Cause**: DB container not exposing port to host.  
**Fix**: Ensure `db` service has `ports: ["5432:5432"]` in `docker-compose.yml`, then `docker compose down && docker compose up -d`.

### Password auth failed for "openclaw"

**Cause**: `.env.local` password doesn't match container's `POSTGRES_PASSWORD`.  
**Fix**: Sync them in `.env.local`:
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
# If permission denied:
chmod 666 .runtime/bridge-logger/bridge-logger.lock
mc-services restart bridge-logger
```

### Worker can't connect to gateway

**Cause**: Gateway not reachable from the host.  
**Fix**:
- Ensure the gateway is bound to `0.0.0.0` (not `127.0.0.1` only): set `"gateway.bind": "lan"` in `openclaw.json` and run `openclaw gateway restart`
- If the worker runs on a different host than the gateway, set `OPENCLAW_GATEWAY_URL` in `.env` to the gateway's LAN address (e.g. `ws://192.168.1.x:18789`)
- Verify `ss -tlnp | grep 18789` shows `0.0.0.0:18789` or the expected LAN interface

### Agent plugin not found (memory-qdrant)

**Cause**: Incorrect `sourcePath` in `openclaw.json` or bad permissions.  
**Fix**:
1. Ensure `plugins.installs.memory-qdrant.sourcePath = "extensions/memory-qdrant"`
2. `chmod -R 755 ~/.openclaw/extensions/memory-qdrant`
3. Remove stale `memory-lancedb` from `plugins.entries`
4. Restart `task-worker` with `mc-services restart task-worker`

### Hydration mismatch (React)

**Cause**: Server/client date formatting differed.  
**Fix**: All dates now use UTC explicitly in both server and client. Hard refresh browser.

---

## Changelog

### v1.0.0 — 2026-03-24

**Architecture and core systems**

- Complete architecture documented and consolidated into single README
- PostgreSQL as single source of truth for all entities (tickets, boards, agents, logs, activity)
- Event-driven real-time updates via Postgres `LISTEN/NOTIFY` + SSE
- Docker-based stack with five services: app, db, bridge-logger, task-worker, gateway-sync
- Non-root containers, read-only host mounts for `~/.openclaw`, Basic Auth on all API routes
- Health endpoint (`/health`) with DB probe

**Boards and Kanban**

- Full Kanban board with Kanban, List, and Grid view modes
- Board CRUD, column CRUD, drag-and-drop ticket reordering
- Ticket detail modal with subtasks, comments, attachments, activity log
- Execution modes: `direct` (immediate) and `planned` (plan → approve → execute)
- Ticket assignment to static assignees (name list) and/or OpenClaw agents
- `auto_approve` flag for time-scheduled tickets
- Real-time board sync via SSE — ticket moves and activity feed updates without page reload

**Ticket execution worker**

- Event-driven ticket picking via `pg_notify('ticket_ready')` + periodic polling fallback
- `SELECT ... FOR UPDATE SKIP LOCKED` for safe concurrent ticket claiming
- `maxConcurrency` limit enforced; configurable via API
- Telegram session continuity — agent replies delivered to the originating chat
- `queue_name` field for multi-queue worker isolation
- `approvePlan` / `rejectPlan` actions with state transitions
- Auto-approve promotion of `auto_approve=true` tickets on each worker tick

**Agent logs and observability**

- Bridge-logger tails session JSONL files + gateway log files
- Deduplication within 30-second window; dead-letter file + replay on DB insert failure
- Agent status page with model, queue depth, last heartbeat, responses/memory ops per hour
- Live log explorer with SSE streaming, pagination, level/type/agent filters
- Runtime snapshot collection via `openclaw sessions --all-agents --json`

**Scripts and DevX**

- `scripts/install.sh` — one-time setup: git clone, env generation, Docker build, schema init
- `scripts/update.sh` — git pull + Docker rebuild + service restart
- `npm run dev` — unified start (all Docker services + Next.js hot-reload)
- `gateway-sync.mjs` — imports openclaw sessions and agents into DB on startup

**Known limitations**

- Activity chart component is a placeholder (ready to wire up with a time-series query)
- Agent debug overlay requires `NEXT_PUBLIC_AGENT_DEBUG_OVERLAY=true` env var to show
- Prometheus/metrics exporter not yet implemented
- Request tracing (`X-Request-ID`) not yet implemented

---

## License & Support

Mission Control is part of the OpenClaw project. See the [main repository](https://github.com/claw-arsenal/mission-control) for license and community support.
