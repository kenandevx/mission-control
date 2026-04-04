# 🚀 Mission Control

**The OpenClaw native dashboard** — manage scheduled agenda tasks, multi-step processes, Kanban boards, agent logs, file browsing, and system settings from a single UI.

**Version 2.8.1** · Next.js 14 (App Router, TypeScript) · OpenClaw native cron engine · PostgreSQL

> **No Redis. No BullMQ.** Execution is handled natively by the OpenClaw cron engine (v2+).

---

## ⚡ Quick Install

```bash
# One-command bootstrap — clone, env, DB, npm, build, start
curl -fsSL https://raw.githubusercontent.com/kenandevx/mission-control/main/scripts/install.sh | bash
```

Open **http://localhost:3000** — setup wizard will guide you through gateway pairing.

---

### Requirements

| Dependency | Version | Notes |
|---|---|---|
| Node.js | 24+ | Required |
| Docker + Compose v2 | Any modern | PostgreSQL only |
| OpenClaw | 2026.4.x+ | Gateway must be running and paired |

### npm Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Docker DB + all host services + `next dev` |
| `npm run build` | Production Next.js build |
| `npm start` | Next.js production server |
| `npm run agenda:selfcheck` | Cron engine health, schema, stuck occurrences |
| `npm run agenda:smoke` | End-to-end smoke test (create event, retry, verify state) |

---

## 📁 Project Structure

```
mission-control/
├── app/                              # Next.js App Router
│   ├── layout.tsx                    # Root layout (providers, fonts, sidebar)
│   ├── page.tsx                      # Redirect → /dashboard
│   ├── dashboard/page.tsx            # Stats overview + activity feed
│   ├── agenda/
│   │   ├── page.tsx                  # Server component → page-client
│   │   └── page-client.tsx          # Calendar, SSE, event list, detail sheet
│   ├── processes/
│   │   ├── page.tsx                 # Process list + editor modal
│   │   └── [id]/page.tsx            # Single process view
│   ├── boards/page.tsx              # Kanban board (server)
│   ├── agents/
│   │   ├── page.tsx                 # Agent status cards grid
│   │   └── [agentId]/page.tsx      # Agent detail + live log stream
│   ├── logs/page.tsx                # Runtime logs + Services tab
│   ├── file-manager/page.tsx        # File browser for ~/.openclaw/
│   ├── settings/page.tsx            # Theme, agenda, system updates
│   ├── setup/page.tsx               # First-run wizard
│   ├── approvals/page.tsx           # Pending Telegram/Slack approvals
│   ├── health/route.ts              # Liveness probe
│   └── api/                         # All API routes (see API Reference)
│       ├── agenda/                   # Events, occurrences, artifacts, stats, logs
│       ├── processes/                # Process CRUD + simulation
│       ├── queues/                   # Cron engine stats
│       ├── services/                 # Service health + control
│       ├── models/                   # Available models from OpenClaw config
│       ├── agents/                   # Agent discovery + logs
│       ├── tasks/                    # Board/ticket CRUD
│       ├── files/                    # Local file serving
│       ├── notifications/           # Activity stream
│       ├── events/                   # SSE for ticket activity
│       ├── system/                   # Updates, clean reset
│       ├── skills/                   # Available skills
│       └── setup/                    # Initial setup status
├── components/
│   ├── ui/                          # shadcn/ui base components
│   ├── agenda/
│   │   ├── agenda-page-client.tsx   # Main calendar page
│   │   ├── agenda-details-sheet.tsx # Side sheet: Overview / Output / Logs tabs
│   │   ├── agenda-event-modal.tsx   # Create/edit event form
│   │   ├── custom-month-agenda.tsx # Custom month calendar (status legend)
│   │   ├── agenda-simulate-modal.tsx
│   │   ├── agenda-stats-cards.tsx
│   │   └── agenda-failed-bucket.tsx # Needs-retry occurrences
│   ├── agents/
│   │   ├── agent-ui.tsx             # Agent status card
│   │   ├── logs-page-client.tsx    # Logs page with tabs
│   │   ├── logs-explorer.tsx        # Paginated log table
│   │   ├── logs-live-refresh.tsx   # SSE live log tail
│   │   ├── service-manager.tsx      # Start/stop services UI
│   │   └── log-details-modal.tsx    # JSON payload viewer
│   ├── tasks/
│   │   ├── boards/boards-page-client.tsx # Board selector + Kanban view
│   │   ├── kanban/kanban-view.tsx   # Drag-and-drop Kanban board
│   │   └── modals/ticket-details-modal.tsx
│   ├── processes/
│   │   ├── processes-page-client.tsx
│   │   ├── process-editor-modal.tsx  # Multi-step process editor
│   │   └── process-simulate-modal.tsx # SSE simulation runner
│   ├── dashboard/
│   │   ├── section-cards.tsx        # KPI stat cards
│   │   └── activity-logs.tsx        # Workspace audit trail
│   └── layout/
│       └── app-sidebar.tsx          # Navigation sidebar
├── hooks/
│   ├── use-now.tsx                  # Live clock + duration formatting
│   ├── use-agenda.ts                # Agenda data fetching
│   └── use-tasks.ts                 # Board/task data fetching
├── lib/
│   ├── status-colors.ts             # ⭐ Centralized status → color mapping
│   ├── agenda-domain.ts             # Agenda business logic (transitions, etc.)
│   ├── agenda-render-prompt.ts      # Prompt rendering helpers
│   ├── agent-log-utils.ts           # Log message parsing + display utils
│   ├── db/adapter.ts                # PostgreSQL query wrapper
│   ├── db/server-data.ts            # Server-side data helpers
│   └── models.ts                    # Available model definitions
├── scripts/
│   ├── mc-services.sh               # Service supervisor (start/stop/restart/status/watch)
│   ├── agenda-scheduler.mjs         # RRULE expansion → cron job creation
│   ├── bridge-logger.mjs            # File watcher → agent_logs DB ingestion
│   ├── gateway-sync.mjs             # One-shot: imports agents + sessions from gateway
│   ├── prompt-renderer.mjs          # Renders unified task message from event + process
│   ├── runtime-artifacts.mjs        # Artifact dir management (scan, cleanup)
│   ├── db-setup.mjs                 # DB migrations, seed, reset
│   ├── db-init.sh                   # Docker init container entrypoint
│   ├── agenda-selfcheck.mjs         # Health check
│   ├── openclaw-config.mjs          # Reads gateway token from openclaw.json
│   ├── install.sh                   # Full bootstrap install
│   ├── update.sh                    # Pull + install + rebuild
│   ├── clean.sh                     # Wipe DB + Docker volumes, rebuild
│   └── dev.sh                       # Dev mode with cleanup trap
├── db/
│   ├── schema.sql                   # Full PostgreSQL schema
│   └── seed.sql                    # Default board/column seed data
├── types/
│   ├── agents.ts                   # Agent + AgentLog TypeScript types
│   └── tasks.ts                    # Board/column/ticket types
└── runtime-artifacts/              # Agent-generated output files (gitignored)
    └── agenda/<eventId>/occurrences/cron/runs/<runId>/<files>
```

