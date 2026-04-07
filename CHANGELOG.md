# Changelog

All notable changes to Mission Control are documented here.

## [3.2.0] - 2026-04-07

### Fixed
- **Sidebar Live Activity click re-opened ticket modal on refresh** — clicking a ticket entry in the Live Activity sidebar was navigating to `/boards?ticket=<id>`, which a `useEffect` in `boards-page-client` read on mount to auto-reopen the modal. Clicking now dispatches a `mc:open-ticket` custom DOM event instead — the board page listens for it and opens the modal directly with no URL modification. Refreshing the page is completely clean.
- **`BoardActivityFeed` click was also writing `?ticket=` to the URL** — removed; clicking a ticket in the board's in-page activity feed no longer touches the URL.
- **Notification API was building `targetUrl` with `?ticket=<id>`** — both `/api/notifications/recent` and `/api/notifications/stream` now include `board_id` in the ticket activity query and build `targetUrl` as `/boards?board=<boardId>` only. The `ticketId` and `boardId` are exposed as separate typed fields on the `ActivityEntry` so the sidebar can route correctly without encoding ticket IDs into the URL.
- **Kanban: `updateTicket` was destroying execution state on every save** — the `updateTicket` API action hard-reset `execution_state`, `assigned_agent_id`, `execution_mode`, `plan_text`, `plan_approved`, `execution_window_minutes`, and `fallback_model` to defaults on every ticket save, regardless of which fields actually changed. Only explicitly passed fields are now updated; all other fields are preserved.
- **Kanban: ticket `updateTicket` missing `ticket_activity` audit row** — saving a ticket via the details modal now correctly writes a per-ticket activity log entry. `logTaskAudit` previously dropped `ticketId`, so the activity tab never reflected ticket edits.
- **Kanban: `moveTicket` activity log had no column names and no ticket_activity row** — the audit trail now shows `"Moved from {From List} to {To List}"` instead of the generic `"Moved to a new column."`, and `ticketId` is correctly passed so the entry appears on the ticket's activity tab.
- **Kanban: `updateColumn` had no audit trail or SSE notification** — renaming a list now logs to `activity_logs` and emits a `pg_notify('ticket_activity', ...)` event so live-connected clients can react.
- **Kanban: `createColumn` had no SSE notification** — creating a new list now emits `pg_notify('ticket_activity', 'column:created:<id>')` immediately after creation.
- **`createTicket` INSERT referenced non-existent `process_version_ids` column** — removed from the INSERT statement. Also corrected `execution_mode` default from `'direct'` to `'auto'` to match the DB schema default.
- **`toIsoDueDate` could produce malformed ISO strings** — if `scheduledFor` or `dueDate` already contained a `T` (already in ISO format), appending `T00:00:00.000Z` produced an invalid double-T date string. Fixed by detecting existing ISO strings and returning them as-is.
- **Due date input showed time component** — the date input in the ticket modal now strips to `YYYY-MM-DD` only via `.slice(0, 10)` to prevent time leakage into the field value.

### Changed
- **Kanban Integration Test panel removed** — `kanban-test-panel.tsx`, `kanban-test-definitions.ts`, and `use-kanban-tests.tsx` deleted; import and render removed from `boards-page-client.tsx`.
- **Ticket card redesigned**:
  - Left accent border colored by priority (emerald / amber / orange / rose).
  - Priority shown as a compact dot + uppercase label instead of a full outline badge.
  - Tags are pill-shaped (`rounded-full`).
  - Attachment count icon added to footer meta row.
  - Checklist done count turns emerald green when fully complete.
  - Drag ghost uses `rotate-1` + heavier shadow for clearer spatial feedback.
- **Ticket details modal improved**:
  - Checklist progress bar added to the right sidebar (visible when ticket has subtasks).
  - Priority dropdown shows colored dots alongside option labels.
  - Sidebar spacing tightened; separator between progress and fields.
