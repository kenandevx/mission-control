# Mission Control Changelog

This file tracks notable product and engineering changes so `README.md` can stay focused on overview, setup, and usage.

## 2026-04-03 — v2.7

### Agenda / scheduler reliability
- Fix `cron.add INVALID_REQUEST` when scheduled time is already past — now uses `--at 30s` for immediate execution
- Fix: when cron job creation fails, occurrence is now correctly set to `needs_retry` (was silently abandoned)
- Fix: event status styling on calendar — `run_started_at`/`run_finished_at` now included in all event list queries

## 2026-04-03 — v2.6

### Test suite overhaul
- Rewrote agenda test suite — 15 clean focused tests, CET timezone, no mocks

## 2026-04-03 — v2.5

### Artifact display fixes
- Fix artifact directory creation — no longer created eagerly, only when agent actually writes files
- Artifact files (images, PDFs, etc.) now correctly displayed in Output tab with download links and image previews

## 2026-04-03 — v2.4

### Output tab + retry accuracy
- Fix Output tab was empty after successful cron runs — `agenda_run_steps` now populated by scheduler
- Fix manual retry used bare prompt — now uses stored `rendered_prompt` (includes process steps)
- Settings "Max attempts before fallback" is now wired to actual fallback trigger logic
- `rendered_prompt` column added to `agenda_occurrences` for retry accuracy

## 2026-04-03 — v2.3

### Cleanup: BullMQ removal complete
- Remove Job Queues tab (BullMQ UI removed)
- Remove dead Concurrency + Execution Window settings (cron handles natively)
- Fix all stale "worker" references across tests, settings, and UI components

## 2026-04-03 — v2.2

### Watchdog fix
- Fix watchdog environment sourcing — restarted services now have DATABASE_URL available

## 2026-04-03 — v2.1

### BullMQ/Redis removal
- Remove BullMQ/Redis from all remaining files (routes, types, UI, install script)
- Remove `agenda-worker` from clean reset and service list
- `agenda-selfcheck` rewritten for cron engine

## 2026-04-03 — v2.0

### Major architecture change — cron engine replaces BullMQ/Redis
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

## 2026-04-02 — v1.6.2

### Boards simplification: manual Trello-style ticketing
- Removed board-ticket agent execution controls from UI (agent/process/fallback/execution controls, retry/start/cancel/approve/reject actions).
- Fully removed legacy board ticket worker runtime (`scripts/task-worker.mjs`) and removed task-worker from service orchestration (`mc-services`, `/api/services`, `/api/system`, install/clean flows, npm scripts).
- Simplified board ticket forms and state models to core planning fields (title, description, checklist, attachments, labels, priority, due date, assignees).
- Removed failed-ticket execution bucket/status chips from Boards workspace view.
- Removed process-loading path from Boards page and dropped obsolete modal/action props.
- Simplified `/api/tasks` board-ticket behavior to manual mode defaults (no board-ticket execution pipeline).
- Removed obsolete `/api/tasks` execution action branches for board tickets (`approvePlan`, `rejectPlan`, `startExecution`, `retryExecution`, `retryFromNeedsRetry`) and removed `listProcesses` branch from this route.
- Updated README sections to reflect Boards manual-ticketing mode and marked legacy approval/worker references accordingly.
- Fixed runtime crash in `TicketDetailsModal` caused by leftover `isLocked` reference after execution-control removal.
- Replaced modal image preview `<img>` with `next/image` for cleaner Next.js linting.
- Cleaned type/lint issues in `hooks/use-tasks` (removed `any` usage in board hydration, stabilized memo dependencies).

## 2026-04-02 — v1.6.1

