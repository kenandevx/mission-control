#!/usr/bin/env node
/**
 * Agenda Execution Worker — consumes jobs from BullMQ agenda queue.
 * Runs free prompts and process steps via openclaw agent CLI.
 * v2: Resilient orchestration — execution windows, claim locks, auto-retry,
 *     fallback models, telegram notifications, service heartbeat.
 */
import postgres from "postgres";
import { Worker } from "bullmq";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, truncate, unlink, open } from "node:fs/promises";
import { resolve } from "node:path";
import * as dns from "node:dns";
import { promisify } from "node:util";
import { getRunArtifactDir, ensureArtifactDir, scanArtifactDir, cleanupRunArtifacts } from "./runtime-artifacts.mjs";
import { renderUnifiedTaskMessage } from "./prompt-renderer.mjs";

const execFileAsync = promisify(execFile);

const lookupAsync = promisify(dns.lookup.bind(dns));

const connectionString = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!connectionString) {
  console.error("[agenda-worker] Missing DATABASE_URL / OPENCLAW_DATABASE_URL");
  process.exit(1);
}

const REDIS_HOST = process.env.REDIS_HOST || process.env.REDIS_URL?.replace(/^redis:\/\//, "").split(":")[0] || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const SERVICE_NAME = "agenda-worker";

const sql = postgres(connectionString, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10 });

// ── Service heartbeat ─────────────────────────────────────────────────────────
async function writeHeartbeat(status = "running", lastError = null) {
  try {
    await sql`
      INSERT INTO service_health (name, status, pid, last_heartbeat_at, last_error, started_at, updated_at)
      VALUES (${SERVICE_NAME}, ${status}, ${process.pid}, now(), ${lastError}, now(), now())
      ON CONFLICT (name) DO UPDATE SET
        status = ${status},
        pid = ${process.pid},
        last_heartbeat_at = now(),
        last_error = COALESCE(${lastError}, service_health.last_error),
        updated_at = now()
    `;
  } catch (err) {
    console.warn("[agenda-worker] Heartbeat write failed:", err.message);
  }
}

// ── Telegram chat ID discovery (same as task-worker) ──────────────────────────
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || resolve(process.env.HOME || "/home/clawdbot", ".openclaw");

