# OpenClaw Mission Control v1.5.0

Local-first dashboard for OpenClaw — boards, agent scheduling, real-time logs, and execution management.

## Quick Start

```bash
# Install (clone + env + DB + build — everything in one command)
curl -fsSL https://github.com/kenandevx/mission-control/main/install.sh | bash

# Development
npm run dev            # Start DB + all services + Next.js dev server
npm run dev:stop       # Stop DB + services (graceful)
npm run dev:kill       # Force-kill everything (zombie processes, stuck ports)

# Production
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
| `/logs` | Live log explorer, job queues, and service management |
| `/approvals` | Pending plan approval queue |
| `/settings` | Theme, notifications, agenda settings (concurrency, execution window, auto-retry, fallback model, max retries), system updates, clean reset, uninstall |

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
bash scripts/mc-services.sh status               # Check what's running
bash scripts/mc-services.sh start                # Start all services
bash scripts/mc-services.sh stop                 # Stop all services
bash scripts/mc-services.sh restart              # Restart all
bash scripts/mc-services.sh restart agenda-worker # Restart single service
bash scripts/mc-services.sh start task-worker    # Start single service
bash scripts/mc-services.sh stop nextjs          # Stop single service
```

### Agent Discovery

Agents appear in Mission Control through two paths:
1. **gateway-sync** — imports all agents from the OpenClaw gateway on startup
2. **bridge-logger** — creates agents on-the-fly when it sees new log entries from unknown agents

Agent data (name, model, emoji, status) is read from each agent's `IDENTITY.md` file in `~/.openclaw/agents/<id>/`.

### Telegram Notifications

The task-worker and agenda-worker send Telegram notifications for lifecycle events (start, completion, failure, retry, long-running alerts). Chat ID is discovered from OpenClaw's session files — no manual config needed.

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
- **Execution windows**: configurable per-ticket window (default 60 min) — tickets that miss the window are marked `expired`
- **Fallback models**: if primary model hits rate limits (429/quota), worker auto-retries with configured fallback model
- **Postgres claim locks**: prevents duplicate ticket execution across workers
- **Ticket locking**: cannot edit a ticket while it's executing
- **Failed tickets bucket**: collapsible UI section showing failed/needs_retry/expired tickets with retry buttons
- **Telegram notifications**: automatic alerts for needs_retry, failed, and expired tickets
- **Confirmation dialogs**: delete and copy board actions require explicit confirmation
- New statuses: `needs_retry` (manual intervention required after max retries), `expired` (missed execution window)

### Agenda (Calendar Scheduler)
- Month / Week / Day views with event pills
- **Real-time updates via SSE**: PostgreSQL LISTEN/NOTIFY → Server-Sent Events (no polling)
- **Timezone-aware rendering**: events display on the correct day in the user's timezone (CET/CEST, not GMT+1)
- **DST-safe RRULE expansion**: recurring events keep their local time across daylight saving changes (02:08 CET stays 02:08 CEST)
- **DB-time execution window check**: uses `SELECT now()` from Postgres, not worker's local clock — avoids clock skew
- **Date-range-per-view**: month/week/day views each fetch their exact visible range (with ±1 day buffer for timezone edge cases)
- Multi-step creation wizard: Type → Details → Schedule → Review
- **Simulation on Review step**: test-run the full event (free prompt + attached processes) before creating it, with full cleanup support (files + chat history)
- One-time (date + time) or Repeatable (daily/weekly with RRULE)
- Free prompt and/or attached processes per event
- Agent + model override per event
- **Copy/duplicate events**: opens the create modal pre-filled with the original event's data
- **Per-occurrence data isolation**: clicking a recurring event on a specific date shows only that date's schedule, runs, and output — never cross-pollinated from other dates
- **Per-occurrence status**: each day of a recurring event shows its own run status (succeeded/running/failed), not the global latest
- **Run duration display**: calendar pills show how long each run took (e.g., "✓ Done · 2m 15s") or how long it's been running
- **Duration card in overview**: shows total run time with start/finish timestamps and in-progress indicator
- **Output tab**: view agent responses with markdown rendering per run step, with step metadata (process, skill, agent, description, time)
- **Runs → Output navigation**: clicking a run card auto-switches to the Output tab with a "View output →" hover hint
- **Artifact capture**: agent-generated files saved to disk and downloadable from event details
- **Cumulative step context**: each process step receives previous step outputs
- Recurring edit scope: "Only this occurrence" or "This and all upcoming"
- **Two-option delete for recurring events**: "Only this occurrence" / "Delete all future events"
- **3-dot action menu**: Edit, Duplicate, Force Retry, Delete in a single dropdown (with disabled states and tooltips)
- **Color-coded status badges**: green (active/succeeded), amber (running), red (failed/needs_retry), blue (scheduled/recurring), with Radix tooltips explaining each status
- Stale lock recovery (occurrences stuck >15min → `needs_retry` + Telegram alert, user decides)
- **Now indicator**: current time line in week/day views (behind events, not overlapping)