- **README**: version bumped to 3.2.0.

## [3.0.0] - 2026-04-05

### Fixed
- **Agenda event card shows wrong status** (`needs_retry` even after a newer occurrence succeeded): `DISTINCT ON` query used status-priority as the primary sort key, so `needs_retry` (rank 2) always beat `succeeded` (rank 4) regardless of which occurrence was newer. Fixed by sorting `scheduled_for DESC` first and using status priority only as a tiebreaker within the same time slot.
- **Isolated run output always empty**: `resolveAgendaOutput` was calling `looksLikePromptEcho(sessionOutput, null, summaryText)` where `summaryText` for isolated runs **is** the agent's actual output — comparing the output against itself always returned a false-positive match and wiped the result to an empty string. Fixed by using `summaryText` directly as the canonical output for isolated sessions, skipping the misleading echo detection.
- **Isolated run with no output incorrectly marked succeeded**: when `run.summary` was empty, `outputSource` stayed as `cron_summary` instead of `no_output`, causing the run to count as a success with no content. Fixed by explicitly setting `outputSource = 'no_output'` when isolated summary is blank.
- **SSE stream sends stale status**: the stream handler re-queried `ao.status` from the DB after receiving a `pg_notify`, but the DB update may not have committed yet, causing the sidebar to briefly show the previous status (e.g. `running` after `succeeded`). Fixed by using the `action` field from the notification payload as the authoritative status; DB query now only fetches title and agent.
- **Live Activity shows `needs_retry` after succeeded**: same race — SSE sent a stale `needs_retry` for an occurrence that had just been marked `succeeded`. Resolved by the SSE action-based fix above.
- **Recent activity API returned future scheduled occurrences instead of past runs**: `ORDER BY scheduled_for DESC` sorted future-dated recurring occurrences (e.g. April 19) to the top, burying today's runs. Fixed with `COALESCE(last_run_at, scheduled_for) ASC` using a `LATERAL` subquery for the most recent attempt timestamp.
- **Recent activity API pulled from `agenda_run_attempts`** (only `running`/`succeeded`/`failed`) instead of `agenda_occurrences` (full canonical status set including `needs_retry`, `queued`, `auto_retry`, etc.). Sidebar now always shows canonical occurrence statuses.
- **SSE stream used `action` from pg_notify as event name but DB status for display**: now uses occurrence status for both since SSE action is the canonical source of truth.

### Changed
- **Live Activity sidebar — full overhaul**:
  - Status dot colors use exact hex values from `lib/status-colors.ts` for all agenda entries (no more generic Tailwind classes).
  - `running` and `auto_retry` dots pulse with `animate-pulse`.
  - Event labels for all canonical agenda statuses route through `statusLabel()` — single source of truth.
  - Agent field shows human-readable name (`Main agent`, `Worker`, etc.) instead of raw ID strings.
  - Title attribute on each row shows `title — status` for accessibility.
  - "just now" threshold widened from 10 s to 30 s (avoids flickering on initial page load).
  - Empty state uses italic muted text instead of a bold placeholder.
  - Connecting indicator shows "Connecting…" instead of "…".
  - Removed unused `LEVEL_CONFIG` icon imports and `Icon` references from render.
  - `dotStyle` and `labelColor` helper functions centralize all color derivation.
- **Agenda event sort order** (`/api/agenda/events`): both calendar-range and list queries now sort `scheduled_for DESC` before status priority, ensuring newest occurrence always wins.
- **Bridge-logger isolated output**: simplified to use `run.summary` directly — no session file read, no false-positive echo detection for isolated sessions.
- **`levelFromAction` in stream route**: added `queued`, `scheduled`, `cancelled`, `skipped` → `info` mappings.
- **`agendaLevelFromStatus` in recent route**: added `stale_recovery`, `force_retry`, `queued`, `scheduled`, `cancelled`, `skipped`, `draft` mappings.
- **README**: version bumped to 3.0.0, Next.js noted as v16, Live Activity Sidebar section added under Artifact Files.

