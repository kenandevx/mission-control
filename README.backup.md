# Mission Control

Mission Control is a **local-first OpenClaw dashboard** for agents, logs, boards, runtime visibility, and operational tooling.

This README is the canonical operator + developer guide for:
- installation
- update workflow
- runtime architecture
- folder/file map
- logs pipeline behavior
- day-2 maintenance

---

## 1) What this project is

Mission Control provides:
- Dashboard UI (Next.js App Router)
- Local PostgreSQL persistence
- Runtime ingestion from local OpenClaw sessions/gateway logs
- Live logs feed (SSR first load + SSE updates)
- Dockerized packaged stack + local dev mode

Design goals:
- **Local-first**
- **No hidden cloud dependency for core operation**
- **Operationally simple install/update scripts**
- **Readable logs and auditable details**

---

## 2) Quick start

### Fresh install (recommended)
```bash
cd /home/clawdbot/.openclaw/workspace/mission-control
./scripts/install.sh
```

Open:
- http://localhost:3000/dashboard
- http://localhost:3000/logs

### Update existing install
```bash
cd /home/clawdbot/.openclaw/workspace/mission-control
./scripts/update.sh
```

### Fast local development
```bash
cd /home/clawdbot/.openclaw/workspace/mission-control
npm install
./scripts/dev.sh
```

### Full local dev (DB + worker + UI)
```bash
npm run dev:full
```
This starts the DB (Docker), the task-worker, and the Next.js dev server. The worker runs on your host so it can access your locally installed OpenClaw plugins (e.g., custom memory backends). Use this mode when developing agent integrations or debugging ticket execution.

---

## 3) Runtime modes

### A) Docker packaged mode
Uses `docker-compose.yml` and runs:
- `db` (Postgres)
- `db-init` (schema + seed initializer)
- `app` (Next.js production)
- `bridge-logger` (continuous log ingestion)
- `task-worker` (ticket execution worker)
- `gateway-sync` (optional metadata import)

### B) Local dev mode
Uses `scripts/dev.sh` for faster frontend iteration.
Typically:
- starts DB-only services
- runs Next dev server locally

### C) Full local dev with worker
```bash
npm run dev:full
```
Starts DB (via docker-compose.dev.yml), the task-worker, and the Next dev server. All worker processes run on your host with access to your OpenClaw plugins.

---

## 4) Security hardening (production)

### HTTP Basic Auth on API routes
All `/api/*` endpoints require authentication when `API_USER` and `API_PASS` are set.
- Set these in `.env.local` (dev) or the container environment (prod).
- If not set, the API remains open (dev convenience).

Example credentials (generate your own strong values):
```
API_USER=5i3039
API_PASS=NScL0R0C5j8s
```

### Database isolation
- The DB port (5432) is **not published** to the host in the packaged compose file.
- Containers communicate over the internal Docker bridge network.
- Set a strong `POSTGRES_PASSWORD` environment variable; never use the default `openclaw` in production.

### File mounts
`~/.openclaw` is mounted read-only (`:ro`) into `task-worker` and `bridge-logger` containers. This prevents the containers from modifying your host OpenClaw configuration.

### Reverse proxy (recommended for external access)
If exposing the dashboard beyond localhost, put it behind a reverse proxy (Nginx/Traefik) with TLS and optionally IP allowlisting. The Basic Auth provides a second layer.

See `SECURITY.md` for a complete checklist.

---

## 5) Task execution (worker) architecture

Mission Control includes a robust ticket execution worker, similar to Laravel queues.

### Worker lifecycle
- Polls the DB every `worker_settings.poll_interval_seconds` (default 20s).
- Claims eligible tickets in batches up to `worker_settings.max_concurrency` (default 3).
- Updates ticket states through `queued -> picked_up -> executing -> done` (or `failed`).
- Auto-moves successfully completed tickets to a **Completed/Done** column if present on the board.

### Eligibility rules
A ticket is pickup-eligible when:
- It is in an **In progress** (or legacy **Doing**) column.
- `execution_state` is `queued` or `ready_to_execute`.
- `assigned_agent_id` is set to a valid runtime agent ID (e.g., `main`).
- `scheduled_for` is either null or in the past.

### Auto-approve
If a ticket is in **To-Do** with `auto_approve = true` and schedule conditions met, the worker automatically moves it to **In progress** and sets `execution_state = queued`.