### Resilient Job Orchestration (v1.5.0)

#### Retry Flow (Agenda Events)

When an agenda event runs:

```
Step 1: Execute all steps (free prompt + attached processes)
   ↓ succeeded? → done ✅
   ↓ failed?
Step 1.5: Cleanup failed attempt (Qdrant → session → files)
   ↓
Step 2: Auto-retry (clean slate, same model, instant)
        Retries up to max_retries times (default: 1)
   ↓ succeeded? → done ✅
   ↓ failed? → cleanup again
   ↓ all auto-retries failed?
Step 3: Fallback model retry (if configured)
   ↓ succeeded? → done ✅
   ↓ failed? → cleanup again
Step 4: needs_retry + Telegram alert
        → User decides: Retry / Edit / Delete
```

**Settings (configurable in /settings):**
| Setting | Default | What it does |
|---|---|---|
| Concurrency | 5 | Max parallel agenda jobs (1–10) |
| Execution Window | 30 min | How late a job can start; past this → `needs_retry` + Telegram alert |
| Max Retries | 1 | How many instant auto-retries before trying fallback (0 = no auto-retry) |

**Per-event settings (in event modal):**
| Setting | What it does |
|---|---|
| Fallback Model | Model to use after all retries fail (e.g. `openrouter/openai/gpt-5.4-mini`) |
| Agent | Which OpenClaw agent runs this event |
| Model Override | Override the agent's default model for this event |

#### Retry Flow (Kanban Tickets)

Same flow as agenda events, now with full cleanup/lock/recovery parity:
```
Step 1: Snapshot agent session + acquire per-agent lock
   ↓ lock held? → re-queue with 30s delay (not failed)
   ↓
Step 2: Execute ticket via assigned agent
   ↓ succeeded? → done, move to Completed ✅
   ↓ failed?
Step 3: Auto-retry (same model, instant, up to max_retries times)
   ↓ succeeded? → done ✅
   ↓ all retries failed?
Step 4: Fallback model (if ticket has one set) → one more try
   ↓ succeeded? → done ✅
   ↓ failed?
Step 5: 3-phase cleanup (Qdrant → session → files)
   ↓
Step 6: Set status to "needs_retry"
        → Telegram notification sent
        → User decides: Edit / Retry Now / Delete
```

Tickets now use the full resilience stack:
- **DB-time execution window check** (default 60 min) — missed window → `needs_retry` (not `expired`)
- **Postgres claim lock** — same as agenda, prevents duplicate execution
- **Per-agent execution locks** — prevents concurrent ticket+agenda execution on same agent
- **Session snapshots + 3-phase cleanup** — identical to agenda: Qdrant memories → session truncation → file deletion
- **5-minute long-running alert** — Telegram notification when ticket executes >5 min
- **Stale ticket recovery** — every 5 min, tickets stuck in `executing` >15 min → `needs_retry` + Telegram alert
- **Crash recovery** — pending cleanups re-run on worker startup
- **max_retries from Settings** — shared with agenda events

#### What Happens When...

