# OpenClaw Mission Control v2.7

Local-first dashboard for OpenClaw — agenda scheduling, processes, boards, and real-time logs.

---

## Changelog

### v2.7 (2026-04-03)
- Fix `cron.add INVALID_REQUEST` when scheduled time is already past — now uses `--at 30s` for immediate execution
- Fix: when cron job creation fails, occurrence is now correctly set to `needs_retry` (was silently abandoned)
- Fix: event status styling on calendar — `run_started_at`/`run_finished_at` now included in all event list queries

### v2.6 (2026-04-03)
- Rewrote agenda test suite — 15 clean focused tests, CET timezone, no mocks

### v2.5 (2026-04-03)
- Fix artifact directory creation — no longer created eagerly, only when agent actually writes files
- Artifact files (images, PDFs, etc.) now correctly displayed in Output tab with download links and image previews

### v2.4 (2026-04-03)
- Fix Output tab was empty after successful cron runs — `agenda_run_steps` now populated by scheduler
- Fix manual retry used bare prompt — now uses stored `rendered_prompt` (includes process steps)
- Settings "Max attempts before fallback" is now wired to actual fallback trigger logic
- `rendered_prompt` column added to `agenda_occurrences` for retry accuracy

### v2.3 (2026-04-03)
- Remove Job Queues tab (BullMQ UI removed)
- Remove dead Concurrency + Execution Window settings (cron handles natively)
- Fix all stale "worker" references across tests, settings, and UI components

### v2.2 (2026-04-03)
- Fix watchdog environment sourcing — restarted services now have DATABASE_URL available

### v2.1 (2026-04-03)
- Remove BullMQ/Redis from all remaining files (routes, types, UI, install script)
- Remove `agenda-worker` from clean reset and service list
- `agenda-selfcheck` rewritten for cron engine

### v2.0 (2026-04-03)
**Major architecture change — BullMQ/Redis/agenda-worker replaced by OpenClaw cron engine**

- `agenda-worker.mjs` removed — execution now inside the OpenClaw gateway via `openclaw cron`
- `agenda-scheduler.mjs` rewritten — RRULE expansion → creates one-shot `openclaw cron` jobs
- Scheduler syncs cron run results back to Postgres for the UI
- Qdrant memory cleanup on failure via isolated session file parsing
- Fallback model retry via `openclaw cron edit` + `cron run`
- Gateway pairing fixed — CLI device approved in `devices/paired.json`
- `openclaw-config.mjs` — reads gateway token from `openclaw.json` directly
- Removed `OPENCLAW_GATEWAY_URL` / `OPENCLAW_GATEWAY_TOKEN` from `.env`
- Services reduced: 5 → 3 (gateway-sync, bridge-logger, agenda-scheduler, nextjs; no worker, no Redis)
- `db/schema.sql` updated with v2 cron columns

---

## Quick Start

```bash
# Install (clone + env + DB + build — everything in one command)
curl -fsSL https://raw.githubusercontent.com/kenandevx/mission-control/main/scripts/install.sh | bash

# Production
npm run build
bash scripts/mc-services.sh start

# Development
npm run dev
```

Open **http://localhost:3000**

---

## Requirements

| Dependency | Version | Notes |
|---|---|---|
| Node.js | 24+ | Required |
| Docker + Compose v2 | Any modern | PostgreSQL only |
| OpenClaw | 2026.4.x+ | Gateway must be running and paired |

> **Redis is no longer required.** Execution is handled natively by the OpenClaw cron engine (v2+).

---

## npm Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Docker DB + all host services + `next dev` |
| `npm run build` | Production Next.js build |
| `npm start` | Start Next.js production server |
| `npm run agenda:selfcheck` | Check cron engine health, schema, stuck occurrences |
| `npm run agenda:smoke` | End-to-end smoke test (create event, retry, verify state) |

---

## Pages

| Page | What it does |
|---|---|
| `/dashboard` | Stats overview — events, processes, agents, logs |
| `/agenda` | Calendar scheduler — one-time and recurring agent tasks |
| `/processes` | Reusable step-by-step execution blueprints |
| `/boards` | Kanban boards — manual ticket tracking |
| `/agents` | Agent status cards, detail pages, logs |
| `/logs` | Runtime logs + service management |
| `/file-manager` | File browser for `~/.openclaw/` |
| `/settings` | Theme, agenda settings, system updates, danger zone |