---

## 🏗️ Architecture

```
                          ┌─────────────────────────────────────────┐
                          │              User Browser                │
                          │    HTTP REST  ·  SSE (live updates)     │
                          └──────────────┬──────────────────────────┘
                                         │
                          ┌──────────────▼──────────────────────────┐
                          │        Next.js (port 3000)               │
                          │  API Routes · SSE handlers · pg_notify   │
                          └──────────────┬──────────────────────────┘
                                         │
                          ┌──────────────▼──────────────────────────┐
                          │       PostgreSQL (Docker, :5432)         │
                          │  Tables: agenda, boards, agents, logs   │
                          └──────────────┬──────────────────────────┘
                     ┌────────────────────┼────────────────────┐
                     │                    │                     │
          ┌──────────▼──────┐  ┌─────────▼────────┐  ┌────────▼──────────┐
          │ agenda-scheduler │  │  bridge-logger   │  │   gateway-sync     │
          │  (host process)  │  │  (host process)  │  │  (one-shot, exits) │
          └──────────┬───────┘  └─────────┬────────┘  └────────────────────┘
                     │                    │
          openclaw cron engine       session .jsonl files
          (inside OpenClaw gateway)   gateway .log (daily rotated)
          ~/.openclaw/cron/runs/*.jsonl  ← cron run result files
```

### Services (all managed by `scripts/mc-services.sh`)

| Service | Script | Runs | Purpose |
|---|---|---|---|
| **agenda-scheduler** | `agenda-scheduler.mjs` | Persistent | Expands RRULE → creates `openclaw cron` jobs → syncs results via bridge-logger |
| **bridge-logger** | `bridge-logger.mjs` | Persistent | Watches gateway log + session files + cron runs → writes to `agent_logs` table |
| **gateway-sync** | `gateway-sync.mjs` | One-shot (exits) | Imports agents + sessions from OpenClaw gateway into DB on startup |
| **nextjs** | `npm run start` | Persistent | Production Next.js server |
| **watchdog** | built into `mc-services.sh` | Persistent | Checks every 30s, auto-restarts crashed services |

All PID files: `.runtime/pids/*.pid` · All logs: `.runtime/logs/*.log`

---

## 🌐 Pages

| Route | Page | What it does |
|---|---|---|
| `/dashboard` | Dashboard | KPI cards (occurrences by status), activity feed, recent logs |
| `/agenda` | Agenda | Calendar (month/day), event list, create/edit events, occurrence detail sheet |
| `/processes` | Processes | Process list, multi-step editor, simulation runner |
| `/boards` | Kanban | Board selector, drag-and-drop columns + tickets, activity feed |
| `/agents` | Agents | Agent status cards grid, online/offline indicator |
| `/agents/[id]` | Agent Detail | Agent info, live SSE log stream, session history |
| `/logs` | Logs | 3 tabs: Runtime Logs, Agenda Logs, Services — with SSE live refresh |
| `/file-manager` | File Manager | Browse/edit files in `~/.openclaw/` |
| `/settings` | Settings | Theme, agenda defaults, system updates, danger zone |
| `/approvals` | Approvals | Pending Telegram/Slack approval requests |
| `/setup` | Setup Wizard | First-run gateway pairing + workspace init |

---

## 📅 Agenda

### How It Works (End-to-End)

1. **Event created** — user fills in title, prompt, recurrence (RRULE), agent, model, execution window
2. **Scheduler cycle** (every `poll_interval_seconds`) — for each active event, expands RRULE over the next 14 days; creates `agenda_occurrences` rows with status `scheduled`
3. **Occurrence queued** — occurrence's scheduled time is within the lookahead window → scheduler calls `openclaw cron add --at <timestamp>`; sets occurrence status to `queued`; stores `cron_job_id`
4. **Cron fires** — OpenClaw gateway executes the cron job in an isolated agent session; output lands in `~/.openclaw/cron/runs/<jobId>.jsonl`
5. **bridge-logger detects** the cron run file → parses result → sets occurrence to `succeeded` or `failed`
6. **If failed** — scheduler checks if fallback model is set; if yes, creates a new cron job with fallback model (status `auto_retry`); if no more retries, sets `needs_retry`
7. **Dashboard reflects state** via SSE subscriptions on `pg_notify('agenda_change')`

