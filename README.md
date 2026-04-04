# 🚀 Mission Control — OpenClaw Agenda Dashboard

**Version 2.8** · Next.js 14 (App Router, TypeScript) · OpenClaw native cron engine

Local-first dashboard for managing OpenClaw scheduled agent tasks ("agenda"), processes, boards, and real-time logs.

> **No Redis required.** Execution is handled natively by the OpenClaw cron engine (v2+).

---

## ⚡ Quick Install

```bash
# One-command install (clone + env + DB + npm install + build)
curl -fsSL https://raw.githubusercontent.com/kenandevx/mission-control/main/scripts/install.sh | bash
```

Open **http://localhost:3000**

---

## 📋 Requirements

| Dependency | Version | Notes |
|---|---|---|
| Node.js | 24+ | Required |
| Docker + Compose v2 | Any modern | PostgreSQL only |
| OpenClaw | 2026.4.x+ | Gateway must be running and paired |

---

## 📁 Full File Map

```
mission-control/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout (providers, fonts, theme)
│   ├── page.tsx                  # Redirect → /dashboard
│   ├── dashboard/
│   │   └── page.tsx              # Stats overview
│   ├── agenda/
│   │   ├── page.tsx              # Agenda page (server component)
│   │   └── page-client.tsx       # Client component with calendar + SSE
│   ├── processes/
│   │   ├── page.tsx              # Process list + editor
│   │   └── [id]/page.tsx         # Single process view
│   ├── boards/
│   │   └── page.tsx              # Kanban board
│   ├── agents/
│   │   └── page.tsx              # Agent status cards + logs
│   ├── logs/
│   │   └── page.tsx              # Runtime logs + service management
│   ├── file-manager/
│   │   └── page.tsx              # File browser for ~/.openclaw/
│   ├── settings/
│   │   └── page.tsx              # Theme, agenda settings, system updates
│   └── api/                      # API Routes
│       ├── agenda/               # Event, occurrence, artifact, stats, logs
│       ├── processes/            # Process CRUD + simulation
│       ├── queues/               # Cron engine stats
│       ├── services/             # Service health + control
│       ├── models/              # Model list from OpenClaw config
│       ├── agents/              # Agent discovery + logs
│       ├── tasks/               # Board/ticket CRUD
│       ├── files/               # Local file serving
│       ├── notifications/       # Activity stream
│       └── system/              # Updates, clean reset

├── components/
│   ├── ui/                       # shadcn/ui base components
│   └── agenda/
│       ├── agenda-page-client.tsx    # Main agenda page (calendar, SSE, event list)
│       ├── agenda-details-sheet.tsx  # Event detail side sheet (Overview/Output/Logs tabs)
│       ├── agenda-event-form.tsx     # Create/edit event form
│       ├── agenda-list-view.tsx      # List view of events
│       ├── custom-month-agenda.tsx   # Custom calendar (month + day views, status legend)
│       └── result-badge.tsx          # Status badge component

├── hooks/
│   ├── use-now.ts               # Live clock + duration formatting
│   ├── use-sse.ts               # SSE event streaming hook
│   └── use-agenda-sse.ts        # Agenda-specific SSE hook

├── lib/
│   ├── status-colors.ts         # ⭐ Centralized status → color mapping
│   ├── agenda-client.ts         # Client-side agenda data fetching
│   ├── agenda-types.ts          # Shared TypeScript types
│   └── utils.ts                 # General utilities

├── scripts/
│   ├── agenda-scheduler.mjs     # RRULE expansion → cron job creation → result sync
│   ├── bridge-logger.mjs         # Watches gateway, ingests agent logs → DB
│   ├── gateway-sync.mjs         # One-shot: imports agents + sessions from gateway
│   ├── mc-services.sh           # Service supervisor (start/stop/restart/status/watch)
│   ├── db-init.sh               # Docker DB init container entrypoint
│   ├── db-setup.mjs             # Node.js DB migrations, seed, reset
│   ├── agenda-selfcheck.mjs     # Health check (schema, gateway, stuck occurrences)
│   ├── openclaw-config.mjs      # Reads gateway token from ~/.openclaw/openclaw.json
│   ├── prompt-renderer.mjs       # Renders unified task message from event + process
│   ├── runtime-artifacts.mjs   # Artifact dir management (scan, cleanup)
│   ├── install.sh               # Full install bootstrap
│   ├── update.sh                # Pull + install + rebuild
│   ├── clean.sh                 # Wipe DB + Docker volumes, full rebuild
│   └── dev.sh                   # Dev mode with cleanup trap

├── types/
│   └── index.ts                 # Shared TypeScript types (re-exported from lib)

└── public/
    └── (static assets)
```