let _cachedChatId = null;
async function getTelegramChatId(agentId = "main") {
  if (_cachedChatId) return _cachedChatId;
  const searchPaths = [
    resolve(OPENCLAW_HOME, `agents/${agentId}/sessions/sessions.json`),
    resolve(OPENCLAW_HOME, "agents/main/sessions/sessions.json"),
  ];
  for (const sessionsPath of searchPaths) {
    try {
      const raw = await readFile(sessionsPath, "utf8");
      const data = JSON.parse(raw);
      for (const [, val] of Object.entries(data)) {
        if (val?.deliveryContext?.channel === "telegram" && val?.deliveryContext?.to) {
          _cachedChatId = String(val.deliveryContext.to).replace(/^telegram:/, "");
          return _cachedChatId;
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

// ── Telegram notification helper ──────────────────────────────────────────────
async function sendTelegramNotification(message, agentId = "main") {
  try {
    const chatId = await getTelegramChatId(agentId);
    if (!chatId) {
      console.warn("[agenda-worker] No Telegram chat ID found — notification skipped");
      return;
    }
    await execFileAsync("openclaw", [
      "message", "send",
      "--channel", "telegram",
      "--target", chatId,
      "--message", message,
      "--json",
    ], { timeout: 30000, env: process.env });
  } catch (err) {
    console.warn("[agenda-worker] Telegram notification failed:", err.message);
  }
}

// ── Cleanup system helpers ────────────────────────────────────────────────────

const CLEANUP_ALLOWED_PREFIXES = ["/home/clawdbot/", "/storage/", "/tmp/"];

/**
 * Get session file path and current byte offset for an agent's main session.
 * Returns { agentId, sessionFilePath, byteOffset } or null if not found.
 */
async function getAgentSessionSnapshot(agentId) {
  const sessionsPath = resolve(OPENCLAW_HOME, `agents/${agentId}/sessions/sessions.json`);
  try {
    const raw = await readFile(sessionsPath, "utf8");
    const data = JSON.parse(raw);
    // Look for agent:<id>:main session key
    const mainKey = `agent:${agentId}:main`;
    const entry = data[mainKey];
    if (!entry?.sessionId) {
      console.warn(`[agenda-worker] No main session found for agent ${agentId} (key: ${mainKey})`);
      return null;
    }
    const sessionFilePath = entry.sessionFile || resolve(OPENCLAW_HOME, `agents/${agentId}/sessions/${entry.sessionId}.jsonl`);
    let byteOffset = 0;
    try {
      const s = await stat(sessionFilePath);
      byteOffset = s.size;
    } catch {
      // File doesn't exist yet — offset 0
    }
    return { agentId, sessionFilePath, byteOffset };
  } catch (err) {
    console.warn(`[agenda-worker] Failed to read sessions.json for agent ${agentId}:`, err.message);
    return null;
  }
}

/**
 * Acquire per-agent execution locks. Returns { acquired: string[], failed: string[] }.
 */
async function acquireAgentLocks(agentIds, occurrenceId) {
  const acquired = [];
  const failed = [];
  for (const agentId of agentIds) {
    try {
      const [row] = await sql`
        INSERT INTO agent_execution_locks (agent_id, occurrence_id, locked_at)
        VALUES (${agentId}, ${occurrenceId}, now())
        ON CONFLICT DO NOTHING
        RETURNING agent_id
      `;
      if (row) {
        acquired.push(agentId);
      } else {
        failed.push(agentId);
      }
    } catch (err) {
      console.warn(`[agenda-worker] Lock acquire error for agent ${agentId}:`, err.message);
      failed.push(agentId);
    }
  }
  return { acquired, failed };
}

/**
 * Release per-agent execution locks.
 */
async function releaseAgentLocks(agentIds) {
  for (const agentId of agentIds) {
    try {
      await sql`DELETE FROM agent_execution_locks WHERE agent_id = ${agentId}`;
    } catch (err) {
      console.warn(`[agenda-worker] Lock release error for agent ${agentId}:`, err.message);
    }
  }
}

/**
 * Parse session file bytes for memory_store IDs.
 * Looks for tool results containing memory_store with UUID patterns.
 */
function parseMemoryStoreIds(sessionBytes) {
  const ids = [];
  const text = sessionBytes.toString("utf8");
  const lines = text.split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      // Only care about lines that mention memory_store
      if (!line.includes("memory_store")) continue;
      // Look for UUID patterns in the context of memory_store results
      // Pattern: "id":"<uuid>" or "id": "<uuid>"
      const uuidRegex = /["']id["']\s*:\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/gi;
      let match;
      while ((match = uuidRegex.exec(line)) !== null) {
        ids.push(match[1]);
      }
    } catch { /* skip unparseable lines */ }
  }
  return [...new Set(ids)];
}

/**
 * Delete memory entries from Qdrant via REST API.
 */
async function deleteQdrantMemories(memoryIds) {
  if (memoryIds.length === 0) return { deleted: [], errors: [] };
  const deleted = [];
  const errors = [];
  try {
    const resp = await fetch("http://localhost:6333/collections/memories/points/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: memoryIds }),
    });
    if (resp.ok) {
      deleted.push(...memoryIds);
      console.log(`[agenda-worker] Deleted ${memoryIds.length} memory entries from Qdrant`);
    } else {
      const body = await resp.text();
      errors.push(`Qdrant delete failed (${resp.status}): ${body.slice(0, 200)}`);
      console.warn(`[agenda-worker] Qdrant delete failed:`, resp.status, body.slice(0, 200));
    }
  } catch (err) {
    errors.push(`Qdrant delete error: ${err.message}`);
    console.warn(`[agenda-worker] Qdrant delete error:`, err.message);
  }
  return { deleted, errors };
}

/**
 * Run full cleanup for a failed attempt.
 * Order: Qdrant → session truncation → file deletion
 */
async function runFailureCleanup(runAttemptId, snapshots, detectedFilePaths, attemptStartTime) {
  const details = { memoryIds: [], filesDeleted: [], sessionsRestored: 0, errors: [] };

  try {
    // Mark cleanup as pending
    await sql`UPDATE agenda_run_attempts SET cleanup_status = 'pending' WHERE id = ${runAttemptId}`;

    // Phase 1: Qdrant memory cleanup
    for (const snap of snapshots) {
      try {
        const { sessionFilePath, byteOffset } = snap;
        const currentStat = await stat(sessionFilePath).catch(() => null);
        if (!currentStat || currentStat.size <= byteOffset) continue;

        const fd = await open(sessionFilePath, "r");
        try {
          const bytesToRead = currentStat.size - byteOffset;
          const buf = Buffer.alloc(bytesToRead);
          await fd.read(buf, 0, bytesToRead, byteOffset);
          const memoryIds = parseMemoryStoreIds(buf);
          if (memoryIds.length > 0) {
            const result = await deleteQdrantMemories(memoryIds);
            details.memoryIds.push(...result.deleted);
            details.errors.push(...result.errors);
          }
        } finally {
          await fd.close();
        }
      } catch (err) {
        details.errors.push(`Memory cleanup for ${snap.agentId}: ${err.message}`);
      }
    }

    // Phase 2: Session file truncation
    for (const snap of snapshots) {
      try {
        const { sessionFilePath, byteOffset, agentId } = snap;
        if (!sessionFilePath || typeof byteOffset !== "number" || byteOffset < 0) {
          details.errors.push(`${agentId}: invalid snapshot data`);
          continue;
        }
        if (!sessionFilePath.includes("/.openclaw/agents/") || !sessionFilePath.endsWith(".jsonl")) {
          details.errors.push(`${agentId}: path rejected (safety check)`);
          continue;
        }
        const currentStat = await stat(sessionFilePath).catch(() => null);
        if (!currentStat || !currentStat.isFile()) continue;
        if (currentStat.size > byteOffset) {
          await truncate(sessionFilePath, byteOffset);
          details.sessionsRestored++;
          console.log(`[agenda-worker] Truncated session for agent ${agentId}: ${currentStat.size} → ${byteOffset} bytes`);
        }
      } catch (err) {
        details.errors.push(`Session truncate for ${snap.agentId}: ${err.message}`);
      }
    }

    // Phase 3: File deletion (targeted, never folder-recursive)
    const startTime = new Date(attemptStartTime).getTime();
    for (const filePath of detectedFilePaths) {
      try {
        const cleaned = String(filePath || "").replace(/[.,;:!?)}\]]+$/, "").trim();
        if (!cleaned) continue;
        if (!CLEANUP_ALLOWED_PREFIXES.some((p) => cleaned.startsWith(p))) continue;

        const fstat = await stat(cleaned).catch(() => null);
        if (!fstat || !fstat.isFile()) continue;

        // Delete only files changed/created after this attempt started.
        const ctime = Number(fstat.ctimeMs || 0);
        const mtime = Number(fstat.mtimeMs || 0);
        const birth = Number(fstat.birthtimeMs || 0);
        const changedAfterAttempt = ctime > startTime || mtime > startTime || birth > startTime;
        if (!changedAfterAttempt) continue;

        await unlink(cleaned);
        details.filesDeleted.push(cleaned);
        console.log(`[agenda-worker] Deleted file: ${cleaned}`);
      } catch (err) {
        details.errors.push(`File delete ${filePath}: ${err.message}`);
      }
    }

    // Mark cleanup as completed
    const status = details.errors.length > 0 ? "failed" : "completed";
    await sql`
      UPDATE agenda_run_attempts
      SET cleanup_status = ${status}, cleanup_details = ${sql.json(details)}
      WHERE id = ${runAttemptId}
    `;
    console.log(`[agenda-worker] Cleanup ${status} for attempt ${runAttemptId}: ${details.sessionsRestored} sessions restored, ${details.memoryIds.length} memories deleted, ${details.filesDeleted.length} files deleted`);
  } catch (err) {
    console.error(`[agenda-worker] Cleanup error for attempt ${runAttemptId}:`, err.message);
    details.errors.push(`Cleanup error: ${err.message}`);
    try {
      await sql`
        UPDATE agenda_run_attempts
        SET cleanup_status = 'failed', cleanup_details = ${sql.json(details)}
        WHERE id = ${runAttemptId}
      `;
    } catch { /* best effort */ }
  }
  return details;
}