### Worker settings (singleton row `worker_settings` with `id=1`)
- `enabled` (boolean)
- `poll_interval_seconds` (5..300, default 20)
- `max_concurrency` (1..20, default 3)

You can update these via `/api/tasks` actions:
```json
{ "action": "updateWorkerSettings", "maxConcurrency": 5 }
```

### Starting the worker
Locally:
```bash
DATABASE_URL=postgresql://openclaw:openclaw@localhost:5432/mission_control \
OPENCLAW_DATABASE_URL=$DATABASE_URL \
npm run worker:tasks
```
In Docker compose: the `task-worker` service runs automatically.

---

## 6) Logs architecture (important)

Logs are designed as one unified feed.

### Sources
- OpenClaw session JSONL streams (`~/.openclaw/agents/**/sessions/*.jsonl`)
- Gateway log files (`/tmp/openclaw/openclaw-*.log`)
- API inserts for app/runtime events

### Ingestion
`scripts/bridge-logger.mjs`:
- tails source files continuously
- classifies events (`chat.*`, `tool.*`, `memory.*`, `system.*`, `heartbeat.*`)
- writes to `agent_logs`
- issues `pg_notify('agent_logs', <id>)` for live delivery
- auto-reconnects DB on connection loss
- uses dedupe + lock file to prevent duplicate ingestion from multi-process starts

### UI delivery path
- `/logs` initial rows are loaded via **SSR**
- live updates are streamed via **SSE** from `/api/agent/logs/stream`
- worker tick updates are streamed via **SSE** from `/api/events` (includes `worker_tick` and `ticket_activity`)
- stream is backed by Postgres `LISTEN/NOTIFY`
- details modal shows full uncensored payload
- preview is intentionally humanized/summarized

---

## 7) API proxy (Basic Auth)

A lightweight HTTP Basic Auth is enforced on all `/api/*` routes when `API_USER` and `API_PASS` are set. Implementation uses the new `app/api/_proxy.ts` route group middleware (Next.js route segment convention). If credentials are not set, the API remains open (dev mode only). Always set these in production.

---

## 8) Environment variables

---

## 5) Taskboard execution architecture (queue worker)

Current behavior is now worker-driven (Laravel queue style), not UI-heartbeat-driven.

### Core model

- Ticket creation and updates are persisted in `tickets`
- Queue eligibility is based on DB state, not frontend timers
- Worker loop polls DB every `worker_settings.poll_interval_seconds` (default `20`)
- Worker claims multiple tickets per tick up to `worker_settings.max_concurrency`
- Claims are safe with SQL row locking (`FOR UPDATE SKIP LOCKED`)

### Eligibility rules (pickup)

A ticket is pickup-eligible when all are true:

- List is **In progress** (or legacy **Doing**)
- `execution_state` is `queued` or `ready_to_execute`
- `assigned_agent_id` is set
- `scheduled_for` is null or <= now

### Worker lifecycle

Per ticket, worker writes the flow:

`queued/ready_to_execute -> picked_up -> executing -> done`

If a **Completed/Done** list exists on the board, worker auto-moves ticket there at completion.

### Worker settings

Stored in `worker_settings` (singleton row, `id=1`):

- `enabled` (bool)
- `poll_interval_seconds` (5..300, default 20)
- `max_concurrency` (1..20, default 3)

### APIs

`/api/tasks` supports:

- `action=getWorkerSettings`
- `action=updateWorkerSettings`

### Run worker

Locally (dev):

```bash
npm run worker:tasks
```

Docker (packaged stack): The `task-worker` service runs automatically with `docker compose up -d`. It uses the same image and DB, and mounts your OpenClaw configuration for agent access.

Quick checks:

```bash
npm run worker:tasks:check
npm run test:worker
```

### Implementation plan (applied)

1. Replace fake heartbeat display with worker poll metadata in board UI
2. Introduce DB worker settings table with defaults
3. Add worker settings API read/update actions
4. Build task worker script with safe concurrent claiming and execution lifecycle updates
5. Add worker core unit tests and script checks

## 6) Environment variables

### Core DB
- `DATABASE_URL`
- `OPENCLAW_DATABASE_URL` (fallback for tooling)

### Gateway (optional)
- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `OPENCLAW_GW_TOKEN`
- `OPENCLAW_GATEWAY_API_TOKEN`