---

## Architecture

```
Browser (SSE) ──→ Next.js (port 3000) ──→ PostgreSQL (Docker, port 5432)
                       ↕                        ↕
                  API Routes ←──→ pg_notify ←──→ agenda-scheduler (host)
                                                    ↕
                                          OpenClaw Gateway (ws://127.0.0.1:18789)
                                                    ↕
                                          openclaw cron engine (inside gateway)
                                                    ↕
                                          Isolated agent sessions per run
```

### Host Services

All services run natively on the host, managed by `scripts/mc-services.sh`. Docker only runs PostgreSQL.

| Service | Script | Purpose |
|---|---|---|
| **agenda-scheduler** | `agenda-scheduler.mjs` | RRULE expansion → creates `openclaw cron` jobs, syncs results to DB |
| **bridge-logger** | `bridge-logger.mjs` | Watches OpenClaw gateway, ingests agent logs → DB |
| **gateway-sync** | `gateway-sync.mjs` | One-shot: imports agents + sessions from gateway on startup, then exits |
| **nextjs** | `npm start` | Production Next.js server |

```bash
bash scripts/mc-services.sh status               # Check what's running
bash scripts/mc-services.sh start                # Start all services
bash scripts/mc-services.sh stop                 # Stop all services
bash scripts/mc-services.sh restart              # Restart all
bash scripts/mc-services.sh restart agenda-scheduler  # Restart single service
```

### Execution Engine

Agenda events are executed by the **OpenClaw cron engine** inside the gateway process. Mission Control does not spawn agent processes directly.

**Flow:**
1. User creates an event in the UI → saved to Postgres
2. `agenda-scheduler` expands RRULE → creates occurrence row → calls `openclaw cron add --at <time>`
3. OpenClaw cron fires at the right time → runs agent in an isolated session
4. `agenda-scheduler` polls `openclaw cron runs` → syncs result (summary, model, duration) back to Postgres
5. UI reads from Postgres — calendar updates via SSE

**Benefits over v1 (BullMQ):**
- Model override actually works (`--model` supported by cron)
- No stdout/stderr parsing — structured JSON result
- No gateway token issues — cron runs inside the gateway
- No Redis dependency
- Retry handled natively by cron (exponential backoff)
- Isolated sessions per run — no session pollution, no cleanup needed for main session

---

## Agenda Event Lifecycle

```
draft → [activate] → active
active → [scheduler cycle] → occurrence created (status: scheduled)
                           → cron job created (openclaw cron add --at <time>)
                           → occurrence status: queued (cron_job_id set)

queued → [cron fires] → agent runs in isolated session
       → [success] → scheduler syncs → status: succeeded ✅
                   → run_attempt + run_step written to DB (output visible in UI)
       → [failure] → cron retries automatically (exponential backoff)
                   → [all retries exhausted] → scheduler detects
                     → [fallback model set + not tried yet]
                       → openclaw cron edit <id> --model <fallback>
                       → openclaw cron run <id>
                       → [success] → status: succeeded ✅
                       → [failure] → Qdrant cleanup → status: needs_retry + Telegram alert
                     → [no fallback] → Qdrant cleanup → status: needs_retry + Telegram alert

needs_retry → [user clicks Retry] → cron run triggered → queued → ...
           → [user clicks Dismiss] → status: cancelled
           → [user edits + retries] → new cron job created → queued → ...

[cron job creation fails] → status: needs_retry (immediately, with reason logged)
```

### Occurrence Status Reference

| Status | Meaning |
|---|---|
| `scheduled` | Occurrence created, cron job not yet assigned |
| `queued` | Cron job created and assigned (`cron_job_id` set) |
| `running` | Cron job has fired and agent is executing (detected via poll) |
| `succeeded` | Run completed successfully, output synced to DB |
| `needs_retry` | All retries exhausted or cron job creation failed — user action required |
| `failed` | Terminal failure (rarely used directly; cron handles retries internally) |
| `cancelled` | Dismissed by user |

---

## Retry Flow