**Ticket execution fails and cleanup runs:**
1. All retries exhausted (including fallback model if set)
2. Worker runs 3-phase cleanup: Qdrant memories → session truncation → file deletion
3. Agent's main session file truncated to pre-execution state (agent has no memory of the failed run)
4. Memory entries created during the run are deleted from Qdrant
5. Files created during the run (in allowed paths) are deleted
6. Cleanup details saved to `tickets.cleanup_details` jsonb column
7. Status set to `needs_retry` → Telegram alert → user decides

**Ticket stuck as "executing" for >15 min (stale recovery):**
1. Task worker runs `recoverStaleTickets()` every 5 minutes
2. Finds tickets with `execution_state = 'executing'` and `updated_at` older than 15 min
3. Sets them to `needs_retry` + writes activity log entry
4. Sends Telegram alert for each: "Stuck executing >15min — retry manually"
5. Also cleans up stale agent execution locks (>20 min old)

**Two tickets for same agent queued simultaneously (per-agent lock):**
1. First ticket acquires per-agent execution lock (`agent_execution_locks` table)
2. Second ticket sees lock is held → re-queued via BullMQ with 30s delay (not failed)
3. After first ticket completes → lock released in finally block → second ticket picks up
4. No concurrent execution on the same agent, no context pollution

**Cleanup crashes mid-way for a ticket:**
1. `cleanup_status` was set to `'pending'` on the ticket before cleanup started
2. On worker restart, `recoverPendingCleanups()` finds tickets with `cleanup_status = 'pending'`
3. Re-runs cleanup (all operations are idempotent — safe to repeat)
4. Session truncation: if already truncated, file size ≤ offset → no-op
5. Qdrant delete: deleting non-existent points is a no-op
6. File delete: missing files are silently skipped

**Agent session snapshot/restore on ticket failure:**
1. Before execution, worker snapshots the agent's session file byte offset
2. Snapshot saved to `tickets.session_snapshots` jsonb column (survives worker crash)
3. On failure: session file truncated back to snapshot offset → agent has zero memory of failed attempt
4. JSONL session files are append-only, so truncation cleanly removes only appended messages
5. Only affects the agent's main session — Telegram sessions are separate files, never touched

**Event or ticket fails:**
1. Worker auto-retries instantly (up to `max_retries` times, default 1)
2. If still failing and fallback model is configured → tries once with fallback
3. If that also fails → status = `needs_retry`, Telegram alert, user decides

**Event is stuck / running too long (>5 min):**
1. At 5 minutes: Telegram alert sent to your chat with event name, attempt number, start time
2. Retry button always available — user can force-retry at any time
3. Force-retry marks the current attempt as failed and re-queues the event

**Event misses its execution window:**
1. Worker picks up the job but notices it's past the window (default 30 min)
2. Status set to `needs_retry` (not `expired` — so you can retry immediately)
3. Telegram alert: "missed execution window — needs manual retry"
4. Click "Retry" in Mission Control → re-queues instantly, ignores window check

**Worker crashes or restarts during execution:**
1. Occurrence stays in "running" state with a stale lock
2. After 15 minutes: stale lock recovery sets it to `needs_retry` + Telegram alert — never auto-re-executes
3. User decides: Force Retry / Edit / Delete from the event details (available any time)
4. Same behavior for tickets: stuck executions → `needs_retry` after stale lock timeout

**Event fails and cleanup runs:**
1. All retries exhausted (including fallback model if set)
2. Worker runs 3-phase cleanup: Qdrant memories → session truncation → file deletion
3. Agent's main session file truncated to pre-execution state (agent has no memory of the failed run)
4. Memory entries created during the run are deleted from Qdrant
5. Files created during the run (in allowed paths) are deleted
6. Cleanup details logged in `agenda_run_attempts.cleanup_details`
7. Status set to `needs_retry` → Telegram alert → user decides