---

## 🏗️ Architecture

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
bash scripts/mc-services.sh watch               # Start watchdog manually
```

---

## 📅 Agenda Event Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                        SCHEDULING                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  draft ──[activate]──→ active ──[scheduler cycle]──→ occurrence created
│                                         │                    │
│                              status: "scheduled"             │
│                              cron job: "openclaw cron add"   │
│                                         │                    │
│                              status: "queued"  ◄── cron_job_id set
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                      EXECUTION                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  queued ──[cron fires]──→ running ──[success]──→ succeeded │
│                              │                              │
│                              └──[failure]──→ cron retries   │
│                                             (1min, 2min, 5min)
│                                                       │      │
│                              all retries exhausted   │      │
│                                         │              │      │
│                               fallback model set?  ──┤      │
│                                      yes, not tried ─┤      │
│                                           ↓                │
│                                   auto_retry ──→ succeeded │
│                                          │                 │
│                              [no fallback / exhausted]      │
│                                         │                 │
│                              needs_retry ◄── Telegram alert │
│                                     │                       │
│                     [user clicks Retry]  [user dismisses]    │
│                              ↓                    ↓        │
│                           queued              cancelled     │
│                                                             │
│  needs_retry ──[user edits + saves]──→ new cron job ──→ queued
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                       INACTIVE                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  cancelled    ←── user dismissed / deleted occurrence      │
│  skipped      ←── dependency event failed or timed out      │
│  draft        ←── event deactivated                         │
│  stale_recovery ←─ recovered from stuck/stale running state │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎨 Color & Status Guide

Event pills on the calendar are color-coded by the latest occurrence status.

| Status | Color | Meaning |
|---|---|---|
| ⚪ **Grey** | `scheduled` | Created, waiting for its time slot — no cron job fired yet |
| ⚪ **Grey** | `queued` | Cron job assigned, waiting to fire — agent has **not** started yet |
| 🔵 **Blue** | `running` | Agent is **actively executing** right now |
| 🟢 **Green** | `succeeded` | Run completed successfully |
| 🟡 **Amber** | `needs_retry` | All retries exhausted — needs manual intervention |
| 🔴 **Rose** | `failed` | Terminal failure |
| 🔵 **Indigo** | `auto_retry` | Automatically retrying with fallback model |
| 🟣 **Purple** | `force_retry` | Manually triggered re-run |
| 🟠 **Orange** | `stale_recovery` | Recovered from stuck/stale running state |
| ⬜ **Grey muted** | `cancelled` / `skipped` / `draft` | Inactive — won't run |

> **The key rule:** ⚪ Grey = waiting (scheduled or queued) · 🔵 Blue = only when actively running.

---

## 🌐 API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/agenda/events` | GET/POST | Agenda event CRUD + test helpers |
| `/api/agenda/events/stream` | GET | SSE stream for real-time calendar updates |
| `/api/agenda/events/[id]` | GET/PATCH/DELETE | Single event operations |
| `/api/agenda/events/[id]/occurrences/[occId]` | POST/DELETE | Manual retry / dismiss occurrence |
| `/api/agenda/events/[id]/occurrences/[occId]/runs` | GET | Run attempts + steps (Output tab) |
| `/api/agenda/artifacts/[stepId]/[filename]` | GET | Download agent-generated artifacts |
| `/api/agenda/failed` | GET | Failed/needs_retry occurrences |
| `/api/agenda/settings` | GET | Agenda settings (max retries, fallback model) |
| `/api/agenda/stats` | GET | Occurrence counts by status |
| `/api/agenda/logs` | GET | Agenda occurrence logs |
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

## 🗄️ Database Tables