### Security (set in production)
- `POSTGRES_PASSWORD` — strong password for Postgres user `openclaw`
- `API_USER` — basic auth username for `/api/*`
- `API_PASS` — basic auth password for `/api/*`

Default local DB URL used in compose context:
```bash
postgresql://openclaw:openclaw@db:5432/mission_control
```

---

## 6) Directory and file map

## Root
- `README.md` — this guide
- `Dockerfile` — app image build/run
- `docker-compose.yml` — packaged services
- `docker-compose.dev.yml` — dev-oriented compose
- `package.json` — scripts/dependencies
- `package-lock.json` — npm lockfile
- `postcss.config.mjs` — CSS pipeline config

## App routes (`app/`)
- `app/dashboard/page.tsx` — dashboard
- `app/logs/page.tsx` — logs route (SSR entry)
- `app/agents/page.tsx` — agents list
- `app/agents/[agentId]/page.tsx` — agent detail
- `app/boards/page.tsx` — boards

- `app/login/page.tsx` — login surface
- `app/page.tsx` — root page
- `app/layout.tsx` — app shell
- `app/providers.tsx` — app providers

## API routes (`app/api/`)
- `app/api/agent/logs/route.ts` — logs query/insert/delete + pagination
- `app/api/agent/logs/stream/route.ts` — SSE stream (`LISTEN/NOTIFY`)
- `app/api/setup/route.ts` — setup state APIs
- `app/api/notifications/route.ts` — notifications config APIs
- `app/api/_proxy.ts` — Basic Auth middleware for all `/api/*` routes
- `app/api/events` — SSE events (`worker_tick`, `ticket_activity`)
- `app/api/tasks` — taskboard worker settings & actions

## Components (`components/`)
- `components/agents/logs-explorer.tsx` — logs table/filter/details UI
- `components/agents/logs-live-refresh.tsx` — stream connection badge
- `components/agents/logs-page-client.tsx` — post-SSR logs live behavior
- `components/dashboard/*` — dashboard blocks, setup modal
- `components/tasks/*` — board/task UX
- `components/ui/*` — UI primitives (table/select/dialog/etc)

## Data/runtime libraries (`lib/`)
- `lib/local-db.ts` — Postgres client helper
- `lib/db/index.ts` — DB abstractions
- `lib/db/server-data.ts` — server loaders for pages
- `lib/runtime/collector.ts` — runtime collection/merge hooks
- `lib/runtime/types.ts` — runtime types

## Scripts (`scripts/`)
- `scripts/install.sh` — install/bootstrap flow
- `scripts/update.sh` — update/rebuild flow
- `scripts/dev.sh` — local dev boot flow
- `scripts/bridge-logger.mjs` — log ingestion daemon
- `scripts/db-setup.mjs` — DB setup helper
- `scripts/gateway-sync.mjs` — gateway/session sync helper
- `scripts/uninstall.sh` — teardown helper

## Database (`db/`)
- `db/schema.sql` — schema DDL
- `db/seed.sql` — initial seed data

## Runtime state (generated)
- `.runtime/bridge-logger/offsets.json`
- `.runtime/bridge-logger/dead-letter.jsonl`
- `.runtime/bridge-logger/bridge-logger.lock`

---

## 7) Install workflow (what happens)

`./scripts/install.sh` should:
1. validate Docker/compose availability
2. ensure env scaffolding exists
3. build/start services via compose
4. initialize DB (schema + seed)
5. start app + bridge logger services
6. leave stack running in background

---

## 8) Update workflow (what happens)

`./scripts/update.sh` should:
1. pull latest repository changes
2. rebuild/restart compose services
3. keep DB data volume intact unless explicitly reset
4. bring up latest app and bridge logger code

---

## 9) Logging behavior expectations

Good logs UX should provide:
- clear event labels (human + raw event key)
- readable preview line for each row
- full uncensored details payload in modal
- channel/source attribution (`telegram`, `gateway`, `internal`, `qdrant`)
- severity (`debug`, `info`, `warning`, `error`)
- agent attribution (name/id)
- pagination and filtering
- live updates without manual refresh loops

If logs look duplicated, check:
- only one bridge logger process running
- lock file behavior in `.runtime/bridge-logger/`
- dedupe guard in ingestion path

---

## 10) Common commands

### Status
```bash
docker compose ps
```

### Tail logs
```bash
docker compose logs -f app

docker compose logs -f bridge-logger
```