**Cleanup crashes mid-way (worker dies during cleanup):**
1. `cleanup_status` was set to `'pending'` before cleanup started
2. On worker restart, `recoverPendingCleanups()` finds pending cleanups
3. Re-runs cleanup (all operations are idempotent — safe to repeat)
4. Session truncation: if already truncated, file size ≤ offset → no-op
5. Qdrant delete: deleting non-existent points is a no-op
6. File delete: missing files are silently skipped

**Same agent has two agenda events scheduled at the same time:**
1. First job acquires per-agent execution lock
2. Second job sees lock is held → re-queued with 30s delay (not failed)
3. After first job completes → lock released → second job picks up
4. No concurrent execution on the same agent, no context pollution

**Two workers try to pick up the same job:**
1. Postgres claim lock (`UPDATE ... WHERE status IN ('scheduled','queued','needs_retry')`)
2. Only the first `UPDATE` succeeds (returns 1 row), the other gets 0 rows and skips
3. No duplicate execution possible

**User clicks "Retry" while auto-retry is already scheduled:**
1. Manual retry changes status to `scheduled` via API
2. Worker claim lock ensures only one execution starts
3. No race condition — whichever pickup succeeds first runs, other skips

**Primary model hits rate limit (429/quota):**
1. Step fails normally — enters the standard retry flow
2. Auto-retries with same model (will likely fail again if rate limit persists)
3. Then fallback model if set, then `needs_retry` — user decides (wait for rate limit to clear, change model, or retry later)

**Database goes down during execution:**
1. Worker can't write step results — attempt fails with DB error
2. Occurrence set to `needs_retry` (if the catch block can still reach DB)
3. If DB is fully unreachable — worker crashes, stale lock recovery handles it when DB comes back
4. Never auto-re-executes — user decides when to retry

**Redis goes down:**
1. BullMQ can't enqueue or consume jobs — scheduler skips cycles, worker stalls
2. Events stay as `scheduled` in Postgres — no data loss
3. When Redis recovers, scheduler picks them up on next cycle
4. If they're past the execution window → `needs_retry` (not auto-executed)
5. User retries manually — retry resets `scheduled_for` to now, so window passes

**Fallback model is the same as primary:**
1. Not detected — worker retries with the "fallback" which is the same model
2. Burns one retry cycle doing the same thing
3. Recommendation: set a different model as fallback, or leave empty

**Event/ticket is deleted while a retry is pending:**
1. DB update returns 0 rows (ticket gone)
2. Worker silently skips — no crash, no error
3. Any timers (alert, auto-retry) clear themselves

**Agent is changed while retry is pending:**
1. Worker reads `assigned_agent_id` fresh from the job data each attempt
2. For agenda events: agent ID is baked into the job → stays the same until re-queued
3. For tickets: next pickup reads the latest agent from DB → uses new agent

**Recurring event — one day fails, others succeed:**
1. Each day gets its own independent occurrence with its own status
2. Monday can be "succeeded", Tuesday "needs_retry", Wednesday "scheduled"
3. Clicking a day shows only that day's runs — no cross-pollination

**SSE connection drops (browser loses real-time updates):**
1. EventSource auto-reconnects after 5 seconds
2. On reconnect: full refresh of events + failed count
3. No data loss — DB is the source of truth

**Service crashes (worker, scheduler, bridge-logger):**
1. Watchdog detects within 30s → auto-restart → service resumes
2. In-flight jobs: occurrence stays 'running' with stale lock → after 15 min, stale recovery sets to 'needs_retry'
3. No data loss, no auto-re-execution

**OpenClaw gateway goes down during execution:**
1. `openclaw agent` command fails → step fails → enters retry flow
2. If gateway stays down through all retries → needs_retry
3. Gateway coming back up doesn't affect Mission Control services — they reconnect automatically
4. Watchdog ensures services stay alive

**All services crash at once (e.g., server reboot):**
1. `mc-services start` brings everything back
2. Watchdog starts automatically
3. Stale lock recovery cleans up any in-flight work
4. Pending cleanups resume
5. No data loss