```
Cron fires → agent runs in isolated session
  ↓ success → done ✅

  ↓ failure → cron auto-retries (up to 3 times with backoff: 1min, 2min, 5min)
    ↓ all cron retries exhausted → scheduler detects finished+error

    ↓ [attempt count < max_attempts setting AND fallback model set]
      → retry once with fallback model via cron edit + run
      ↓ success → done ✅
      ↓ failure → Qdrant cleanup → needs_retry + Telegram alert

    ↓ [no fallback OR max_attempts reached]
      → Qdrant cleanup → needs_retry + Telegram alert
      → User: Retry / Edit / Delete in Mission Control
```

**Settings (configurable in /settings → Agenda):**

| Setting | Default | What it does |
|---|---|---|
| Max attempts before fallback | 1 | After this many failures, switch to the per-event fallback model |
| Default fallback model | — | Global fallback; per-event setting overrides this |
| Scheduling interval | 15 min | Time-slot grid (0 = free time, no enforcement) |
| Sidebar Activity Count | 8 | Recent entries shown in sidebar |

**Per-event settings (in event modal):**

| Setting | What it does |
|---|---|
| Fallback model | Model to use after primary retries exhausted |
| Agent | Which OpenClaw agent runs this event |
| Model override | Override agent's default model for this event |

---

## Failure Cleanup

When a cron run fails and all retries are exhausted, the scheduler cleans up side effects:

```
Phase 1: Qdrant Memory Cleanup
  → Read isolated session file for the failed cron run
  → Find memory_store tool result IDs
  → Delete those memory entries from Qdrant via REST API
  → Idempotent: safe to re-run

(Session truncation not needed — cron uses isolated sessions, not main session)
(File cleanup: agent is told to write to a specific artifact dir; if nothing there, nothing to clean)
```

**What gets cleaned:**

| Artifact | Cleaned? | Method |
|---|---|---|
| Qdrant memory entries | ✅ | Delete by ID via Qdrant REST API |
| Artifact dir | ✅ | Removed on failure via `cleanupRunArtifacts` |
| Isolated session file | Left (auto-expires via cron session retention) | n/a |
| DB run attempt records | ❌ | Preserved for audit trail |

---

## Artifact Files

When an agent writes files during an event run, they appear in the event's **Output tab**:

- Any file type: images, PDFs, text, CSV, JSON, etc.
- Download button for every file
- Inline image preview for image files
- Served via `/api/agenda/artifacts/[stepId]/[filename]`

**How it works:**
1. The rendered prompt tells the agent: *"If you create files, save them to `runtime-artifacts/agenda/<eventId>/occurrences/<occId>/artifacts`"*
2. After the cron run, the scheduler scans that directory
3. Found files → stored in `artifact_payload` on the run step
4. UI reads `artifact_payload` and renders download links

---

## Processes

Reusable multi-step instruction templates that can be attached to agenda events.

- Multi-step editor: Info → Steps → Review
- Per-step: instruction, skill, agent, model override
- Version tracking with labels
- **Simulation mode**: dry-run before creating — runs each step live via SSE, shows output per step
- **Simulation cleanup**: restores agent session files to pre-sim state by byte-offset truncation

When a process is attached to an agenda event, all steps are composed into a single unified prompt by `prompt-renderer.mjs` and sent to the agent as one turn.

---

## Calendar Status Styling

Event pills on the calendar are color-coded by the latest occurrence status:

| Status | Color | Calendar pill |
|---|---|---|
| `scheduled` / `queued` | Gray | Event title only |
| `running` | Indigo + pulse | ● Running + live duration |
| `succeeded` | Green | ✓ Done + duration |
| `needs_retry` | Amber | ⚠ Needs Retry badge |
| `failed` | Rose | ✗ Failed |
| `draft` | Gray, muted | Italic/muted style |

Duration shown as: `✓ Done · 2m 15s` or `● Running · 0m 43s`

---

## What Happens When...

**Cron job creation fails (e.g. timestamp in past):**
Occurrence immediately set to `needs_retry` with reason logged. No silent abandonment.

**Event fires but agent fails:**
Cron retries automatically (up to 3 times). After exhaustion, scheduler detects failure, runs Qdrant cleanup, tries fallback model if configured, then marks `needs_retry` + Telegram alert.

**User clicks Retry on a needs_retry occurrence:**
If the occurrence has an existing cron job → `openclaw cron run <id>` (immediate).
If not → creates a new one-shot cron job using the stored `rendered_prompt` (includes process steps).

