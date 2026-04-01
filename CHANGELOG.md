# Mission Control Changelog

This file tracks notable product and engineering changes so `README.md` can stay focused on overview, setup, and usage.

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
