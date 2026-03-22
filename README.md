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

---

## 3) Runtime modes

## A) Docker packaged mode
Uses `docker-compose.yml` and runs:
- `db` (Postgres)
- `db-init` (schema + seed initializer)
- `app` (Next.js production)
- `bridge-logger` (continuous log ingestion)

## B) Local dev mode
Uses `scripts/dev.sh` for faster frontend iteration.
Typically:
- starts DB-only services
- runs Next dev server locally

---

## 4) Logs architecture (important)

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
- stream is backed by Postgres `LISTEN/NOTIFY`
- details modal shows full uncensored payload
- preview is intentionally humanized/summarized

---

## 5) Environment variables

Core DB:
- `DATABASE_URL`
- `OPENCLAW_DATABASE_URL` (fallback for tooling)

Gateway (optional enhancement paths):
- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `OPENCLAW_GW_TOKEN`
- `OPENCLAW_GATEWAY_API_TOKEN`

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
- README reflects current scripts/routes

---

## 14) Current operational stance

Mission Control is now positioned as:
- local-first runtime dashboard
- DB-backed observability surface
- live agent/event log explorer
- easy install/update via scripts

If architecture changes, update this README in the same PR so onboarding never drifts.