**Scheduler is down for a period:**
Occurrences stay in `scheduled` state in Postgres. When scheduler restarts, it catches up and creates cron jobs for any upcoming occurrences within the 48h window. Past occurrences are detected by the `scheduledFor` → `now` comparison and scheduled for immediate execution.

**Gateway is down:**
Cron job creation (`openclaw cron add`) fails → occurrence set to `needs_retry`. User retries when gateway is back.

**Recurring event — one occurrence fails:**
Each occurrence is independent. Monday `needs_retry`, Tuesday `scheduled` — no cross-contamination.

**User edits a recurring event:**
- "Only this occurrence" → creates an occurrence override, does not affect other dates
- "This and future" → splits the series; old series ends, new series starts from split date
- "Delete all future" → soft-deletes recurring event (status → draft), cancels future occurrences

**SSE connection drops:**
EventSource auto-reconnects after 5 seconds. Full event refresh on reconnect.

**All services crash:**
`mc-services start` brings everything back. Watchdog auto-restarts on future crashes.

---

## Telegram Notifications

The scheduler sends Telegram notifications for lifecycle events. Chat ID is auto-discovered from OpenClaw session files — no manual configuration.

| Event | Message |
|---|---|
| All retries exhausted | ⚠️ Needs manual retry + reason |
| Fallback model retry | 🔄 Retrying with fallback model |
| Cron job creation failed | (caught and set to needs_retry) |

---

## Services

### Service Watchdog

`mc-services.sh` includes a background watchdog:
- Checks all services every 30 seconds
- Auto-restarts crashed services (except `gateway-sync` which is one-shot)
- Re-sources `.env` before restarting so services have DATABASE_URL etc.
- Logs: `.runtime/logs/watchdog.log`

```bash
bash scripts/mc-services.sh watch    # Start watchdog manually
```

### Gateway Sync

One-shot script that runs on start, imports agents + sessions from the OpenClaw gateway, then exits. This is normal — "STOPPED" in status output is expected after first run.

---

## Environment

Key env vars in `.env`:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `POSTGRES_PASSWORD` | DB password used by Docker (required) |
| `OPENCLAW_DATABASE_URL` | Alias for `DATABASE_URL` used by scheduler |

> **Do not set `OPENCLAW_GATEWAY_URL` or `OPENCLAW_GATEWAY_TOKEN` in `.env`.**
> Gateway config is auto-discovered from `~/.openclaw/openclaw.json`. Setting these env vars overrides auto-discovery and causes auth failures.