### Occurrence Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│                        SCHEDULING                                 │
│                                                                  │
│  draft ──[activate]──→ active ──[scheduler]──→ occurrence created │
│                                    status: "scheduled"            │
│                                    cron job: none yet              │
│                                              │                    │
│                          status: "queued" ◄── cron_job_id set     │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                        EXECUTION                                  │
│                                                                  │
│  queued ──[cron fires]──→ running ──[success]──→ succeeded        │
│                              │                                   │
│                              └──[failure]──→ auto-retry (fallback)│
│                                                │                  │
│                              all retries exhausted: needs_retry    │
│                                     │                            │
│                   [user clicks Retry]  [user dismisses]           │
│                          ↓                    ↓                  │
│                       queued              cancelled                │
│                                                                  │
│  needs_retry ──[edit + save]──→ new cron job ──→ queued           │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                        INACTIVE                                   │
│                                                                  │
│  cancelled  ←── user dismissed / deleted occurrence               │
│  skipped    ←── dependency failed or timed out                    │
│  draft      ←── event deactivated                                 │
│  stale_recovery ←── recovered from stuck running state            │
└──────────────────────────────────────────────────────────────────┘
```

### Status Colors

Event pills on the calendar use the latest occurrence status. **Single source of truth: `lib/status-colors.ts`.**

| Status | Color | Meaning |
|---|---|---|
| `scheduled` | ⚪ Grey | Created, waiting for scheduler to assign cron job |
| `queued` | ⚪ Grey | Cron job assigned, waiting to fire — **not blue** |
| `running` | 🔵 Blue | Agent **actively executing** right now — **only this status is blue** |
| `succeeded` | 🟢 Green | Completed successfully |
| `needs_retry` | 🟡 Amber | All retries exhausted, needs manual intervention |
| `failed` | 🔴 Rose | Terminal failure |
| `auto_retry` | 🔵 Indigo | Automatically retrying with fallback model |
| `force_retry` | 🟣 Purple | Manually triggered re-run |
| `stale_recovery` | 🟠 Orange | Recovered from stuck/stale running state |
| `cancelled` / `skipped` / `draft` | ⬜ Grey muted | Inactive — won't run |

### Retry Flow

- **Primary attempt fails** → scheduler checks `fallback_model` on the event
- If fallback is set and not yet attempted → creates a new cron job with fallback model; occurrence status → `auto_retry`
- If fallback is set but already attempted, or no fallback → `needs_retry`; alert sent
- User can click **Retry** on any failed/needs_retry occurrence → creates new cron job → `queued`
- User can **Edit + Save** a needs_retry occurrence → re-renders prompt → new cron job

### Artifact Files

When an agent writes files to the path embedded in the prompt (e.g. `/home/user/.openclaw/runtime-artifacts/agenda/<eventId>/occurrences/cron/runs/<runId>/`), bridge-logger scans that directory and persists file metadata to `runtime-artifacts.mjs` state. The Output tab in the occurrence detail sheet shows file previews and download links via `/api/agenda/artifacts/[stepId]/[filename]`.

### Scheduler Details (`agenda-scheduler.mjs`)

- **Lookahead**: 14 days (`AGENDA_LOOKAHEAD_DAYS` env var)
- **Cycle interval**: `poll_interval_seconds` from `worker_settings` table (default 20s)
- **Cron creation**: uses `openclaw cron add --at <ISO timestamp> --session isolated --message "<rendered prompt>" --agent <agentId> --model <model> --delete-after-run --no-deliver --json`
- **Past timestamps**: if `<scheduled> - now() < 30s`, uses `--at 30s` instead (cron rejects past dates)
- **Session isolation**: agenda tasks run in `isolated` sessions by default (no Telegram noise); `session_target` can be set to `main`
- **Result sync**: scheduler does NOT read cron run results — bridge-logger handles that via `~/.openclaw/cron/runs/*.jsonl` watching
- **Fallback trigger**: listens for `pg_notify('agenda_change')` signals emitted by bridge-logger after failed runs

### Bridge-Logger Details (`bridge-logger.mjs`)

See the **Logs → Log Data Flow** section below for the full picture.

---

## 📋 Processes

### What Processes Are

A **Process** is a reusable, versioned, multi-step task template. Each process has:
- A **name** and **description**
- One or more **versions** (snapshots with a label and version number)
- Each version has **ordered steps** with instructions, optional skill, optional agent override, optional model override

Processes are attached to agenda events via `agenda_event_processes` (many-to-many). When an attached event runs, all its linked process steps are composed into a single unified prompt by `prompt-renderer.mjs`.

### Multi-Step Editor Flow

1. User clicks **New Process** → `process-editor-modal.tsx` opens
2. Fills in name + description
3. Adds ordered steps: title, instruction text, optional skill key (`@skill-name`), optional agent ID, optional model override
4. On save: creates `processes` row, `process_versions` row (version 1), `process_steps` rows
5. Process starts as `draft`; can be published/archived from the list view

### Simulation Mode

- **Trigger**: "Simulate" button on any process card
- **Endpoint**: `POST /api/processes/simulate` → returns SSE stream
- **How it works**: each step is executed live against the real agent; output is streamed back step-by-step via SSE events (`process.step`, `process.output`, `process.done`, `process.error`)
- **Cleanup**: after simulation, `POST /api/processes/simulate/cleanup` truncates the agent's session `.jsonl` files back to their pre-sim byte offsets (stored in `session_snapshots` on `agenda_run_attempts`)
- **Use case**: test a process without creating real agenda occurrences

### How Processes Attach to Agenda Events

- Agenda event form has a **"Attach Process"** picker — shows all published processes + their latest version
- On save, `agenda_event_processes` rows are created linking the event to the selected process version
- Multiple processes can be attached to one event; steps are concatenated in `sort_order`
- When scheduler creates a cron job for an occurrence, it calls `prompt-renderer.mjs` which:
  1. Fetches all linked process versions + steps for the event
  2. Fetches the occurrence's `rendered_prompt` (or renders it fresh)
  3. Concatenates: `Task: <title>`, `Context: <free_prompt>`, `Instructions: <step-by-step>`, `Request: <...>`
  4. Returns the unified message string passed to `openclaw cron add --message`

### Prompt Rendering (`prompt-renderer.mjs`)

```js
renderUnifiedTaskMessage({ title, context, request, instructions, artifactDir })
// title     — event title
// context   — event's free_prompt
// request   — (empty for process-based events, free text for pure prompt events)
// instructions — array of { order, title, instruction, skillKey }
// artifactDir — per-occurrence artifact path for file outputs
```

Output rules injected into every prompt:
- Return only the requested deliverable
- No internal labels, IDs, or system metadata
- No inventing missing facts
- If creating files, save to the `artifactDir` path

---

## 🗂️ Kanban / Boards

### What Boards Are

A **Board** is a Kanban workspace (e.g. "Sprint 1", "Bug Triage"). Each board has **Columns** (e.g. To Do, In Progress, Done) and **Tickets** (cards) that move between columns.

### Data Model

```
boards
  └── columns
        └── tickets
              ├── ticket_activity   (per-ticket audit trail)
              ├── ticket_comments   (replies)
              ├── ticket_subtasks   (checklist items)
              └── ticket_attachments (file refs)
activity_logs  (workspace-wide audit trail, also written by all ticket mutations)
```

### Ticket Lifecycle

1. User creates a ticket from the board UI → `POST /api/tasks` with `action: "create"`
2. Ticket gets `lifecycle_status: "open"`, `execution_state: "pending"`
3. Ticket can be moved between columns via drag-and-drop → `PUT /api/tasks/[id]` with `column_id`
4. Ticket can be assigned to an agent → `execution_mode: "auto"` + `assigned_agent_id`
5. When agent executes, `execution_state` transitions: `pending` → `running` → `succeeded`/`needs_retry`
6. All mutations go through `/api/tasks` (POST with `action` field) which writes to:
   - `tickets` table (the record itself)
   - `ticket_activity` table (per-ticket audit trail)
   - `activity_logs` table (workspace-wide audit trail)
   - `agent_logs` table (type=`workflow`, `event_type=task.event`)

### Ticket Activity Feed

The boards page has an **Activity** tab per ticket. It queries `ticket_activity` ordered by `occurred_at DESC`. Event types include: `created`, `moved`, `edited`, `assigned`, `commented`, `subtask_added`, `checklist_done`.

### SSE Live Updates

`GET /api/events` returns an SSE stream. The server calls `pg_notify('ticket_activity', payload)` on every ticket mutation. Clients subscribed to the stream receive the payload and update the Kanban board in real-time without refresh.

### Task Audit Logs

Every mutation through `/api/tasks` logs to three places simultaneously:
1. **`activity_logs`** — workspace-wide, used by Dashboard activity feed
2. **`ticket_activity`** — per-ticket, used by ticket detail activity tab
3. **`agent_logs`** (type=`workflow`, `event_type=task.event`) — used by Logs page + agent history

---

## 📊 Logs

### Log Types (`agent_logs.type` column)

| Type | What it records | Source |
|---|---|---|
| `system` | Gateway startup, heartbeat, errors, warnings | bridge-logger reading `openclaw-YYYY-MM-DD.log` |
| `workflow` | Chat messages in/out, task events | bridge-logger reading session `.jsonl` files |
| `tool` | Tool calls: `tool.success`, `tool.error` | bridge-logger reading session `.jsonl` files |
| `memory` | Memory operations: `memory.search`, `memory.write`, `memory.error` | bridge-logger reading session `.jsonl` files |
| `agenda` | Agenda lifecycle events | scheduler emitting via `emitSchedulerLog()` |

### Log Sources (bridge-logger watches these files)

| Source path | What it contains | Emits |
|---|---|---|
| `~/.openclaw/agents/*/sessions/*.jsonl` | One file per agent session; structured JSON lines | `system`, `workflow`, `tool`, `memory` logs |
| `/tmp/openclaw/openclaw-YYYY-MM-DD.log` | Gateway daily system log | `system.event`, `system.warning`, `system.error` |
| `~/.openclaw/cron/runs/*.jsonl` | One file per cron job run result | `agenda.created`, `agenda.succeeded`, `agenda.failed`, `agenda.fallback` |

### Runtime Logs Tab

Shows all `agent_logs` rows where `type IN ('system', 'workflow', 'tool', 'memory')`. Paginated table with columns: Time, Agent, Type, Level, Event Type, Message Preview. SSE live-refresh appends new rows as bridge-logger ingests them.

### Agenda Logs Tab

Shows all `agent_logs` rows where `type = 'agenda'`. The `event_type` column gives the specific lifecycle event:

| event_type | Trigger |
|---|---|
| `agenda.created` | Occurrence row inserted by scheduler |
| `agenda.queued` | Cron job created, occurrence moved to queued |
| `agenda.started` | Cron fires, occurrence moved to running |
| `agenda.succeeded` | Cron run completed successfully |
| `agenda.failed` | Cron run failed (terminal) |
| `agenda.fallback` | Primary model exhausted, fallback model queued |
| `agenda.skipped` | Dependency event failed or timed out |
| `agenda.error` | Cron job creation itself failed |

### Services Tab

Shows `service_health` table rows for all services. Columns: Service, Status (running/stopped/error), PID, Last Heartbeat, Last Error. "Restart" button per service calls `mc-services.sh restart <service>`.

### How SSE Live-Refresh Works

1. Client opens Logs page → calls `GET /api/agent/logs/stream` (SSE)
2. Server sets up `sql.subscribe('pg_notify_channel')` for the relevant workspace
3. When bridge-logger or scheduler writes a row, it also calls `sql` .notify()` on the channel
4. Server reads the notification → pushes a newline-delimited JSON event to the SSE stream
5. Client's `EventSource` receives the event → appends to the log table in real-time

### Log Data Flow

```
Session .jsonl files                  Gateway .log                   Cron runs .jsonl
(per agent session)                  (daily rotated)                (per cron job)
      │                                  │                               │
      │  bridge-logger                  │  bridge-logger                │  bridge-logger
      │  reads JSON lines               │  reads log levels             │  reads result JSON
      │  offset-tracked                 │  offset-tracked               │  offset-tracked
      │  ↓                              │  ↓                            │  ↓
      │  system/workflow/               │  system.event/                │  agenda.created/
      │  tool/memory logs               │  system.warning/              │  agenda.succeeded/
      │                                  │  system.error                  │  agenda.failed
      │                                  │                               │
      └──────────────────────────────────┴───────────────────────────────┘
                                          │
                                 pg_notify('agenda_change')
                                          │
                              ┌───────────▼──────────┐
                              │   PostgreSQL         │
                              │   agent_logs table   │
                              └───────────┬──────────┘
                                          │
                              ┌───────────▼──────────┐
                              │  SSE stream           │
                              │  /api/agent/logs/     │
                              │  /stream              │
                              └───────────────────────┘
```

---

## 🤖 Agents

### Agent Status Cards

`GET /agents` page shows a grid of `agents` table rows with:
- Agent name (from `openclaw_agent_id`)
- Status badge: `idle` / `running` / `error`
- Last heartbeat timestamp
- Model in use
- Link to detail page

### Agent Detail + Logs

`GET /agents/[agentId]` shows:
- Full agent metadata
- **Live log stream** (`/api/agent/logs/stream` SSE) — real-time updates as bridge-logger ingests session data
- Session history from `agent_sessions` table

### How Agents Are Discovered (gateway-sync)

On every Mission Control startup, `gateway-sync.mjs` runs once and:
1. Calls `GET /v1/agents` on the OpenClaw gateway
2. Upserts rows into `agents` table (`openclaw_agent_id` as unique key)
3. Calls `GET /v1/sessions` for each agent → upserts into `agent_sessions`
4. Exits (it is NOT a persistent service)

Agents are also created on-demand by `agenda-scheduler.mjs` when emitting agenda logs (ensures `agent_id` FK always exists).

---

## 📂 File Manager

### What It Does

Browse, preview, edit, and manage files under `~/.openclaw/` directly from the browser. Files are served through `GET /api/file-manager/[[...path]]` which:
- Resolves paths relative to `~/.openclaw/`
- Supports `GET` (read), `POST` (create), `PUT` (edit), `DELETE`
- Returns directory listings with file size, modified date
- Prevents directory traversal attacks by normalizing paths

### API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/file-manager/[[...path]]` | GET | Read file or list directory |
| `/api/file-manager/[[...path]]` | POST | Create file or directory |
| `/api/file-manager/[[...path]]` | PUT | Edit/rename file |
| `/api/file-manager/[[...path]]` | DELETE | Delete file or directory |
| `/api/files` | GET | Legacy local file serving for static assets |

---

## ⚙️ Settings

### Theme Settings

Light/Dark/System mode toggle. Persisted to `localStorage` via `next-themes`.

### Agenda Settings (`worker_settings` table)

| Setting | Default | Purpose |
|---|---|---|
| `poll_interval_seconds` | 20 | How often scheduler wakes to check for new occurrences |
| `max_retries` | 1 | How many fallback attempts before `needs_retry` |
| `default_fallback_model` | `""` | Model to use after primary model fails |
| `scheduling_interval_minutes` | 15 | Slot enforcement — events must fit within N-minute windows |
| `sidebar_activity_count` | 8 | Number of recent activity items shown in sidebar |

### System Updates

- **Check for updates**: calls `git fetch origin && git log HEAD..origin/main` via `/api/system`
- **Apply update**: `git pull origin main && npm install && npm run build`
- **Clean reset**: wipes DB + Docker volumes + `.runtime/` — full rebuild

---

## 🔌 API Reference

### Agenda

| Route | Method | Purpose | Params/Body |
|---|---|---|---|
| `/api/agenda/events` | GET | List events with latest occurrence | `?workspace_id=&status=` |
| `/api/agenda/events` | POST | Create event | `title, free_prompt, recurrence_rule, agent_id, model, ...` |
| `/api/agenda/events/stream` | GET | SSE: real-time calendar updates | `?workspace_id=` |
| `/api/agenda/events/[id]` | GET | Single event + occurrences | |
| `/api/agenda/events/[id]` | PATCH | Update event | |
| `/api/agenda/events/[id]` | DELETE | Delete event + occurrences | |
| `/api/agenda/events/[id]/occurrences/[occId]` | POST | Manual retry | |
| `/api/agenda/events/[id]/occurrences/[occId]` | DELETE | Dismiss occurrence | |
| `/api/agenda/events/[id]/occurrences/[occId]/runs` | GET | Run attempts + steps | |
| `/api/agenda/artifacts/[stepId]/[filename]` | GET | Download artifact file | |
| `/api/agenda/failed` | GET | Failed + needs_retry occurrences | |
| `/api/agenda/settings` | GET | Worker settings | |
| `/api/agenda/stats` | GET | Occurrence counts by status | |
| `/api/agenda/logs` | GET | Agenda log entries (type=agenda) | `?occurrence_id=` |
| `/api/agenda/debug/run-steps` | GET | Test harness: run steps for occurrence | `?occurrence_id=` |
| `/api/agenda/debug/render-template` | POST | Render prompt without executing | `{ event_id, occurrence_id }` |

### Processes

| Route | Method | Purpose |
|---|---|---|
| `/api/processes` | GET | List processes |
| `/api/processes` | POST | Create process |
| `/api/processes/[id]` | GET | Single process + versions + steps |
| `/api/processes/[id]` | PATCH | Update process metadata |
| `/api/processes/[id]` | DELETE | Archive process |
| `/api/processes/simulate` | POST | SSE simulation (step-by-step live execution) |
| `/api/processes/simulate/cleanup` | POST | Restore agent session files after sim |

### Queues

| Route | Method | Purpose |
|---|---|---|
| `/api/queues` | GET | Cron engine stats: occurrence counts by status |

### Services

| Route | Method | Purpose |
|---|---|---|
| `/api/services` | GET | Service health from `service_health` table |
| `/api/services` | POST | Start/stop/restart service | `{ action: "start\|stop\|restart", service: "name" }` |

### Models

| Route | Method | Purpose |
|---|---|---|
| `/api/models` | GET | Available models from OpenClaw gateway config |

### Agents

| Route | Method | Purpose |
|---|---|---|
| `/api/agents` | GET | List agents from `agents` table |
| `/api/agents/logs` | GET | Agent log entries (paginated) | `?agent_id=&type=&level=` |
| `/api/agents/logs/stream` | GET | SSE: live log stream |

### Tasks / Kanban

| Route | Method | Purpose |
|---|---|---|
| `/api/tasks` | GET | List tickets | `?board_id=&column_id=` |
| `/api/tasks` | POST | Create ticket or board | `{ action: "create", board_id, ... }` |
| `/api/tasks` | PUT | Update ticket / move column | `{ action: "update\|move", ticket_id, ... }` |
| `/api/tasks` | DELETE | Delete ticket | `{ ticket_id }` |
| `/api/tasks/worker-metrics` | GET | Worker health stats |

### Events / SSE

| Route | Method | Purpose |
|---|---|---|
| `/api/events` | GET | SSE: ticket activity + worker ticks |
| `/api/notifications/recent` | GET | Last N activity entries |
| `/api/notifications/stream` | GET | SSE: unified ticket + agenda activity |
| `/api/notifications/recent` | GET | Recent notifications |

### Files

| Route | Method | Purpose |
|---|---|---|
| `/api/file-manager/[[...path]]` | GET/POST/PUT/DELETE | File browser CRUD |
| `/api/files` | GET | Legacy static file serving |

### System

| Route | Method | Purpose |
|---|---|---|
| `/api/system` | POST | Check updates / apply / clean reset | `{ action: "check\|update\|clean" }` |
| `/api/setup` | GET/POST | Setup wizard status + completion |

### Skills

| Route | Method | Purpose |
|---|---|---|
| `/api/skills` | GET | Available skills from OpenClaw config |

---

## 🗄️ Database Schema

### Core Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `workspaces` | Top-level org unit | `id`, `name`, `slug` |
| `profiles` | User profiles within workspace | `id`, `workspace_id`, `email`, `name`, `role` |
| `app_settings` | Single-row settings (gateway token, setup status) | `gateway_token`, `setup_completed` |

### Agenda Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `agenda_events` | Event definitions | `id`, `workspace_id`, `title`, `free_prompt`, `recurrence_rule`, `status` (draft/active), `default_agent_id`, `model_override`, `fallback_model`, `session_target` (isolated/main), `execution_window_minutes` |
| `agenda_occurrences` | Per-scheduled-run rows | `id`, `agenda_event_id`, `scheduled_for`, `status`, `cron_job_id`, `latest_attempt_no`, `fallback_attempted`, `rendered_prompt`, `queued_at`, `retry_requested_at` |
| `agenda_event_processes` | Event ↔ ProcessVersion links | `id`, `agenda_event_id`, `process_version_id`, `sort_order` |
| `agenda_run_attempts` | Per cron firing attempt | `id`, `occurrence_id`, `attempt_no`, `cron_job_id`, `status`, `started_at`, `finished_at`, `summary`, `error_message`, `session_snapshots`, `cleanup_status` |
| `agenda_run_steps` | Per-step output within an attempt | `id`, `run_attempt_id`, `process_version_id`, `process_step_id`, `step_order`, `agent_id`, `skill_key`, `status`, `input_payload`, `output_payload`, `artifact_payload`, `started_at`, `finished_at` |
| `agenda_occurrence_overrides` | Per-occurrence prompt/time overrides | `id`, `occurrence_id`, `overridden_free_prompt`, `overridden_agent_id`, ... |
| `agent_execution_locks` | Per-agent lock during agenda run | `agent_id`, `occurrence_id`, `locked_at` |

### Process Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `processes` | Process definitions | `id`, `workspace_id`, `name`, `description`, `status` (draft/published/archived) |
| `process_versions` | Version snapshots | `id`, `process_id`, `version_number`, `version_label`, `published_at` |
| `process_steps` | Ordered steps within a version | `id`, `process_version_id`, `step_order`, `title`, `instruction`, `skill_key`, `agent_id`, `model_override`, `fallback_model`, `timeout_seconds` |

### Kanban Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `boards` | Top-level board | `id`, `workspace_id`, `name`, `description` |
| `columns` | Columns within a board | `id`, `board_id`, `title`, `color_key`, `is_default`, `position` |
| `tickets` | Cards within columns | `id`, `board_id`, `column_id`, `title`, `priority`, `status`, `assignee_ids`, `assigned_agent_id`, `scheduled_for`, `execution_state`, `execution_mode`, `lifecycle_status`, `plan_text`, `fallback_model`, `execution_window_minutes` |
| `ticket_activity` | Per-ticket audit trail | `id`, `ticket_id`, `event`, `details`, `level`, `occurred_at` |
| `ticket_comments` | Replies on tickets | `id`, `ticket_id`, `author_name`, `content` |
| `ticket_subtasks` | Checklist items | `id`, `ticket_id`, `title`, `completed` |
| `ticket_attachments` | File refs | `id`, `ticket_id`, `name`, `url`, `mime_type`, `path` |
| `activity_logs` | Workspace-wide audit trail | `id`, `workspace_id`, `source`, `event`, `details`, `level`, `occurred_at` |

### Agent Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `agents` | Agent registry | `id`, `workspace_id`, `openclaw_agent_id`, `status`, `model`, `last_heartbeat_at` |
| `agent_sessions` | Agent session instances | `id`, `workspace_id`, `agent_id`, `telegram_chat_id`, `openclaw_session_key` |
| `agent_logs` | All log entries (the central log table) | `id`, `workspace_id`, `agent_id`, `runtime_agent_id`, `occurred_at`, `level`, `type`, `event_type`, `message`, `message_preview`, `raw_payload`, `agenda_occurrence_id`, `is_json`, `contains_pii` |

### Settings / Health Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `worker_settings` | Agenda defaults (single row) | `poll_interval_seconds`, `max_retries`, `default_fallback_model`, `scheduling_interval_minutes`, `sidebar_activity_count`, `instance_name` |
| `service_health` | Service heartbeats | `name`, `status`, `pid`, `last_heartbeat_at`, `last_error` |

### Notification Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `notification_channels` | Channel config | `id`, `workspace_id`, `user_id`, `provider`, `target`, `enabled`, `events` |

---

## 📜 Scripts Reference

| Script | Purpose | Type |
|---|---|---|
| `mc-services.sh` | Service supervisor — start/stop/restart/status/watchdog | Bash |
| `install.sh` | Full bootstrap: clone, .env, Docker DB, npm, build | Bash |
| `update.sh` | Pull + npm install + schema + rebuild + restart | Bash |
| `clean.sh` | Wipe DB, Docker volumes, .runtime, rebuild from scratch | Bash |
| `dev.sh` | Dev mode with Ctrl+C cleanup trap | Bash |
| `db-init.sh` | Docker init container entrypoint — applies schema | Bash |
| `db-setup.mjs` | DB migrations (assert schema, seed, reset) | Node.js |
| `gateway-sync.mjs` | One-shot import of agents + sessions from gateway | Node.js |
| `bridge-logger.mjs` | Persistent file watcher → agent_logs ingestion | Node.js |
| `agenda-scheduler.mjs` | RRULE expansion + cron job creation + fallback | Node.js |
| `prompt-renderer.mjs` | Composes unified task message from event + process | Node.js |
| `runtime-artifacts.mjs` | Artifact dir management (scan, cleanup) | Node.js |
| `agenda-selfcheck.mjs` | Health check: schema, gateway, stuck occurrences | Node.js |
| `agenda-domain.mjs` | Agenda state transition helpers | Node.js |
| `agenda-codes.mjs` | Agenda event code/ID utilities | Node.js |
| `agenda-schema-check.mjs` | Schema assertion helpers | Node.js |
| `openclaw-config.mjs` | Reads gateway token from openclaw.json | Node.js |
| `agenda-integration-test.mjs` | Full integration test harness | Node.js |

---

## 🔧 Troubleshooting

| Issue | Diagnosis | Fix |
|---|---|---|
| Calendar shows blue for events that aren't running | `queued` status was incorrectly colored blue (pre-v2.8) | Update to v2.8+ — `queued` is now grey; only `running` is blue |
| `scheduled` events never become `queued` | Scheduler not running | `bash scripts/mc-services.sh status` → restart agenda-scheduler |
| `cron.add: schedule.at is in the past` | Scheduler tried to create a cron job for a past timestamp | Fixed in v2.7 — scheduler now uses `--at 30s` for timestamps < 30s away |
| `pairing required` when running `openclaw cron` | Gateway pairing not approved | Run `openclaw doctor --fix` or approve CLI device in `~/.openclaw/devices/` |
| Occurrence stuck in `scheduled` (no `cron_job_id`) | Scheduler error — check `.runtime/logs/agenda-scheduler.log` | Restart scheduler: `bash scripts/mc-services.sh restart agenda-scheduler` |
| Output tab empty after successful run | `agenda_run_steps` not populated | Check bridge-logger is running; verify `~/.openclaw/cron/runs/*.jsonl` exists |
| Artifact files not appearing in Output tab | Agent didn't write to the artifact path | Agent must write to `<OPENCLAW_HOME>/runtime-artifacts/agenda/<eventId>/occurrences/cron/runs/<runId>/` |
| All services show STOPPED | .env not loaded by mc-services.sh | `set -a && source .env && set +a && bash scripts/mc-services.sh start` |
| DB connection refused | Docker PostgreSQL not running | `docker compose up -d db` |
| Port 3000 stuck | Next.js server didn't exit cleanly | `pkill -f next-server; fuser -k 3000/tcp` |
| bridge-logger OFFSETS reset / logs duplicated | Offset file was corrupted | Delete `.runtime/bridge-logger/offsets.json` — bridge-logger will rescan from start |
| `needs_retry` occurrence won't retry | Manual retry requires occurrence to be in needs_retry/failed | Click the "Retry" button in occurrence detail sheet |
| Kanban board not updating in real-time | SSE connection dropped | Refresh page to reconnect; check `/api/events` SSE stream |
| gateway-sync shows STOPPED | Normal — it's a one-shot script, not a daemon | It runs once at startup then exits |
| Logs tab shows no data | bridge-logger not watching the right paths | Verify `OPENCLAW_HOME`, `AGENTS_DIR`, `GATEWAY_LOG_DIR` in env match actual filesystem |

---

## 🔄 Services (`mc-services.sh`)

All services run natively on the host. **Docker only runs PostgreSQL.**

### Commands

```bash
bash scripts/mc-services.sh start              # Start all 4 services + watchdog
bash scripts/mc-services.sh start --dev       # Start all, Next.js in dev mode
bash scripts/mc-services.sh stop              # Stop all services
bash scripts/mc-services.sh stop <service>    # Stop specific service
bash scripts/mc-services.sh restart          # Stop then start all
bash scripts/mc-services.sh restart <service> # Restart single service
bash scripts/mc-services.sh status            # Show running status + last log lines
bash scripts/mc-services.sh watch             # Start watchdog manually
```

### Watchdog

Built into `mc-services.sh`. Checks every 30 seconds (configurable via `WATCHDOG_INTERVAL` env var). Restarts any crashed service (except `gateway-sync`, which is intentionally not auto-restarted). All events logged to `.runtime/logs/watchdog.log`.

### Service Dependency Graph

```
mc-services.sh
    ├── nextjs ──────────────────────────► port 3000 (user-facing)
    ├── gateway-sync ────────────────────► exits after 1 run (no watchdog)
    ├── bridge-logger ───────────────────► writes to agent_logs
    │       watches: sessions/*.jsonl
    │              gateway .log
    │              cron/runs/*.jsonl
    └── agenda-scheduler ────────────────► runs openclaw cron jobs
            │                            listens: pg_notify('agenda_change')
            └── bridge-logger ───────────► emits pg_notify on result
```

---

## 🌍 Environment Variables

### Database

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes* | — | PostgreSQL connection string (`postgres://user:pass@host:5432/db`) |
| `OPENCLAW_DATABASE_URL` | Yes* | — | Alias for `DATABASE_URL` (OpenClaw convention) |

*One of these is required. Set automatically by `install.sh`.

### OpenClaw Gateway

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENCLAW_HOME` | No | `~/.openclaw/` | OpenClaw config directory |
| `OPENCLAW_GATEWAY_URL` | No | `ws://127.0.0.1:18789` | Gateway WebSocket URL |
| `OPENCLAW_GATEWAY_TOKEN` | No | auto-discovered | Gateway auth token (read from `openclaw.json` by default) |

> **Note:** Do NOT set `OPENCLAW_GATEWAY_URL` or `OPENCLAW_GATEWAY_TOKEN` manually unless OpenClaw 4.x pairing is failing. The install script auto-discovers these from `~/.openclaw/openclaw.json`.

### Application

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `API_USER` | Yes | — | Basic auth username for `/api/*` routes |
| `API_PASS` | Yes | — | Basic auth password for `/api/*` routes |
| `NODE_ENV` | No | `production` | `production` or `development` |
| `PORT` | No | `3000` | Next.js listen port |
| `POSTGRES_PASSWORD` | Yes | — | PostgreSQL password (also in `DATABASE_URL`) |

### Agenda / Scheduler

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AGENDA_LOOKAHEAD_DAYS` | No | `14` | How many days ahead to expand RRULE |
| `WATCHDOG_INTERVAL` | No | `30` | Watchdog check interval in seconds |

---

## 🌱 Bootstrap (Fresh Machine)

```bash
curl -fsSL https://raw.githubusercontent.com/kenandevx/mission-control/main/scripts/install.sh | bash
```

This runs:
1. Clone repository (if not present)
2. Create `.env` from `.env.example`
3. `docker compose up -d db` — start PostgreSQL
4. Run `db-setup.mjs` — apply schema, seed data
5. `npm install`
6. `npm run build`
7. `mc-services.sh start` — start all services + watchdog

After install, open **http://localhost:3000** and follow the setup wizard to pair with the OpenClaw gateway.

---

## License

Part of the [OpenClaw](https://github.com/openclaw/openclaw) project.