### Restart stack
```bash
docker compose down
docker compose up -d --build
```

### Hard rebuild (cache bust)
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Start bridge logger manually (non-docker)
```bash
npm run bridge:logger
```

### Check bridge script syntax
```bash
npm run bridge:logger:check
```

### Security: set strong DB password (production)
In `docker-compose.yml`, the DB uses `POSTGRES_PASSWORD` from the environment.
Set it in your shell or `.env` file before starting the stack:
```bash
export POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c24)
```
Then rebuild/restart:
```bash
docker compose build
docker compose up -d
```

### Security: enable API Basic Auth
Create or edit `.env.local` with:
```
API_USER=youruser
API_PASS=yourstrongpass
```
The middleware protects all `/api/*` routes. Test:
```bash
curl -u youruser:yourstrongpass http://localhost:3000/api/tasks
```
Without `-u`, you should get `401`.

---

## 11) Git workflow notes

---

## 11) Git workflow notes

If commit fails with unknown author:
```bash
git config user.name "<your-name>"
git config user.email "<your-email>"
```

For SSH push auth, generate/add a key and set `origin` to SSH URL.

---

## 12) Troubleshooting

### Logs page not updating live
- verify `/api/agent/logs/stream` is connected
- verify `pg_notify` is triggered on inserts
- verify browser EventSource not blocked

### Logs preview too noisy
- expected: preview is summarized
- details modal remains raw/full
- adjust parsing in `components/agents/logs-explorer.tsx`

### DB connection ended errors
- bridge logger includes auto-reconnect logic
- check DB container health and restart if needed

### Duplicate logs
- ensure single bridge logger process
- inspect `.runtime/bridge-logger/bridge-logger.lock`

---

## 13) Team handoff checklist

Before handing this repo to teammates, verify:
- `./scripts/install.sh` works on clean environment
- `./scripts/update.sh` works without manual steps
- `/logs` SSR + live stream both work
- bridge logger service starts automatically in compose
- `task-worker` is running and ticking
- API Basic Auth works when `API_USER`/`API_PASS` set
- DB uses a strong `POSTGRES_PASSWORD`
- README reflects current scripts/routes and security steps

---

## 14) Current operational stance

Mission Control is now positioned as:
- local-first runtime dashboard
- DB-backed observability surface
- live agent/event log explorer
- easy install/update via scripts

If architecture changes, update this README in the same PR so onboarding never drifts.

---

## 5) Security & Production Hardening

### Basic Auth
All `/api/*` endpoints require HTTP Basic Auth when `API_USER` and `API_PASS` are set.
- Set these in `.env.local` (dev) or the container environment (prod).
- If not set, the API remains open (dev convenience). **Always set in production.**
Example:
```
API_USER=5i3039
API_PASS=NScL0R0C5j8s
```

### Database
- Do **not** publish Postgres port `5432` to the host in production. Containers talk over the Docker network.
- Set a strong `POSTGRES_PASSWORD` via environment variable in `docker-compose.yml`.
- The DB is only reachable from within the Docker network (bridge).

### File mounts
- `~/.openclaw` is mounted read-only into `task-worker` and `bridge-logger` containers. Host files cannot be modified from the container.

### TLS & Network
- If exposing the dashboard beyond localhost, put a reverse proxy (Nginx/Traefik) in front with TLS termination.
- Ensure `gateway.bind` is set to `"lan"` or `"auto"` (not `"loopback"`) for container access.

### Secrets Management
- Never commit `.env` or `.env.local`. They are gitignored.
- In production, use a secrets manager (e.g., Docker secrets, HashiCorp Vault) instead of env files.

### User & Container Isolation
- Run containers as non-root users where possible.
- The `task-worker` and `bridge-logger` must access `~/.openclaw`; ensure directory permissions are `755` and files are `644`.
- The OpenClaw plugin directory must be owned by the same UID/GID as the container user to avoid "suspicious ownership" blocks.

### Backups
- Backup the Postgres volume regularly:
  ```bash
  docker run --rm -v mission-control_pgdata:/data -v /path/to/backup:/backup alpine \
    tar czf /backup/pgdata-$(date +%F).tar.gz -C /data .
  ```

---

## 6) Troubleshooting & Common Issues

### a) Database connection errors (ECONNREFUSED 127.0.0.1:5432)
**Cause**: The `db` service in Docker does not expose port 5432 to the host. The Next.js dev server runs on the host and needs to connect to the database.