**Worker was down for hours, events piled up:**
1. Scheduler may have created occurrences + enqueued jobs to Redis while worker was dead
2. On restart, worker picks up all queued jobs
3. Each job hits the execution window check (default 30 min)
4. Jobs that are past the window → `needs_retry` immediately (NOT auto-executed)
5. Telegram alert for each: "missed execution window"
6. You decide: Retry (runs now) / Edit / Delete

**Multiple needs_retry events, user clicks Retry on all at once:**
1. All re-queued to Redis simultaneously with fresh timestamps
2. Same-agent events: per-agent lock serializes them (one at a time, 30s re-queue delay)
3. Different-agent events: run fully in parallel
4. Each gets its own snapshot + cleanup cycle
5. No conflicts, no data loss — they queue up and run in order

**User edits an event while it's running:**
1. Edit button shows "Edit (running)" and is disabled
2. Tooltip explains why
3. Must wait for completion or force-retry first

**All notifications sent via Telegram:**
| Event | Message |
|---|---|
| Running >5 min | ⏱️ Long-running alert with event name + attempt + duration |
| Missed window | ⚠️ Missed execution window (Xm late) |
| All retries exhausted | ⚠️ Needs manual retry |
| Auto-retry triggered | 🔄 Exceeded time limit, needs manual retry |
| Fatal error | ❌ Event failed with error message |

#### Automatic Cleanup on Failure

When an agenda event fails (after all retries are exhausted), the worker automatically cleans up the side effects of the failed execution. This prevents polluted agent context, stale files, and orphaned memory entries.

**3-Phase Cleanup (runs in order):**

```
Phase 1: Qdrant Memory Cleanup
  → Read session file bytes appended during execution
  → Parse for memory_store tool results containing returned IDs
  → Delete those memory entries from Qdrant via REST API
  → Idempotent: safe to re-run (deleting non-existent points is a no-op)

Phase 2: Session File Truncation
  → Truncate agent's main session file back to pre-execution byte offset
  → JSONL is append-only, so this cleanly removes only the appended messages
  → Only affects agent:X:main session (used by the worker)
  → Telegram messages go to a DIFFERENT session file — never affected

Phase 3: File Deletion
  → Delete files created during the failed attempt (ctime > attempt start)
  → Only files in allowed paths: /home/clawdbot/, /storage/, /tmp/
  → Files are checked individually — missing files are silently skipped
```

**Per-Agent Execution Locks:**
- Before execution, the worker acquires a per-agent lock (`agent_execution_locks` table)
- Prevents concurrent agenda tasks from running on the same agent simultaneously
- If lock is held: job re-queued with 30s delay (no failure, no lost work)
- Locks auto-released after execution (success or failure, in finally block)
- Stale locks (>20 min) are force-deleted during periodic recovery

**Crash Recovery:**
- Session snapshots and cleanup status stored in `agenda_run_attempts`
- If worker crashes mid-cleanup (`cleanup_status = 'pending'`), recovery runs on next startup
- All cleanup operations are idempotent — safe to re-run after crash
- Cleanup details (deleted memories, files, errors) logged in `cleanup_details` jsonb column

**What gets cleaned up:**
| Artifact | Cleaned? | Method |
|---|---|---|
| Agent session messages | ✅ | Session file truncation to pre-execution byte offset |
| Qdrant memory entries | ✅ | Delete by ID via Qdrant REST API |
| Created files | ✅ | Delete files with ctime after attempt start |
| Artifact copies in /storage | ❌ | Preserved for debugging (artifacts are copies, not originals) |
| DB run attempt records | ❌ | Preserved for audit trail |

#### Safety mechanisms
- **Postgres claim locks**: prevent duplicate execution across workers
- **Stale lock recovery**: stuck occurrences (>15 min) set to `needs_retry` with Telegram alert — never auto-re-executed
- **Service heartbeats**: workers report health every 30 seconds to `service_health` table
- **Correct attempt numbering**: always reads max(attempt_no) from DB before creating new attempt
- **Cumulative context**: each process step receives previous outputs for coherent multi-step execution

