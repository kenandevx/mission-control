# OpenClaw Mission Control v1.2.1

Local-first dashboard for OpenClaw — boards, agent scheduling, real-time logs, and execution management.

## Quick Start

```bash
# 1. Install (clone + DB + build)
bash scripts/install.sh

# 2. Development
npm run dev            # Start DB + all services + Next.js dev server
npm run dev:stop       # Stop DB + services (graceful)
npm run dev:kill       # Force-kill everything (zombie processes, stuck ports)

# 3. Production
npm run build
bash scripts/mc-services.sh start    # Starts all services including Next.js
```

Open **http://localhost:3000**

## Requirements

| Dependency | Version |
|---|---|
| Node.js | 24+ |
| Docker + Compose v2 | For PostgreSQL |
| Redis | For BullMQ job queues (runs on host or Docker) |
| OpenClaw | Installed with gateway running |

## npm Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts Docker DB + all host services + `next dev` |
| `npm run dev:stop` | Graceful stop of Docker DB + host services |
| `npm run dev:kill` | **Force-kill** all MC processes, free port 3000 |
| `npm run dev:db` | Start only Docker DB containers |
| `npm run dev:services` | Start only host services (no Next.js dev) |
| `npm run build` | Production Next.js build |
| `npm start` | Start Next.js production server only |
| `npm run db:setup` | Run DB migrations + seed |
| `npm run db:reset` | Wipe and recreate DB schema |
| `npm run db:migrate` | Run pending migrations |
| `npm run worker:tasks` | Run task-worker standalone |
| `npm run bridge:logger` | Run bridge-logger standalone |

## Pages

| Page | What it does |
|---|---|
| `/dashboard` | Stats overview — boards, tickets, events, processes, logs |
| `/boards` | Kanban boards with drag-and-drop, live activity feed, ticket modals |
| `/agenda` | Calendar scheduler — one-time or recurring agent tasks |
| `/processes` | Reusable step-by-step execution blueprints |
| `/agents` | Agent status cards with model, heartbeat, detail pages |
| `/logs` | Live log explorer with SSE streaming and filters |
| `/approvals` | Pending plan approval queue |
| `/settings` | Theme, system updates, clean reset, uninstall |

## Architecture

```
Browser (SSE) ──→ Next.js (port 3000) ──→ PostgreSQL (Docker, port 5432)
                       ↕                        ↕
                  API Routes ←──→ pg_notify ←──→ Workers (host)
                                                    ↕
                                             OpenClaw Gateway (ws://127.0.0.1:18789)
                                                    ↕
                                             Agent Sessions (~/.openclaw/agents/)
```

### Host Services

All services run natively on the host, managed by `scripts/mc-services.sh`. Docker only runs PostgreSQL.

| Service | Script | Purpose |
|---|---|---|
| **task-worker** | `task-worker.mjs` | BullMQ worker — picks up queued tickets, runs agents, auto-attaches output files |
| **bridge-logger** | `bridge-logger.mjs` | Watches OpenClaw gateway websocket, ingests agent logs → DB, auto-discovers agents |
| **gateway-sync** | `gateway-sync.mjs` | One-shot: imports agents + sessions from gateway on startup, then exits |
| **agenda-scheduler** | `agenda-scheduler.mjs` | Expands RRULE occurrences, enqueues due agenda jobs |
| **agenda-worker** | `agenda-worker.mjs` | Executes scheduled agenda jobs, captures file artifacts to `/storage/mission-control/artifacts/` |
| **nextjs** | `npm start` | Production Next.js server (skipped with `--dev` flag) |

```bash
bash scripts/mc-services.sh status    # Check what's running
bash scripts/mc-services.sh start     # Start all services
bash scripts/mc-services.sh stop      # Stop all services
bash scripts/mc-services.sh restart   # Restart all
```

### Agent Discovery

Agents appear in Mission Control through two paths:
1. **gateway-sync** — imports all agents from the OpenClaw gateway on startup
2. **bridge-logger** — creates agents on-the-fly when it sees new log entries from unknown agents

Agent data (name, model, emoji, status) is read from each agent's `IDENTITY.md` file in `~/.openclaw/agents/<id>/`.

### Telegram Notifications

The task-worker sends Telegram notifications for ticket lifecycle events (start, completion, failure, retry). It discovers the user's Telegram chat ID from OpenClaw's session files at `~/.openclaw/agents/main/sessions/sessions.json` — no manual config needed.

## Key Features

### Boards (Trello-style)
- Kanban / List / Grid views with drag-and-drop
- Two-column ticket modal: main content (title, description, checklist, attachments, comments, activity) + sidebar (agent, processes, priority, due date, labels, execution controls)
- Assign OpenClaw agents for automated execution
- Attach reusable processes (step-by-step blueprints)
- Live activity feed with color-coded entries and relative timestamps
- Agent output rendered as markdown in the Activity section
- **File auto-attach**: agent-created files referenced in responses are auto-detected and attached as downloadable files
- Execution modes: Direct (immediate) or Planned (plan → approve/reject → execute)
- Retry with backoff (30s / 120s / 480s, up to 3 attempts)

### Agenda (Calendar Scheduler)
- Month / Week / Day views with event pills
- Multi-step creation wizard: Type → Details → Schedule → Review
- One-time (date + time) or Repeatable (daily/weekly with RRULE)
- Free prompt and/or attached processes per event
- Agent + model override per event
- **Output tab**: view agent responses with markdown rendering per run step
- **Artifact capture**: agent-generated files saved to disk and downloadable from event details
- **Cumulative step context**: each process step receives previous step outputs
- Recurring edit scope: "Only this occurrence" or "This and all upcoming"
- Stale lock recovery (occurrences stuck >15min auto-reset)

