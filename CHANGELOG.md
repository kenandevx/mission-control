# Changelog

All notable changes to Mission Control are documented here.

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