### Live Activity Sidebar
- Unified real-time activity feed in the global sidebar
- Shows the last 8 events from **both** the ticket system and agenda system
- Powered by a unified SSE endpoint (`/api/notifications/stream`) that listens on `ticket_activity` and `agenda_change` pg_notify channels
- Each entry shows: colored level dot, event name, item title, relative timestamp
- "Live" indicator with green/amber connection status dot
- Entries animate in with subtle fade+slide
- Color-coded by level: emerald (success), red (error), amber (warning), blue (info)
- Works in both expanded and collapsed sidebar states
- **Singleton SSE connection**: EventSource lives at module level, survives React remounts — no reconnect flicker when switching pages, entries persist across navigation

### Service Health Monitoring
- All workers report heartbeats to the `service_health` table every 30 seconds
- **Services tab** in the Logs page with per-service status cards, PID monitoring, start/stop/restart controls, and log viewer
- **Per-service management**: `mc-services start agenda-worker`, `mc-services restart task-worker`, etc.
- Notification provider polls for service status changes
- API endpoint (`/api/services`) for service management and log access

### Service Watchdog
- `mc-services.sh` includes a background watchdog process
- Checks all services every 30 seconds
- Auto-restarts any crashed service (except `gateway-sync` which is one-shot)
- Started automatically with `mc-services start`, stopped with `mc-services stop`
- Manual start: `mc-services watch`
- Logs: `.runtime/logs/watchdog.log`
- If a service repeatedly crashes, watchdog keeps restarting it — check the service log for root cause

### 15-Minute Scheduling Rule
- Events can only be scheduled at 15-minute intervals (XX:00, XX:15, XX:30, XX:45)
- **One event per time slot** — no two events can share the same 15-min slot
- Maximum 4 events per hour
- Enforced in both UI (time selector dropdown) and API (validation rejects non-15-min times + duplicate slots)
- Reduces scheduling conflicts and gives each event adequate execution time
- Recurring events follow the same rule — time is always on a 15-min boundary