### Processes
- Card grid layout with create, edit, duplicate, delete
- Multi-step editor wizard: Info → Steps → Review
- Per-step: instruction, skill, agent, model override
- Version tracking with labels
- Clicking a process card opens edit with existing data pre-filled

### Agents
- Status cards with gradient accents, emoji avatars, pulse indicators
- Stat cards: Total agents, Running, Responses (1h), Memory ops (1h)
- Agent detail pages with full log history (`/agents/[agentId]`)

### Settings
- Theme: Light / Dark / System
- System Updates: check for git updates, one-click update
- Danger Zone: Clean Reset (type "RESET") and Uninstall (type "UNINSTALL")

## Ticket Lifecycle

```
open → [start] → queued → executing → done
open → [planned] → planning → awaiting_approval → [approve] → queued → executing → done
                                                 → [reject] → draft
failed → [retry] → queued (up to 3x with backoff)
```

No agent assigned = manual ticket (never auto-queued).

## File Serving

Agent-created files are served via `/api/files?path=<absolute-path>`. Allowed directories:
- `/home/clawdbot/.openclaw/workspace`
- `/home/clawdbot/.openclaw`
- `/storage`
- `/tmp`

Agenda artifacts are served via `/api/agenda/artifacts/[stepId]/[filename]`.

## Environment

Key env vars in `.env`:

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `POSTGRES_PASSWORD` | DB password (used by Docker) | Required |
| `REDIS_HOST` | Redis host | `127.0.0.1` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password | none |

OpenClaw config is auto-discovered from `~/.openclaw/openclaw.json`. No OpenClaw-specific env vars needed.

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/tasks` | POST | Board/ticket CRUD, execution, attachments, activity |
| `/api/files` | GET | Serve local files by path (for ticket attachments) |
| `/api/agenda/events` | GET/POST | Agenda event CRUD |
| `/api/agenda/events/[id]` | GET/PATCH/DELETE | Single event operations |
| `/api/agenda/events/[id]/occurrences/[occId]/runs` | GET | Run attempts + steps for an occurrence |
| `/api/agenda/artifacts/[stepId]/[filename]` | GET | Download agent-generated artifacts |
| `/api/processes` | GET/POST | Process CRUD |
| `/api/processes/[id]` | GET/PATCH/DELETE | Single process operations |
| `/api/agents` | GET | Agent discovery (reads from DB + runtime) |
| `/api/skills` | GET | Workspace skills list |
| `/api/system` | POST | System management (update, reset, uninstall) |
| `/api/events` | GET | SSE stream (ticket activity, worker ticks) |
| `/api/agent/logs/stream` | GET | SSE stream (agent logs) |

## Scripts Reference

| Script | Purpose |
|---|---|
| `scripts/mc-services.sh` | Service supervisor — start/stop/restart/status for all host daemons |
| `scripts/install.sh` | Full install: clone, .env setup, Docker DB, npm install, build |
| `scripts/clean.sh` | Wipe DB + Docker volumes, rebuild from scratch |
| `scripts/uninstall.sh` | Stop everything, remove Docker volumes, remove project |
| `scripts/dev.sh` | Dev mode with Ctrl+C trap cleanup |
| `scripts/db-init.sh` | Run by Docker db-init container to apply schema |
| `scripts/db-setup.mjs` | DB migrations, seed, reset commands |
| `scripts/gateway-sync.mjs` | One-shot gateway import |
| `scripts/bridge-logger.mjs` | Persistent log ingestion daemon |
| `scripts/task-worker.mjs` | BullMQ ticket execution worker |
| `scripts/agenda-scheduler.mjs` | RRULE expansion + job enqueue |
| `scripts/agenda-worker.mjs` | Agenda job execution + artifact capture |

## Troubleshooting

| Issue | Fix |
|---|---|
| Port 3000 stuck after closing terminal | `npm run dev:kill` |
| DB connection refused | `docker compose up -d db` or `npm run dev:db` |
| Password auth failed | Check `POSTGRES_PASSWORD` in `.env` matches `DATABASE_URL` |
| Agents not showing | Ensure OpenClaw gateway is running; try hard refresh |
| Worker can't reach gateway | Set `gateway.bind: "lan"` in `openclaw.json` |
| Agenda output tab crashes | Fixed in v1.2.1 — `output_payload` jsonb handling |
| Ticket file attachments missing | Worker auto-attaches files from agent response (v1.2.1+) |
| Zombie processes after Ctrl+C | `npm run dev:kill` cleans up everything |

## Database

Schema managed by `scripts/db-init.sh` (Docker) and `scripts/db-setup.mjs` (Node).

Key tables: `workspaces`, `boards`, `columns`, `tickets`, `ticket_attachments`, `ticket_subtasks`, `ticket_comments`, `ticket_activity`, `agents`, `agent_logs`, `agenda_events`, `agenda_occurrences`, `agenda_run_attempts`, `agenda_run_steps`, `processes`, `process_versions`, `process_steps`, `worker_settings`.

Reset everything: `npm run db:reset` or `bash scripts/clean.sh`.

## License

Part of the [OpenClaw](https://github.com/openclaw/openclaw) project.