/**
 * Recover incomplete cleanups from previous crashes.
 */
async function recoverPendingCleanups() {
  try {
    const pending = await sql`
      SELECT id, session_snapshots, cleanup_details
      FROM agenda_run_attempts
      WHERE cleanup_status = 'pending'
    `;
    if (pending.length === 0) return;
    console.log(`[agenda-worker] Recovering ${pending.length} pending cleanup(s)...`);
    for (const row of pending) {
      const snapshots = row.session_snapshots || [];
      // Re-run cleanup (idempotent operations)
      await runFailureCleanup(row.id, snapshots, [], new Date(0));
    }
  } catch (err) {
    console.warn(`[agenda-worker] Pending cleanup recovery failed:`, err.message);
  }
}

const agendaWorker = new Worker(
  "agenda",
  async (job) => {
    const { occurrenceId, eventId, title, freePrompt, agentId, processes, scheduledFor, executionWindowMinutes, fallbackModel } = job.data;

    console.log(`[agenda-worker] Processing occurrence ${occurrenceId} — "${title}"`);

    // ── Execution window check ────────────────────────────────────────────────
    const scheduledTime = new Date(scheduledFor || job.timestamp);
    const windowMinutes = executionWindowMinutes || 30;
    // Use DB server time to avoid clock skew between scheduler and worker
    const [{ now: dbNow }] = await sql`SELECT now() as now`;
    const diffMinutes = (new Date(dbNow).getTime() - scheduledTime.getTime()) / 60000;
    if (diffMinutes > windowMinutes) {
      // Mark as needs_retry (not expired) — user can press Retry to run it now
      await sql`UPDATE agenda_occurrences SET status = 'needs_retry' WHERE id = ${occurrenceId}`;
      // Create a run attempt with the reason logged
      const missedAttemptNo = ((await sql`SELECT latest_attempt_no FROM agenda_occurrences WHERE id = ${occurrenceId}`)[0]?.latest_attempt_no ?? 0) + 1;
      await sql`
        INSERT INTO agenda_run_attempts (occurrence_id, attempt_no, status, started_at, finished_at, error_message)
        VALUES (${occurrenceId}, ${missedAttemptNo}, 'failed', now(), now(), ${`Missed execution window — ${Math.round(diffMinutes)}min past ${windowMinutes}min limit`})
      `;
      await sql`UPDATE agenda_occurrences SET latest_attempt_no = ${missedAttemptNo} WHERE id = ${occurrenceId}`;
      console.warn(`[agenda-worker] Occurrence ${occurrenceId} needs retry (${diffMinutes.toFixed(1)}m past window of ${windowMinutes}m)`);
      await sendTelegramNotification(`⚠️ Agenda event "${title}" missed execution window (${Math.round(diffMinutes)}m late) — needs manual retry in Mission Control`, agentId || "main");
      return { skipped: true, reason: 'missed_window' };
    }

    // ── Per-agent execution locks ─────────────────────────────────────────────
    // Collect all unique agent IDs from this job (free prompt agent + process step agents)
    const allAgentIds = new Set();
    allAgentIds.add(agentId || "main");
    const uniqueAgentIds = [...allAgentIds];

    const { acquired: lockedAgents, failed: lockFailed } = await acquireAgentLocks(uniqueAgentIds, occurrenceId);
    if (lockFailed.length > 0) {
      // Release any locks we did acquire
      await releaseAgentLocks(lockedAgents);
      console.log(`[agenda-worker] Agent lock contention for ${occurrenceId} (agents: ${lockFailed.join(", ")}), re-queuing with 30s delay`);
      // Re-queue with delay
      const { Queue } = await import("bullmq");
      const requeue = new Queue("agenda", { connection: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD } });
      await requeue.add("agenda-event", job.data, { delay: 30000 });
      await requeue.close();
      return { skipped: true, reason: 'agent_locked' };
    }

    // ── Postgres-level claim lock ─────────────────────────────────────────────
    const [claimed] = await sql`
      UPDATE agenda_occurrences SET status = 'running', locked_at = now()
      WHERE id = ${occurrenceId} AND status IN ('scheduled', 'queued', 'needs_retry')
      RETURNING id, latest_attempt_no
    `;
    if (!claimed) {
      await releaseAgentLocks(lockedAgents);
      console.log(`[agenda-worker] Occurrence ${occurrenceId} already claimed, skipping`);
      return { skipped: true, reason: 'already_claimed' };
    }
    await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "running", occurrenceId })})`;

    const attemptNo = (claimed.latest_attempt_no ?? 0) + 1;

    // ── Session snapshots (pre-execution) ─────────────────────────────────────
    const sessionSnapshots = [];
    for (const aid of uniqueAgentIds) {
      const snap = await getAgentSessionSnapshot(aid);
      if (snap) sessionSnapshots.push(snap);
    }

    // ── Create run attempt ────────────────────────────────────────────────────
    const [attempt] = await sql`
      insert into agenda_run_attempts (occurrence_id, attempt_no, status, started_at, session_snapshots)
      values (${occurrenceId}, ${attemptNo}, 'running', now(), ${sql.json(sessionSnapshots)})
      returning *
    `;

    const runAttemptId = attempt.id;
    const attemptStartTime = attempt.started_at;
    let overallSuccess = true;
    const stepSummaries = [];
    // Track all file paths detected across all steps for cleanup
    // (File detection removed — agent writes directly to artifact dir)

    // ── Load settings ──────────────────────────────────────────────────────
    const [settingsRow] = await sql`SELECT auto_retry_after_minutes, max_retries, default_fallback_model FROM worker_settings WHERE id = 1 LIMIT 1`;
    const autoRetryMinutes = Number(settingsRow?.auto_retry_after_minutes || 0);
    const maxRetries = Number(settingsRow?.max_retries ?? 1); // default 1 auto-retry
    const globalFallbackModel = settingsRow?.default_fallback_model || "";
    const effectiveFallbackModel = fallbackModel || globalFallbackModel || null;

    // Always alert after 5 minutes
    const alertTimer = setTimeout(async () => {
      const msg = `⏱️ Long-running agenda event alert\n\n` +
        `Event: "${title}"\n` +
        `Occurrence: ${occurrenceId}\n` +
        `Attempt: #${attemptNo}\n` +
        `Running for: 5+ minutes\n` +
        `Started: ${attempt.started_at}\n` +
        (autoRetryMinutes > 0 ? `Auto-retry configured at ${autoRetryMinutes} min.\n` : `Auto-retry: disabled (manual only)\n`) +
        `\nCheck Mission Control for details or use Force Retry to restart it.`;
      await sendTelegramNotification(msg, agentId || "main");
      console.warn(`[agenda-worker] Long-running alert sent for "${title}" (occurrence ${occurrenceId})`);
    }, 5 * 60 * 1000);

    // Auto-retry timer (if event is stuck longer than configured minutes)
    let autoRetryTimer = null;
    if (autoRetryMinutes > 0) {
      autoRetryTimer = setTimeout(async () => {
        console.warn(`[agenda-worker] Auto-retry triggered for "${title}" after ${autoRetryMinutes}min (occurrence ${occurrenceId})`);
        try {
          await sql`UPDATE agenda_run_attempts SET status = 'failed', finished_at = now(), error_message = ${`Auto-retried: exceeded ${autoRetryMinutes} minute limit`} WHERE id = ${runAttemptId} AND status = 'running'`;
          const [maxAtt] = await sql`SELECT coalesce(max(attempt_no), 0) as max_no FROM agenda_run_attempts WHERE occurrence_id = ${occurrenceId}`;
          await sql`UPDATE agenda_occurrences SET status = 'needs_retry', locked_at = null, latest_attempt_no = ${maxAtt.max_no} WHERE id = ${occurrenceId}`;
          await sql`SELECT pg_notify('agenda_change', ${JSON.stringify({ action: "auto_retry", occurrenceId })})`;
          await sendTelegramNotification(
            `🔄 Auto-retry triggered for "${title}"\n\n` +
            `Exceeded ${autoRetryMinutes} minute time limit.\n` +
            `Status set to needs_retry — check Mission Control to retry or investigate.`,
            agentId || "main"
          );
        } catch (err) {
          console.error(`[agenda-worker] Auto-retry failed for ${occurrenceId}:`, err);
        }
      }, autoRetryMinutes * 60 * 1000);
    }

    // ── Helper: run all steps (free prompt + processes) ──────────────────────
    const sorted = [...(processes ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    // Compute artifact dir for this run and ensure it exists before execution
    const runArtifactDir = getRunArtifactDir({
      kind: "agenda",
      entityId: eventId || "unknown",
      occurrenceId: occurrenceId || "none",
      runId: runAttemptId,
    });
    await ensureArtifactDir(runArtifactDir);

    async function runAllSteps(overrideModel = null) {
      const results = [];

      const composedSteps = [];
      let seq = 1;
      for (const proc of sorted) {
        const pvId = proc.process_version_id;
        const stepRows = await sql`select ps.* from process_steps ps where ps.process_version_id = ${pvId} order by ps.step_order asc`;
        for (const stepRow of stepRows) {
          composedSteps.push({
            order: seq++,
            title: stepRow.title || `Step ${stepRow.step_order}`,
            instruction: String(stepRow.instruction || ""),
            skillKey: stepRow.skill_key || null,
            agentId: stepRow.agent_id || null,
            timeoutSeconds: stepRow.timeout_seconds ?? null,
            fallbackModel: stepRow.fallback_model || null,
            processVersionId: pvId,
            processStepId: stepRow.id,
          });
        }
      }

      const instruction = renderUnifiedTaskMessage({
        title,
        instructions: composedSteps.map((s) => ({ order: s.order, title: s.title, instruction: s.instruction, skillKey: s.skillKey })),
        request: freePrompt ? String(freePrompt) : "",
        artifactDir: runArtifactDir,
      });

      const firstSkill = composedSteps.find((s) => s.skillKey)?.skillKey || null;
      const firstAgent = composedSteps.find((s) => s.agentId)?.agentId || agentId || "main";
      const firstTimeout = composedSteps.find((s) => Number.isFinite(Number(s.timeoutSeconds)))?.timeoutSeconds ?? null;
      const firstFallback = composedSteps.find((s) => s.fallbackModel)?.fallbackModel || effectiveFallbackModel || null;

      const r = await runAgentStep({
        runAttemptId,
        eventId,
        occurrenceId,
        eventTitle: title,
        processVersionId: null,
        processStepId: null,
        stepOrder: 0,
        agentId: firstAgent,
        skillKey: firstSkill,
        instruction,
        timeoutSeconds: firstTimeout,
        fallbackModel: overrideModel ? null : firstFallback,
        overrideModel,
        artifactDir: runArtifactDir,
        sql,
      });

      results.push({
        type: "composed_run",
        success: r.success,
        summary: r.output.slice(0, 200),
        steps: composedSteps.length,
      });
      // Artifacts live in runArtifactDir — cleaned up on failure via cleanupRunArtifacts
      return { success: r.success, results };
    }

    try {
      // ── 1. First attempt ──────────────────────────────────────────────────
      let run = await runAllSteps();
      overallSuccess = run.success;
      stepSummaries.push(...run.results);

      // ── 2. Auto-retries (default 1, configurable via settings) ────────────
      let retryCount = 0;
      while (!overallSuccess && retryCount < maxRetries) {
        retryCount++;
        console.log(`[agenda-worker] Auto-retry ${retryCount}/${maxRetries} for ${occurrenceId}...`);
        stepSummaries.length = 0;
        run = await runAllSteps();
        overallSuccess = run.success;
        stepSummaries.push(...run.results);
      }

      // ── 3. Fallback model retry (if all auto-retries failed + fallback set) ──
      if (!overallSuccess && effectiveFallbackModel) {
        console.log(`[agenda-worker] All retries failed for ${occurrenceId}, trying fallback model: ${effectiveFallbackModel}`);
        stepSummaries.length = 0;
        run = await runAllSteps(effectiveFallbackModel);
        overallSuccess = run.success;
        stepSummaries.push(...run.results);
      }

      // ── Finalize after retries ──────────────────────────────────────────────
      const summaryText = stepSummaries
        .map((s) => {
          const ok = s.success ? "✅" : "❌";
          if (s.type === "free_prompt") return `${ok} Free prompt`;
          if (s.type === "composed_run") return `${ok} Composed run (${s.steps || 0} steps)`;
          return `${ok} ${s.stepTitle || "Step"}`;
        })
        .join(" | ");

      const [occState] = await sql`
        SELECT status FROM agenda_occurrences WHERE id = ${occurrenceId} LIMIT 1
      `;

      // Guard against race conditions: if another path already moved this occurrence
      // out of "running" (e.g. auto-retry timeout/manual intervention), never overwrite it.
      if (occState?.status !== "running") {
        await sql`
          update agenda_run_attempts
          set status = 'failed',
              finished_at = now(),
              summary = ${summaryText},
              error_message = coalesce(error_message, 'Execution preempted while run was still in progress')
          where id = ${runAttemptId} and status = 'running'
        `;
        console.warn(`[agenda-worker] Skipping finalize for ${occurrenceId}: occurrence status is ${occState?.status ?? "unknown"}`);
        clearTimeout(alertTimer);
        if (autoRetryTimer) clearTimeout(autoRetryTimer);
        await releaseAgentLocks(lockedAgents);
        return { success: false, preempted: true, status: occState?.status ?? null };
      }

      await sql`
        update agenda_run_attempts
        set status = ${overallSuccess ? "succeeded" : "failed"},
            finished_at = now(),
            summary = ${summaryText}
        where id = ${runAttemptId}
      `;

      if (overallSuccess) {
        await sql`
          update agenda_occurrences
          set status = 'succeeded', latest_attempt_no = ${attemptNo}
          where id = ${occurrenceId} and status = 'running'
        `;
        await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "succeeded", occurrenceId })})`;
        console.log(`[agenda-worker] Completed occurrence ${occurrenceId} — succeeded`);
      } else {
        // All retries exhausted → run cleanup before setting needs_retry
        console.log(`[agenda-worker] Running failure cleanup for occurrence ${occurrenceId}...`);
        try {
          await runFailureCleanup(runAttemptId, sessionSnapshots, [], attemptStartTime);
          await cleanupRunArtifacts(runArtifactDir);
        } catch (cleanupErr) {
          console.error(`[agenda-worker] Cleanup failed for ${occurrenceId}:`, cleanupErr.message);
        }

        await sql`
          update agenda_occurrences
          set status = 'needs_retry', latest_attempt_no = ${attemptNo}
          where id = ${occurrenceId}
        `;
        await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "needs_retry", occurrenceId })})`;
        console.warn(`[agenda-worker] Occurrence ${occurrenceId} needs manual retry (all retries exhausted)`);
        await sendTelegramNotification(`⚠️ Agenda event "${title}" needs manual retry (all retries exhausted)`, agentId || "main");
      }

      clearTimeout(alertTimer);
      if (autoRetryTimer) clearTimeout(autoRetryTimer);
      // Release agent execution locks
      await releaseAgentLocks(lockedAgents);
      return { success: overallSuccess, summary: summaryText };
    } catch (error) {
      clearTimeout(alertTimer);
      if (autoRetryTimer) clearTimeout(autoRetryTimer);
      const msg = error instanceof Error ? error.message : String(error);
      await sql`
        update agenda_run_attempts
        set status = 'failed', finished_at = now(), error_message = ${msg}
        where id = ${runAttemptId}
      `;

      // Run cleanup on fatal error too
      console.log(`[agenda-worker] Running failure cleanup for fatal error on ${occurrenceId}...`);
      try {
        await runFailureCleanup(runAttemptId, sessionSnapshots, [], attemptStartTime);
        await cleanupRunArtifacts(runArtifactDir);
      } catch (cleanupErr) {
        console.error(`[agenda-worker] Cleanup failed for ${occurrenceId}:`, cleanupErr.message);
      }

      // Fatal error → needs_retry directly
      await sql`
        update agenda_occurrences
        set status = 'needs_retry', latest_attempt_no = ${attemptNo}
        where id = ${occurrenceId}
      `;
      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "failed", occurrenceId })})`;
      await sendTelegramNotification(`❌ Agenda event "${title}" failed: ${msg.slice(0, 200)}`, agentId || "main");

      // Release agent execution locks
      await releaseAgentLocks(lockedAgents);
      console.error(`[agenda-worker] Fatal error on ${occurrenceId}:`, msg);
      throw error;
    }
  },
  {
    connection: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
    concurrency: parseInt(process.env.AGENDA_CONCURRENCY || "5", 10),
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  }
);

agendaWorker.on("completed", (job, result) => {
  console.log(`[agenda-worker] Job ${job.id} completed:`, result);
});

agendaWorker.on("failed", (job, err) => {
  console.error(`[agenda-worker] Job ${job?.id} failed:`, err.message);
});

// ── Step execution helper ─────────────────────────────────────────────────────

function isCapacityConstraintError(errorMsg) {
  const lower = (errorMsg || "").toLowerCase();

  // HTTP-level signals
  if (/(^|\D)(429|402)(\D|$)/.test(lower)) return true;

  // Provider-level stable codes/phrases
  if (
    lower.includes("insufficient_quota") ||
    lower.includes("quota_exceeded") ||
    lower.includes("billing_hard_limit") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("credit balance is too low") ||
    lower.includes("insufficient credits") ||
    (lower.includes("plans & billing") && lower.includes("upgrade"))
  ) {
    return true;
  }

  return false;
}

async function runAgentStep({
  runAttemptId,
  eventId,
  occurrenceId,
  eventTitle,
  processVersionId,
  processStepId,
  stepOrder,
  agentId,
  skillKey,
  instruction,
  timeoutSeconds,
  fallbackModel,
  overrideModel,
  artifactDir,
  sql,
}) {
  const effectiveAgentId = (agentId && agentId !== "null") ? agentId : "main";
  const effectiveTimeout = Math.max(timeoutSeconds ?? 300, 60);

  // Skill context is already embedded in the rendered instruction template
  const effectiveInstruction = instruction;

  let output = "";
  let errorMsg = null;
  let success = true;
  let artifactData = null;
  let usedFallback = false;

  async function executeAgent(modelOverride = null) {
    const effectiveModel = modelOverride || overrideModel || null;
    const modelArg = effectiveModel ? ["--model", effectiveModel] : [];
    const args = [
      "agent",
      "--agent", effectiveAgentId,
      "--message", effectiveInstruction,
      "--json",
      ...modelArg,
    ];

    return execFileAsync("openclaw", args, {
      timeout: effectiveTimeout * 1000,
      env: process.env,
      maxBuffer: 50 * 1024 * 1024,
    });
  }

  try {
    let raw;
    try {
      const result = await executeAgent();
      raw = result.stdout;
    } catch (primaryErr) {
      const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);

      // Capacity-constrained failures (rate-limit/quota/low credits) should auto-fallback
      // when a fallback model is configured.
      if (fallbackModel && isCapacityConstraintError(primaryMsg)) {
        try {
          const fallbackResult = await executeAgent(fallbackModel);
          raw = fallbackResult.stdout;
          usedFallback = true;
        } catch (fallbackErr) {
          const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          throw new Error(`Primary model capacity-constrained and fallback failed: ${fallbackMsg}`);
        }
      } else {
        throw primaryErr;
      }
    }

    const parsed = JSON.parse(raw);
    const payloads = parsed?.result?.payloads ?? parsed?.payloads ?? [];

    // Collect text from all payloads
    const textParts = [];
    if (Array.isArray(payloads)) {
      for (const p of payloads) {
        if (p.text) textParts.push(p.text);
      }
    }

    output = textParts.join("\n").trim() || (parsed?.result ?? parsed?.text ?? JSON.stringify(parsed));

    // Scan artifact dir for files the agent created directly there
    if (artifactDir) {
      const scannedFiles = await scanArtifactDir(artifactDir);
      if (scannedFiles.length > 0) {
        artifactData = { files: scannedFiles };
        console.log(`[agenda-worker] Found ${scannedFiles.length} artifact(s) in ${artifactDir}`);
      }
    }
  } catch (err) {
    success = false;
    errorMsg = err instanceof Error ? err.message : String(err);
    output = `Error: ${errorMsg}`;
  }

  // Handle empty response
  if (success && (!output || output.trim() === "")) {
    output = "(Agent returned empty response)";
  }

  // Persist step result (guard against cascade-deleted parent)
  try {
    await sql`
      insert into agenda_run_steps (
        run_attempt_id, process_version_id, process_step_id, step_order,
        agent_id, skill_key, input_payload, output_payload, artifact_payload, status,
        started_at, finished_at, error_message
      ) values (
        ${runAttemptId},
        ${processVersionId ?? null},
        ${processStepId ?? null},
        ${stepOrder},
        ${effectiveAgentId},
        ${skillKey ?? null},
        ${sql.json({ instruction, skillKey, agentId, timeoutSeconds, usedFallback })},
        ${sql.json({ output })},
        ${artifactData ? sql.json(artifactData) : null},
        ${success ? "succeeded" : "failed"},
        now(),
        now(),
        ${errorMsg}
      )
    `;
  } catch (fkErr) {
    if (String(fkErr?.code) === "23503") {
      console.warn(`[agenda-worker] Run attempt ${runAttemptId} was deleted (event removed during execution) — skipping step persist`);
    } else {
      throw fkErr;
    }
  }

  return { success, output, error: errorMsg, artifacts: artifactData };
}

// ── Stale lock recovery ───────────────────────────────────────────────────────
async function recoverStaleLocks() {
  try {
    const stale = await sql`
      update agenda_occurrences
      set status = 'needs_retry', locked_at = null
      where status = 'running'
        and locked_at < now() - interval '15 minutes'
      returning id
    `;
    if (stale.length > 0) {
      console.log(`[agenda-worker] Recovered ${stale.length} stale lock(s) → needs_retry`);
      for (const row of stale) {
        await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "stale_recovery", occurrenceId: row.id })})`;
      }
      // Alert user
      const titles = await sql`
        select ae.title, ao.id as occ_id from agenda_occurrences ao
        join agenda_events ae on ae.id = ao.agenda_event_id
        where ao.id = ANY(${stale.map(r => r.id)})
      `;
      for (const t of titles) {
        await sendTelegramNotification(
          `⚠️ Stale event recovered: "${t.title}"\n\nWorker crashed during execution. Status set to needs_retry.\nRetry manually in Mission Control.`,
          "main"
        );
      }
    }

    // Recover stale agent execution locks (>20 minutes old)
    try {
      const staleLocks = await sql`
        DELETE FROM agent_execution_locks
        WHERE locked_at < now() - interval '20 minutes'
        RETURNING agent_id
      `;
      if (staleLocks.length > 0) {
        console.log(`[agenda-worker] Recovered ${staleLocks.length} stale agent execution lock(s): ${staleLocks.map(r => r.agent_id).join(", ")}`);
      }
    } catch (err) {
      console.warn("[agenda-worker] Stale agent lock recovery failed:", err.message);
    }
  } catch (err) {
    console.warn("[agenda-worker] Stale lock recovery failed:", err.message);
  }
}

// Run recovery on startup + every 5 minutes
await mkdir("/storage/mission-control/artifacts", { recursive: true }).catch(() => {});
await recoverStaleLocks();
await recoverPendingCleanups();
setInterval(recoverStaleLocks, 5 * 60 * 1000);

// ── Healthcheck ───────────────────────────────────────────────────────────────
async function checkRedis() {
  try {
    await lookupAsync(REDIS_HOST);
    return true;
  } catch {
    return false;
  }
}

setInterval(async () => {
  const ok = await checkRedis();
  if (!ok) {
    console.warn("[agenda-worker] Redis unreachable — worker may be stalled");
  }
}, 30_000);

// ── Service heartbeat on startup + every 30s ──────────────────────────────────
await writeHeartbeat("running");
const heartbeatInterval = setInterval(() => writeHeartbeat("running"), 30_000);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[agenda-worker] Shutting down...");
  clearInterval(heartbeatInterval);
  await writeHeartbeat("stopped").catch(() => {});
  await agendaWorker.close();
  await sql.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("[agenda-worker] Started — agenda queue consumer active (concurrency: 5)");
