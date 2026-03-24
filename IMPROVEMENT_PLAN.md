# Mission Control Improvement Plan

**Status:** Draft  
**Owner:** Main  
**Date:** 2026-03-23  
**Priority:** P0 – Golden Path

---

## 1. Documentation Consolidation

### Current state
- `README.md` – main guide (some outdated sections)
- `SECURITY.md` – production hardening notes
- Various inline comments in scripts

### Goal
Single source of truth in `README.md`. Remove `SECURITY.md` and merge its content.

### Tasks
- [ ] Merge `SECURITY.md` into `README.md` under "Security & Production Hardening"
- [ ] Audit all `.md` files and ensure information is current
- [ ] Add a "Documentation Updates" section to README with guidelines: any code change must update docs in same PR

---

## 2. Unified Dev Setup

### Current state
- Multiple npm scripts: `dev:full`, `dev:docker`, `dev:local`, `dev:db`
- Shell scripts in `scripts/`: `install.sh`, `update.sh`, `dev.sh` (some duplicates)
- `docker-compose.yml` for full stack, `docker-compose.dev.yml` for DB only

### Goal
One command to start the entire system in dev mode, with all services (DB, worker, bridge-logger, UI). Use `docker compose` for full dev environment; no separate npm scripts needed.

### Proposed "Golden" Dev Flow
```bash
# Fresh setup (one-time)
git clone <repo>
cd mission-control
cp .env.example .env  # then edit .env with your secrets
docker compose up -d --build  # starts DB, db-init, bridge-logger, task-worker, app (if present)
npm run dev  # or: npm run dev:full (which does both)
```

### Tasks
- [ ] Create `.env.example` with all required variables (see Security section)
- [ ] Simplify `docker-compose.yml` to include all services in dev mode (app runs locally)
  - Keep `db`, `db-init`, `bridge-logger`, `task-worker`
  - Remove `docker-compose.dev.yml` or merge its config into main
- [ ] Create a single `scripts/start.sh` that:
  - Checks Docker is running
  - Runs `docker compose up -d`
  - Waits for DB health
  - Runs `npm install` if needed
  - Starts `npm run dev`
  - Captures logs from all containers with `docker compose logs -f` (optional)
- [ ] Update README with the single command workflow

---

## 3. Telegram Session Continuity

### Current Problem
When a ticket is executed by the worker via `openclaw agent --agent <id> --message <plan>`, it starts a **new agent session**. The response does not appear in the original Telegram chat where the ticket was created. User expects the agent to reply in the same session/chat.

### Root Cause
- Agent CLI creates a fresh session every invocation.
- The ticket does not carry a `telegram_chat_id` or session identifier.
- The agent has no routing context to target a specific chat.

### Design Options

#### Option A – In-Process Agent (Recommended)
Instead of calling the `openclaw` CLI from the worker, the worker directly invokes the agent via OpenClaw's library API with an option to attach to an existing session (if a session exists for that chat). This requires:
- Exposing a way to attach to a session by ID in the OpenClaw API/CLI: `openclaw agent --session <sessionId> --message ...`
- Storing `telegram_chat_id` on the ticket when created from a Telegram interaction
- Looking up or creating a session for that chat and reusing it for subsequent ticket executions

#### Option B – Reply via Activity Log (Simpler)
Keep creating fresh agent sessions, but have the agent's response posted back to the ticket's activity log and then forwarded to the original Telegram chat by a separate bot process that watches `ticket_activity` and `agent_logs`. This decouples execution from routing.

#### Option C – MCP-style "continue conversation"
If the user is interacting with the main agent in Telegram, the worker should execute in the **main** agent's session, not a separate research-agent session. That means: when a ticket is assigned to an agent that is also a configured OpenClaw agent, the worker should forward the plan to that agent's active session (if any) rather than spawning a new one.

### Recommended Path (Option A + C)
1. Add `telegram_chat_id` (nullable) to `tickets` table.
2. When a ticket is created from a Telegram slash command (e.g., `/create`), include `chat_id` in the payload and store it.
3. Modify `task-worker` to:
   - Check if `telegram_chat_id` exists on ticket.
   - If present, look up an existing OpenClaw agent session for that chat and agent, or create a new one and store the session ID.
   - Invoke `openclaw agent --agent <agentId> --session <sessionId> --message ...` to continue the conversation.
4. If `telegram_chat_id` is null, fall back to a new session (current behavior).
5. Store the session ID in a new `agent_sessions` table for reuse.

### Tasks
- [ ] DB migration: add `telegram_chat_id` (text, nullable) to `tickets`
- [ ] DB migration: create `agent_sessions` table (agent_id, chat_id, session_id, last_used_at)
- [ ] Modify frontend ticket creation (modals) to capture and send `chat_id` if available (from Telegram WebApp or context)
- [ ] Update `task-worker.mjs` to use session attachment logic
- [ ] Update OpenClaw config to allow `--session` flag (if not already present)

---

## 4. System Improvements – Security, Simplicity, Maintainability

### Security (Top Priority)
- [ ] **Never run as root** in containers. Use `USER node` in Dockerfile and ensure runtime user is non-root.
  - Fix current `task-worker` and `bridge-logger` which run as root; create a `worker` user with UID 1001 and map to host permissions accordingly.