## [2.8.3] - 2026-04-05

### Changed
- **Status colors darkened**: Tweaked all status hex values to be more vibrant and less pastel, still maintaining the same color identity. New values are darker for better contrast on dark backgrounds.

## [2.8.2] - 2026-04-05

### Refactor
- **Shared status colors**: All status hex values now live in a single source of truth (`STATUS_HEX` in `lib/status-colors.ts`). Six component files refactored to import from this shared module instead of hardcoding colors.
- Updated color palette to the design-specified hex values:
  - Scheduled `#A8DADC` · Queued `#CDB4DB` · Running `#F4A261`
  - Auto-retry `#FFAFCC` · Stale Recovery `#FFB4A2` · Succeeded `#2E7D32`
  - Needs Retry `#FFD166` · Failed `#E63946` · Cancelled `#D3D3D3`
  - Skipped `#EAD7A1` · Draft `#C9D6DF`
- Helper functions `statusHex()`, `statusBg()`, `statusText()` for consumers that need exact hex.
- `STATUS_GUIDE_ENTRIES`, `STATUS_BADGE_MAP`, `STATUS_META` now auto-derived from the single hex map — zero duplication.
- Dot/status indicators, badges, running/spinner, needs-retry, and status guide cards all use exact shared hex values.

### Fixed
- Details-sheet event log "Running" title was still blue — now `#F4A261`.
- Active events with no `latestResult` displayed as grey (indigo fallback) — now correctly show as cyan `#A8DADC` (scheduled).
- `custom-month-agenda.tsx` — 167 lines cleaned: removed `RESULT_INDICATOR` and `STATUS_LABEL_COLORS` maps; everything now sourced from `STATUS_HEX`.
- `agenda-stats-cards.tsx` — running card ring/badge updated to `#F4A261` instead of indigo.
- `agenda-failed-bucket.tsx` — failed/needs_retry badge colors from shared hex.
- `agenda-test-panel.tsx` — test status badges/icons from shared hex.

## [2.8.1] - 2026-04-04

### Changed
- **README**: Complete rewrite — all features, full architecture diagrams, comprehensive API reference, complete DB schema, scripts reference, troubleshooting table, environment variables guide, services overview, log pipeline flow diagrams, Kanban data model, process simulation details, agenda scheduler/bridge-logger deep-dives. Now the single source of truth for developers and AI agents alike.

## [2.8.0] - 2026-04-04

### Fixed
- **Status colors**: `queued` events now display grey (waiting) instead of blue. Blue is reserved exclusively for actively `running` events. Previously, events waiting in the cron queue appeared blue, causing confusion with actively executing events.

### Added
- **Event detail modal**: Added "Created At" card showing when the event was first created
- **Event detail modal**: Added "Model" card showing the model override or "Agent default"
- **Event detail modal**: Added dedicated "Status" card showing current occurrence status prominently
- **Status Guide popup**: Added missing status entries: `auto_retry`, `force_retry`, `stale_recovery`
- **Status Guide popup**: Redesigned with lifecycle grouping, colored dots, and richer descriptions

### Changed
- **README**: Complete rewrite — agent-friendly file map, corrected color guide, flowcharts, API reference
- **Status Guide**: Updated `queued` description to clarify it means "cron assigned, waiting to fire" (grey, not blue)

## [2.7.0] - 2026-04-03

### Fixed
- Calendar event colors: `run_started_at`/`run_finished_at` now included in all event queries
- Cron job creation: Scheduler now uses `--at 30s` for past timestamps instead of failing

### Added
- Artifact files: Download and inline preview in Output tab
- Process simulation: Dry-run mode with SSE streaming

### Changed
- Execution engine: Migrated from BullMQ/Redis to OpenClaw native cron engine
- No Redis dependency