### Agenda reliability + retry hotfixes
- Fixed scheduler/worker failures caused by schema drift by aligning `agenda_occurrences` with required runtime columns (`queue_job_id`, `queued_at`, `retry_requested_at`, `last_retry_reason`).
- Added explicit schema assertions in both `agenda-scheduler` and `agenda-worker` startup paths (fail-fast by default; optional legacy override via `AGENDA_ALLOW_LEGACY_SCHEMA_FALLBACK=1`).
- Added shared agenda constants (`lib/agenda/constants.ts`) to centralize status/retryable-state definitions.
- Hardened scheduler and worker behavior for mixed-schema environments to avoid crash loops while migrating.
- Fixed manual retry endpoint failure when `retry_requested_at` was missing; retry now succeeds again from the Agenda modal.
- Retry API now returns explicit action metadata (`retry_requested` / `force_retry_requested`) for cleaner client handling.
- Fixed retry UX silent-failure path in Agenda UI by surfacing success/error toasts.
- Expanded retry eligibility to include stuck `queued`/`scheduled` occurrences so manual recovery works from modal controls.
- Fixed failed-count and failed-bucket logic to use the **latest occurrence per event** (prevents historical failed attempts from inflating current failed stats).
- Added `npm run agenda:selfcheck` to validate schema, queue health, lock health, and failed-latest-event count in one check.
- Added shared reason-code helpers (`scripts/agenda-codes.mjs`) to keep worker/scheduler failure reasons consistent.
- Added scheduler reconciliation for orphaned queued rows (queued with missing queue metadata) to auto-move them to `needs_retry` with explicit reason.
- Added transition helpers in `scripts/agenda-domain.mjs` and refactored core worker transitions to use them (queued / running claim / succeeded / needs_retry paths).
- Added API-side transition helper (`lib/agenda/domain.ts`) and refactored manual retry transition to use centralized domain logic.
- Added runtime transition helper module (`scripts/agenda-domain.mjs`) and moved core worker state transitions onto it.
- Added centralized retry policy module (`scripts/agenda-retry-policy.mjs`) to unify lock-retry and auto-retry decision logic.
- Removed remaining legacy column-fallback branches from core worker and scheduler paths; scheduler/worker now run strict schema mode only.
- Simplified scheduler due-occurrence query path to strict-schema single flow (removed legacy branch logic).
- Added scheduler reconciliation pass for queued rows that reference missing BullMQ jobs (auto-moves to `needs_retry` with explicit reason).
- Extended `agenda:selfcheck` to detect queued rows that reference missing BullMQ jobs.
- Added `agenda:smoke` end-to-end check to validate retry flow from injected `needs_retry` occurrence through active execution state.
- Moved stale-running recovery transition into shared agenda-domain helper to reduce duplicated state-update SQL.
- Standardized manual retry reason to machine-readable `MANUAL_RETRY` for cleaner diagnostics.
- Reduced duplicate-queue storm conditions by tightening rescue/requeue behavior and queue bookkeeping.

## 2026-04-01 — v1.6.0

### Agenda retry + execution reliability
- Added queue tracking columns to `agenda_occurrences`: `queue_job_id`, `queued_at`, `retry_requested_at`, `last_retry_reason`. These give the system explicit state for when a retry was requested, when it was queued, and why it moved to manual-retry.
- Manual retry now moves occurrence to `queued` with proper `retry_requested_at` and `last_retry_reason` set.
- Scheduler rescue pass now scans all due `scheduled`/`queued` occurrences directly from the DB and distinguishes: freshly queued (leave alone), stale queued (re-enqueue), past-window before pickup (mark `needs_retry`).
- Missed execution window before worker pickup now reliably marks occurrence `needs_retry` with a readable reason — user must manually retry.
- Fixed BullMQ priority calculation to use BullMQ-safe bounded values (max 2097152) instead of raw epoch values that could exceed BullMQ's allowed range.
- Fixed scheduler priority in `enqueueOccurrenceJob` helper to use bounded age-based priority.
- Fixed manual retry endpoint priority calculation to use BullMQ-safe bounded values.
- Replaced the duplicate/malformed trailing block in `db/schema.sql`.
- Added missing `queue_job_id`, `queued_at`, `retry_requested_at`, `last_retry_reason` columns directly to the live database.
- Restarted `agenda-scheduler` and `agenda-worker` after schema/code changes.

### Provider rejection handling
- Added explicit string matching for known provider rejection messages that should always trigger `needs_retry` / manual retry:
  - `LLM request rejected: Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.`
  - `⚠️ API rate limit reached. Please try again later.`