- [ ] **Remove world-readable secrets** from `.env` files. Set proper file permissions (`0600`) in `install.sh`.
- [ ] **Disable basic auth in dev** only; enforce in production via middleware check on `process.env.NODE_ENV`.
- [ ] **TLS for gateway** in production: put a reverse proxy (Nginx/Traefik) in front with `wss://`.
- [ ] **Backup strategy**: document daily Postgres volume backup via `docker run --rm -v pgdata:/data -v /backup:/backup alpine tar czf /backup/pgdata-$(date +%F).tar.gz -C /data .`
- [ ] **Secret scanning**: add pre-commit hook with `trufflehog` or `git-secrets`.

### Fewer Files
- [ ] Remove `docker-compose.dev.yml` once merged into main compose
- [ ] Remove unused scripts: `scripts/uninstall.sh` (placeholder), `scripts/bridge-logger-check` if redundant
- [ ] Consolidate `scripts/db-setup.mjs` commands into `package.json` directly if fewer files

### Less Maintenance
- [ ] Use `docker compose logs -f` pipe to a file in `./logs` for persistent dev logs
- [ ] Implement health checks in Dockerfile and compose for all services
- [ ] Use `restart: unless-stopped` consistently (already done)
- [ ] Pin all image tags (postgres:15-alpine, node:24-alpine) to specific patch versions

---

## 5. README.md Overhaul

### Target Structure
```markdown
# Mission Control

## Overview (what, why, who)

## Quick Start (3 commands max)
- Prerequisites
-_env.example explanation
- docker compose up -d && npm run dev

## Architecture (diagram in text)
- Components: UI, DB, task-worker, bridge-logger, gateway
- Data flow: logs → DB, tickets → worker → agent → logs

## Development
- Single command: `scripts/start.sh` or `make dev`
- Environment variables
- Running tests
- Rebuilding images

## Operations
- Backup/restore
- Viewing logs
- Updating

## Security
- Auth, network isolation, secrets handling

## Troubleshooting
- Each common error with cause and fix (expand from current)

## Contributing
- Code style
- Documentation updates required in same PR
```

### Tasks
- [ ] Rewrite README following above structure
- [ ] Remove outdated sections ("dockerized packaged mode", "local dev mode" distinctions; just "dev" and "prod")
- [ ] Add clear environment variable table
- [ ] Add diagrams using mermaid if supported (or ASCII)
- [ ] Include a "Known Issues" table referencing GitHub issues (if any)

---

## 6. Worker Status Indicator – Better UX

### Current
Shows countdown based on `pollIntervalSeconds` and `lastTickAt`. This is just a timer, not actual queue depth.

### Proposed
Display:
- Worker status: enabled/disabled
- Concurrency: X / Y (current executing vs max)
- Queue depth: number of tickets in `queued` or `ready_to_execute` state
- Next pickup estimate: based on `(queueDepth / (maxConcurrency - active))` * avgTaskTime

Add API endpoint: `GET /api/tasks/worker-metrics` returning:
```json
{
  "enabled": true,
  "maxConcurrency": 3,
  "activeNow": 2,
  "queuedCount": 5,
  "lastTickAt": "2026-03-23T22:00:00Z"
}
```

`activeNow` = count of tickets in `executing` state updated within last 5 minutes.

### Tasks
- [ ] Add `lib/db/worker-metrics.mjs` with function to compute metrics
- [ ] Add route `app/api/tasks/worker-metrics/route.ts`
- [ ] Update `WorkerStatus` component to show:
  - `Active: 2/3`
  - `Queued: 5`
  - `Est. wait: ~2m`
- [ ] Keep the old SSE `worker_tick` for real-time updates of the metrics

---

## 7. Additional Improvements

### Logging
- [ ] Structured JSON logs for all services (use `pino` or `winston`)
- [ ] Include `traceId` across worker → agent → logs for end-to-end tracing

### Observability
- [ ] Expose Prometheus metrics (`/metrics`) for queue depth, execution duration, success rate
- [ ] Health endpoint (`/health`) that checks DB and Redis (if added)

### Queue Persistence
- [ ] Consider Redis for in-memory queue with better priority support; DB polling is heavy

### Error Handling
- [ ] Exponential backoff for agent failures, with dead-letter queue
- [ ] Alerting on repeated failures (Telegram notification to admin)

---

## Implementation Phases

### Phase 1 (Immediate – Today)
- Docs consolidation (README merge SECURITY.md)
- Add `.env.example`
- Fix worker status metrics (API + component)
- Update README with unified dev workflow

### Phase 2 (This Week)
- Docker security hardening (non-root users)
- Single `start.sh` script
- Worker continuity (session attachment) design and implementation
- Health checks and structured logs

### Phase 3 (Next Sprint)
- Observability (Prometheus)
- Redis-backed queue
- Full test coverage for worker

---

## Success Metrics
- Zero config errors on fresh install
- All devs use the same `scripts/start.sh`
- Worker status reflects real queue
- Telegram replies appear in original chat
- No security audit warnings