---

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/agenda/events` | GET/POST | Agenda event CRUD + test helpers |
| `/api/agenda/events/stream` | GET | SSE stream for real-time calendar updates |
| `/api/agenda/events/[id]` | GET/PATCH/DELETE | Single event operations |
| `/api/agenda/events/[id]/occurrences/[occId]` | POST/DELETE | Manual retry / dismiss occurrence |
| `/api/agenda/events/[id]/occurrences/[occId]/runs` | GET | Run attempts + steps (for Output tab) |
| `/api/agenda/artifacts/[stepId]/[filename]` | GET | Download agent-generated artifacts |
| `/api/agenda/failed` | GET | Failed/needs_retry occurrences |
| `/api/agenda/settings` | GET | Agenda settings (max retries, fallback model, scheduling interval) |
| `/api/agenda/stats` | GET | Occurrence counts by status |
| `/api/agenda/debug/run-steps` | GET | Run steps for an occurrence (test harness) |
| `/api/agenda/debug/render-template` | POST | Render unified task message without executing |
| `/api/processes` | GET/POST | Process CRUD |
| `/api/processes/[id]` | GET/PATCH/DELETE | Single process |
| `/api/processes/simulate` | POST | SSE — simulate process step-by-step |
| `/api/processes/simulate/cleanup` | POST | Cleanup sim files + restore agent sessions |
| `/api/queues` | GET | Cron engine stats (occurrence counts by status) |
| `/api/services` | GET/POST | Service health, start/stop/restart, log tailing |
| `/api/models` | GET | Model list from OpenClaw config |
| `/api/agents` | GET | Agent discovery |
| `/api/agent/logs` | GET | Agent log entries |
| `/api/agent/logs/stream` | GET | SSE — live agent logs |
| `/api/tasks` | GET/POST | Board/ticket CRUD |
| `/api/tasks/worker-metrics` | GET | Ticket worker health |
| `/api/files` | GET | Serve local files by path |
| `/api/file-manager/[[...path]]` | GET/POST/PUT/DELETE | File manager backend |
| `/api/system` | POST | Check updates, update, clean reset, uninstall |
| `/api/notifications/recent` | GET | Last N activity entries for sidebar |
| `/api/notifications/stream` | GET | SSE — unified ticket + agenda activity |
| `/api/events` | GET | SSE — ticket activity + worker ticks |
| `/api/setup` | GET/POST | Initial setup status |

---

## Database

Schema managed by `scripts/db-init.sh` (Docker) and `scripts/db-setup.mjs` (Node).

Key tables:

| Table | Purpose |
|---|---|
| `agenda_events` | Event definitions (title, prompt, recurrence, agent, model) |
| `agenda_occurrences` | One row per scheduled occurrence; carries `cron_job_id`, `rendered_prompt`, `status`, `fallback_attempted` |
| `agenda_run_attempts` | One row per cron run attempt (synced from `openclaw cron runs`) |
| `agenda_run_steps` | Agent output per attempt — drives the Output tab and artifact display |
| `agenda_event_processes` | Links events to process versions |
| `processes` / `process_versions` / `process_steps` | Reusable step templates |
| `worker_settings` | Agenda config: max_retries, fallback model, scheduling interval, sidebar activity count |
| `service_health` | Heartbeats from scheduler and bridge-logger |
| `agents` / `agent_logs` | Agent status and log entries |
| `boards` / `columns` / `tickets` | Kanban ticket system |
| `app_settings` | Gateway token cache + setup status |

Reset everything:
```bash
npm run db:reset
# or
bash scripts/clean.sh
```

---

## Scripts Reference

| Script | Purpose |
|---|---|
| `scripts/mc-services.sh` | Service supervisor — start/stop/restart/status/watch |
| `scripts/install.sh` | Full install: clone, .env, Docker DB, npm install, build |
| `scripts/update.sh` | Pull latest, npm install, schema apply, rebuild, restart |
| `scripts/clean.sh` | Wipe DB + Docker volumes, rebuild from scratch |
| `scripts/dev.sh` | Dev mode with Ctrl+C trap cleanup |
| `scripts/db-init.sh` | Run by Docker db-init container to apply schema |
| `scripts/db-setup.mjs` | DB migrations, seed, reset |
| `scripts/gateway-sync.mjs` | One-shot gateway import |
| `scripts/bridge-logger.mjs` | Persistent log ingestion daemon |
| `scripts/agenda-scheduler.mjs` | RRULE expansion + cron job creation + result sync |
| `scripts/agenda-selfcheck.mjs` | Health check for cron engine (schema, gateway, stuck occurrences) |
| `scripts/openclaw-config.mjs` | Reads gateway token from `openclaw.json` (shared helper) |
| `scripts/prompt-renderer.mjs` | Renders unified task message from event + process steps |
| `scripts/runtime-artifacts.mjs` | Artifact dir management (scan, cleanup) |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `cron.add: schedule.at is in the past` | Fixed in v2.7 — scheduler now uses `--at 30s` for past timestamps |
| `pairing required` when running `openclaw cron` | Run `openclaw doctor --fix` or approve pending CLI device in `~/.openclaw/devices/` |
| Occurrence stuck in `scheduled` (no cron_job_id) | Check scheduler logs: `.runtime/logs/agenda-scheduler.log`; restart scheduler |
| Output tab empty after run | Check `agenda_run_steps` table; verify scheduler is running v2.4+ |
| Calendar event colors not showing | Fixed in v2.7 — `run_started_at`/`run_finished_at` now in all event queries |
| Gateway-sync shows STOPPED | Normal — it's a one-shot script that exits after syncing |
| Services all stopped | `set -a && source .env && set +a && bash scripts/mc-services.sh start` |
| Watchdog restarts services but they fail | Usually missing DATABASE_URL in watchdog env; fixed in v2.2 |
| DB connection refused | `docker compose up -d db` |
| Port 3000 stuck | `pkill -f next-server` |
| Artifacts not appearing in Output tab | Agent must write files to the path shown in the prompt; check scheduler is v2.5+ |

---

## License

Part of the [OpenClaw](https://github.com/openclaw/openclaw) project.