**Fix**: In `docker-compose.yml`, ensure the `db` service has:
```yaml
ports:
  - "5432:5432"
```
Then restart the stack: `docker compose down && docker compose up -d`.

### b) Password authentication failed for user "openclaw"
**Cause**: The `.env.local` `DATABASE_URL` and `OPENCLAW_DATABASE_URL` passwords don't match the `POSTGRES_PASSWORD` used by the `db` container (from `.env`).

**Fix**: Sync the passwords. In `.env.local`, set:
```
DATABASE_URL=postgresql://openclaw:${POSTGRES_PASSWORD}@localhost:5432/mission_control
OPENCLAW_DATABASE_URL=postgresql://openclaw:${POSTGRES_PASSWORD}@localhost:5432/mission_control
```
Replace `${POSTGRES_PASSWORD}` with the actual value from `.env`.

### c) Bridge logger: "Unable to add filesystem: <illegal path>"
**Cause**: Using `fs.watch` on certain mounted volumes (e.g., Docker bind mounts) can produce this error.

**Fix**: In `scripts/bridge-logger.mjs`, the watcher was switched to `fs.watchFile` (polling-based) which is more compatible. Ensure you are on the latest code.

### d) Board activity polling replaced with real-time socket
The boards page no longer polls `/api/tasks` for activity. It uses Server-Sent Events (SSE) from `/api/events` for instant updates. No configuration needed; it works automatically.

### e) Ticket moves and status changes: real-time updates
When a ticket is moved (drag-drop) or its status changes (via UI or worker), the board automatically refreshes to reflect the new positions. This uses the same SSE stream: the `ticket_activity` event triggers a board reload. Chips should move instantly without manual refresh.

### f) Agent execution failed: plugin not found (memory-qdrant)
**Cause**: The OpenClaw config (`openclaw.json`) had an incorrect plugin install record (`sourcePath: extensions/memory-qdrant.preprov`) causing the plugin to not be recognized. Additionally, the plugin directory had restrictive permissions.

**Fixes**:
1. Update `plugins.installs.memory-qdrant.sourcePath` to `extensions/memory-qdrant` (no `.preprov`).
2. Ensure the plugin directory is readable by the container (chmod 755, chown root if needed).
3. Remove stale entries like `memory-lancedb` from `plugins.entries`.
4. Restart the `task-worker` container.

### g) Task worker: read-only filesystem error
**Cause**: The `task-worker` volume was mounted as `:ro`, preventing agents from writing session files.

**Fix**: In `docker-compose.yml`, remove `:ro` from the `task-worker` volumes mount:
```yaml
volumes:
  - ~/.openclaw:/root/.openclaw   # not :ro
```
Then recreate the container: `docker compose down task-worker && docker compose up -d task-worker`.

### h) Gateway connection errors (worker cannot connect to gateway)
**Cause**: The `task-worker` container uses `ws://127.0.0.1:18789` which points to the container itself, not the host gateway. Also, the gateway was bound to `loopback` only.

**Fixes**:
- Set `OPENCLAW_GATEWAY_URL=ws://host.docker.internal:18789` for the `task-worker` and add `extra_hosts: - "host.docker.internal:host-gateway"` in `docker-compose.yml`.
- Change `gateway.bind` in `openclaw.json` to `"lan"` (or `"auto"`), then restart the gateway: `openclaw gateway restart`.
- Verify gateway listens on `0.0.0.0:18789` (not just 127.0.0.1).

### i) Hydration mismatch (React hydration error about different text)
**Cause**: Dates formatted on server vs. client used different timezones/locales.

**Fix**: All dates are now formatted with UTC explicitly to ensure consistency:
```ts
new Date(dateStr).toLocaleDateString("en-US", { timeZone: "UTC" })
```
Applies to board created/updated/last activity columns and activity timestamps.

---

## 7) Real-time features overview

- **Live logs feed**: Uses SSE (`/api/events`) to stream agent logs and system events.
- **Board activity**: Real-time via SSE; no polling.
- **Ticket updates**: When any ticket is moved, edited, or status-changed, the board automatically reloads to reflect changes instantly.
- **Worker status**: `worker_tick` SSE events keep the poll interval indicator up to date.

---

## 8) Filemap

(Keep existing filemap content from the original README)