| Table | Purpose |
|---|---|
| `agenda_events` | Event definitions (title, prompt, recurrence, agent, model) |
| `agenda_occurrences` | One row per scheduled occurrence; carries `cron_job_id`, `rendered_prompt`, `status` |
| `agenda_run_attempts` | One row per cron run attempt (synced from `openclaw cron runs`) |
| `agenda_run_steps` | Agent output per attempt — drives Output tab and artifact display |
| `agenda_event_processes` | Links events to process versions |
| `processes` / `process_versions` / `process_steps` | Reusable step templates |
| `worker_settings` | Agenda config: max_retries, fallback model, scheduling interval |
| `service_health` | Heartbeats from scheduler and bridge-logger |
| `agents` / `agent_logs` | Agent status and log entries |
| `boards` / `columns` / `tickets` | Kanban ticket system |
| `app_settings` | Gateway token cache + setup status |

---

## 🔧 Scripts Reference

| Script | Purpose |
|---|---|
| `scripts/mc-services.sh` | Service supervisor — start/stop/restart/status/watch |
| `scripts/install.sh` | Full install: clone, .env, Docker DB, npm install, build |
| `scripts/update.sh` | Pull latest, npm install, schema apply, rebuild, restart |
| `scripts/clean.sh` | Wipe DB + Docker volumes, rebuild from scratch |
| `scripts/dev.sh` | Dev mode with Ctrl+C trap cleanup |
| `scripts/db-init.sh` | Run by Docker db-init container to apply schema |
| `scripts/db-setup.mjs` | DB migrations, seed, reset |
| `scripts/gateway-sync.mjs` | One-shot gateway import (exits after sync) |
| `scripts/bridge-logger.mjs` | Persistent log ingestion daemon |
| `scripts/agenda-scheduler.mjs` | RRULE expansion + cron job creation + result sync |
| `scripts/agenda-selfcheck.mjs` | Health check for cron engine |
| `scripts/openclaw-config.mjs` | Reads gateway token from `openclaw.json` (shared helper) |
| `scripts/prompt-renderer.mjs` | Renders unified task message from event + process steps |
| `scripts/runtime-artifacts.mjs` | Artifact dir management (scan, cleanup) |

---

## 🐛 Troubleshooting

| Issue | Fix |
|---|---|
| Calendar events all show blue but aren't running | Fixed in v2.8 — `queued` events are now grey (waiting), blue = only when actively running |
| `cron.add: schedule.at is in the past` | Fixed in v2.7 — scheduler uses `--at 30s` for past timestamps |
| `pairing required` when running `openclaw cron` | Run `openclaw doctor --fix` or approve pending CLI device in `~/.openclaw/devices/` |
| Occurrence stuck in `scheduled` (no cron_job_id) | Check scheduler logs: `.runtime/logs/agenda-scheduler.log`; restart scheduler |
| Output tab empty after run | Check `agenda_run_steps` table; verify scheduler is running |
| Calendar event colors not showing | Fixed in v2.7 — `run_started_at`/`run_finished_at` now in all event queries |
| Gateway-sync shows STOPPED | Normal — it's a one-shot script that exits after syncing |
| Services all stopped | `set -a && source .env && set +a && bash scripts/mc-services.sh start` |
| DB connection refused | `docker compose up -d db` |
| Port 3000 stuck | `pkill -f next-server` |
| Artifacts not appearing in Output tab | Agent must write files to the path shown in the prompt; check scheduler is running |

---

## 📦 npm Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Docker DB + all host services + `next dev` |
| `npm run build` | Production Next.js build |
| `npm start` | Start Next.js production server |
| `npm run agenda:selfcheck` | Check cron engine health, schema, stuck occurrences |
| `npm run agenda:smoke` | End-to-end smoke test (create event, retry, verify state) |

---

## 🌱 Bootstrap (Fresh Machine)

```bash
curl -fsSL https://raw.githubusercontent.com/kenandevx/mission-control/main/scripts/install.sh | bash
```

This installs everything: clone repo, create `.env`, start Docker DB, run schema migrations, `npm install`, `npm run build`, and start services.

---

## License

Part of the [OpenClaw](https://github.com/openclaw/openclaw) project.