### Processes
- Card grid layout with create, edit, duplicate, delete, **simulate**
- **Delete safety**: if a process is tied to agenda events, shows a warning listing affected events; on confirm, cancels all future occurrences and deactivates the events (past runs preserved)
- Multi-step editor wizard: Info → Steps → Review (with step validation — can't skip ahead until previous steps are valid)
- Per-step: instruction, skill, agent, model override
- Version tracking with labels
- Clicking a process card opens edit with existing data pre-filled
- **Simulation mode**: dry-run a process or agenda event before saving
  - Available from the Review step in both the process editor and the agenda event modal
  - Clicking "Run Simulation" opens the simulation modal and auto-starts execution
  - Runs each step live via SSE — shows step-by-step progress with loading indicators
  - Displays full agent output per step with markdown rendering
  - Detects files created during simulation (path regex across agent output)
  - Steps run with `[SIMULATION MODE]` prefix in the instruction so agents know not to make permanent changes
  - **Full cleanup** — the "Cleanup All" button removes every trace of the simulation:
    1. **Files**: deletes all files created during simulation (allowed paths: `/home/clawdbot/`, `/storage/`, `/tmp/`)
    2. **Agent chat history**: restores agent session files to their exact pre-simulation state by truncating appended simulation messages (byte-offset snapshot/restore — the agent literally has no memory of the simulation)
  - **How cleanup works internally**: before the simulation starts, the API snapshots the byte size of each involved agent's session file (JSONL, append-only). After simulation, cleanup truncates each file back to its pre-sim byte offset, surgically removing only the simulation messages while preserving all prior conversation history

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
failed → [instant retry] → executing → done
                         → failed → [fallback model if set] → executing → done
                                                             → needs_retry → [manual retry] → queued → ...
```

No agent assigned = manual ticket (never auto-queued).

## Agenda Event Lifecycle

```
draft → [activate] → active
active → [scheduler] → occurrence created (scheduled)
scheduled → [worker claims] → running → succeeded ✅
         → [missed window] → needs_retry → [manual retry] → scheduled → ...

running → succeeded ✅
        → failed → [auto-retry 1..N times] → succeeded ✅
                                            → [fallback model if set] → succeeded ✅
                                                                      → [cleanup: Qdrant → session → files]
                                                                      → needs_retry → [user: retry/edit/delete]
        → [>5 min] → Telegram alert (still running, user decides)
        → [force retry] → current attempt failed → re-scheduled → running → ...
```

Recurring events: each date gets its own independent occurrence (unique `occurrence.id`) and run history. The parent `event.id` is shared across the series, but each day's execution, status, and output are fully isolated. The UI shows the occurrence ID (not the event ID) for recurring events. Editing "only this occurrence" creates an override without affecting other dates.

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
| `/api/agenda/events/stream` | GET | SSE stream for real-time agenda updates (via pg_notify) |
| `/api/agenda/events/[id]` | GET/PATCH/DELETE | Single event operations |
| `/api/agenda/events/[id]/occurrences/[occId]` | POST/DELETE | Retry or dismiss an occurrence |
| `/api/agenda/events/[id]/occurrences/[occId]/runs` | GET | Run attempts + steps for an occurrence |
| `/api/agenda/artifacts/[stepId]/[filename]` | GET | Download agent-generated artifacts |
| `/api/agenda/failed` | GET | Failed/needs_retry/expired occurrences |
| `/api/agenda/stats` | GET | Agenda statistics |
| `/api/processes` | GET/POST | Process CRUD |
| `/api/processes/[id]` | GET/PATCH/DELETE | Single process operations |
| `/api/processes/simulate` | POST | SSE stream — simulate a process step-by-step (snapshots session state before run) |
| `/api/processes/simulate/cleanup` | POST | Full cleanup: delete files + restore agent sessions to pre-sim state |
| `/api/services` | GET/POST | Service health monitoring and management |
| `/api/agents` | GET | Agent discovery (reads from DB + runtime) |
| `/api/skills` | GET | Workspace skills list |
| `/api/system` | POST | System management (update, reset, uninstall) |
| `/api/notifications/stream` | GET | Unified SSE stream (ticket + agenda activity for sidebar) |
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
| Occurrence stuck as "running" | Use Force Retry button in event details (3-dot menu) |
| Events on wrong calendar day | Timezone edge case — fixed with ±1 day RRULE buffer (v1.4.0) |
| All recurring days show same status | Fixed in v1.4.0 — per-occurrence status matching |
| Duplicate attempt numbers | Fixed in v1.4.0 — retry reads max(attempt_no) from DB |
| Agenda output tab crashes | Fixed in v1.2.1 — `output_payload` jsonb handling |
| Ticket file attachments missing | Worker auto-attaches files from agent response (v1.2.1+) |
| Zombie processes after Ctrl+C | `npm run dev:kill` cleans up everything |
| Double scrollbar on agenda page | Fixed in v1.4.0 — controlled max-height on time grids |
| Tooltips not showing | Fixed in v1.4.0 — uses Radix Tooltip instead of native title attribute |
| Services all stopped | `mc-services start` — watchdog auto-restarts on future crashes |
| Cleanup status stuck as 'pending' | Worker restart triggers `recoverPendingCleanups()` automatically |
| Agent lock stuck | Stale lock recovery runs every 5 min, force-deletes locks >20 min old |

## Database

Schema managed by `scripts/db-init.sh` (Docker) and `scripts/db-setup.mjs` (Node).

Key tables: `workspaces`, `boards`, `columns`, `tickets`, `ticket_attachments`, `ticket_subtasks`, `ticket_comments`, `ticket_activity`, `agents`, `agent_logs`, `agenda_events`, `agenda_occurrences`, `agenda_run_attempts`, `agenda_run_steps`, `processes`, `process_versions`, `process_steps`, `worker_settings`, `service_health`, `agent_execution_locks`.

Reset everything: `npm run db:reset` or `bash scripts/clean.sh`.

## License

Part of the [OpenClaw](https://github.com/openclaw/openclaw) project.