- These are matched at three levels: immediate step result, after each auto-retry, and after fallback model attempt.
- When triggered, `last_retry_reason` on the occurrence is set to the specific message, and the Telegram alert shows the exact rejection reason.
- Structured error detection (HTTP status / provider code) remains the primary path; string matching is the fallback when upstream provides no machine-readable signal (Gazoh confirmed string match required here).

- Fixed grace-window false `needs_retry` behavior for near-now active one-time events on create and edit.
- Preserved oldest-first retry ordering by using the original `scheduled_for` timestamp as BullMQ priority.
- Preserved retry priority when jobs are requeued due to agent-lock contention.
- Manual retries now move occurrences to `queued` after enqueue.
- Added scheduler rescue enqueue pass for due `scheduled` / `queued` occurrences directly from the database, including manual retries, test-injected occurrences, and draft-event forced runs.
- Improved `needs_retry` reason persistence for:
  - missed execution window
  - timeout-to-needs-retry
  - stale-lock recovery
  - auto-marked past events
  - exhausted retries / fatal failures
- Failed bucket now falls back to `summary` when `error_message` is empty.

### Agenda force retry + completed-run handling
- Added explicit **Force Retry** flow for already completed occurrences.
- Normal retry is rejected for already-succeeded occurrences with a clearer message.
- Force retry performs best-effort artifact cleanup before re-scheduling.
- Added force-retry confirmation UI in agenda details.

### Agenda timeout / failure handling
- Improved provider capacity / billing rejection handling with structured-first detection (HTTP/status/code) and text fallback only when needed.
- Preserved desired run flow:
  1. same-model retry
  2. fallback model if configured
  3. `needs_retry` + Telegram alert if still failing
- Improved stale-lock recovery logging and `needs_retry` reason capture.

### Agenda UI improvements
- Running cards now have stronger visual treatment and a more visible loader.
- Running badge styling improved for clearer in-progress state.

### Agenda test framework overhaul
- Test timing now reads real settings from `/api/agenda/settings`.
- Effective test timing rules:
  - unset / invalid scheduling interval → 15 minutes
  - configured value > 0 → use configured value
  - free-time mode (`0`) → use 1-minute effective test timing for fast dev runs
- Tests now reset agenda state per test by default unless `skipReset` is set.
- Added per-test approval gate so each test can pause before reset + next test.
- Added toggle in the test panel for manual approval between tests.
- Hardened run-based tests so billing/capacity rejection is a real failure and step-row existence alone never counts as success.
- Tightened skill-assignment and composed-message tests to require successful execution.
- Reworked the PDF test away from fake artifact injection toward real execution.

### Settings + system update behavior
- Fixed `/settings` update false-error path caused by restarting Mission Control inside the same HTTP request.
- Updates now return cleanly and restart services in the background.
- Blocked update while agenda occurrences are actively running.

### Scripts / install / update tooling
- Added missing `scripts/update.sh`.
- `install.sh` and `clean.sh` now always rebuild instead of trusting an existing `.next` directory.
- Installer dependency checks now align better with actual script usage.
- Uninstall cleanup now removes all Mission Control convenience symlinks.

## 2026-03-31
- File Manager page introduced for `~/.openclaw/` browsing, editing, uploads, previews, search, ownership enforcement, and safety checks.

## 2026-03-30
### Retry / artifacts / prompt rendering
- Artifact system changed so agents write directly into run-scoped artifact directories.
- Retry behavior updated to move `scheduled_for` to now on manual retry, with test-only preservation option.
- Status guard added to prevent active → draft reversion once occurrences exist.
- Runs tab removed from event details; Output now shows the latest attempt directly.
- Skill context moved into rendered prompt content instead of a non-existent CLI flag.
- Failed-events dialog, status colors, status guide popup, and scheduling interval behavior improved.
- Event deletion cleans BullMQ jobs + agent locks.
- FK violation guard added to agenda worker.
- Agenda tests overhauled to reduce scheduler dependence and improve speed / reliability.

## 2026-03-28
### Agenda + process safety
- Race guards, process deletion safety, step validation, runtime artifact governance, and unified execution message template improvements landed.
- Added multiple new agenda and process regression tests.

---

For older detailed history that was previously embedded in `README.md`, see the git history if needed.
