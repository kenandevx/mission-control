#!/usr/bin/env node
/**
 * Agenda Execution Worker — consumes jobs from BullMQ agenda queue.
 * Runs free prompts and process steps via openclaw agent CLI.
 */
import postgres from "postgres";
import { Worker } from "bullmq";
import { execFileSync } from "node:child_process";
import * as dns from "node:dns";
import { promisify } from "node:util";

const lookupAsync = promisify(dns.lookup.bind(dns));

const connectionString = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!connectionString) {
  console.error("[agenda-worker] Missing DATABASE_URL / OPENCLAW_DATABASE_URL");
  process.exit(1);
}

const REDIS_HOST = process.env.REDIS_HOST || process.env.REDIS_URL?.replace(/^redis:\/\//, "").split(":")[0] || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

const sql = postgres(connectionString, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10 });

const agendaWorker = new Worker(
  "agenda",
  async (job) => {
    const { occurrenceId, eventId, title, freePrompt, agentId, processes } = job.data;

    console.log(`[agenda-worker] Processing occurrence ${occurrenceId} — "${title}"`);

    // ── Mark occurrence running ────────────────────────────────────────────────
    const [occRows] = await sql`
      update agenda_occurrences
      set status = 'running', locked_at = now()
      where id = ${occurrenceId}
      returning id, latest_attempt_no
    `;

    const attemptNo = (occRows?.latest_attempt_no ?? 0) + 1;

    // ── Create run attempt ────────────────────────────────────────────────────
    const [attempt] = await sql`
      insert into agenda_run_attempts (occurrence_id, attempt_no, status, started_at)
      values (${occurrenceId}, ${attemptNo}, 'running', now())
      returning *
    `;

    const runAttemptId = attempt.id;
    let overallSuccess = true;
    const stepSummaries = [];

    try {
      // ── 1. Execute free prompt ─────────────────────────────────────────────
      if (freePrompt) {
        const stepResult = await runAgentStep({
          runAttemptId,
          processVersionId: null,
          processStepId: null,
          stepOrder: 0,
          agentId: agentId || "main",
          skillKey: null,
          instruction: freePrompt,
          timeoutSeconds: null,
          sql,
        });

        stepSummaries.push({
          type: "free_prompt",
          success: stepResult.success,
          summary: stepResult.output.slice(0, 200),
        });

        if (!stepResult.success) {
          overallSuccess = false;
        }
      }

      // ── 2. Execute attached processes sequentially ──────────────────────────
      const sorted = [...(processes ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      for (const proc of sorted) {
        const pvId = proc.process_version_id;

        // Fetch process steps from DB
        const stepRows = await sql`
          select ps.*
          from process_steps ps
          where ps.process_version_id = ${pvId}
          order by ps.step_order asc
        `;

        for (const stepRow of stepRows) {
          const stepResult = await runAgentStep({
            runAttemptId,
            processVersionId: pvId,
            processStepId: stepRow.id,
            stepOrder: stepRow.step_order,
            agentId: stepRow.agent_id || agentId || "main",
            skillKey: stepRow.skill_key,
            instruction: stepRow.instruction,
            timeoutSeconds: stepRow.timeout_seconds,
            sql,
          });

          stepSummaries.push({
            type: "process_step",
            processVersionId: pvId,
            stepId: stepRow.id,
            stepTitle: stepRow.title,
            success: stepResult.success,
            summary: stepResult.output.slice(0, 200),
            error: stepResult.error,
          });

          if (!stepResult.success) {
            overallSuccess = false;
            // Continue to next step unless explicitly failed-critical
          }
        }
      }

      // ── Finalize ────────────────────────────────────────────────────────────
      const finalStatus = overallSuccess ? "succeeded" : "failed";
      const summaryText = stepSummaries
        .map((s) => {
          const ok = s.success ? "✅" : "❌";
          if (s.type === "free_prompt") return `${ok} Free prompt`;
          return `${ok} ${s.stepTitle || "Step"}`;
        })
        .join(" | ");

      await sql`
        update agenda_run_attempts
        set status = ${finalStatus},
            finished_at = now(),
            summary = ${summaryText}
        where id = ${runAttemptId}
      `;

      await sql`
        update agenda_occurrences
        set status = ${finalStatus},
            latest_attempt_no = ${attemptNo}
        where id = ${occurrenceId}
      `;

      console.log(`[agenda-worker] Completed occurrence ${occurrenceId} — ${finalStatus}`);
      return { success: overallSuccess, summary: summaryText };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await sql`
        update agenda_run_attempts
        set status = 'failed', finished_at = now(), error_message = ${msg}
        where id = ${runAttemptId}
      `;

      await sql`
        update agenda_occurrences
        set status = 'failed', latest_attempt_no = ${attemptNo}
        where id = ${occurrenceId}
      `;

      console.error(`[agenda-worker] Fatal error on ${occurrenceId}:`, msg);
      throw error;
    }
  },
  {
    connection: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
    concurrency: parseInt(process.env.AGENDA_CONCURRENCY || "2", 10),
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
async function runAgentStep({
  runAttemptId,
  processVersionId,
  processStepId,
  stepOrder,
  agentId,
  skillKey,
  instruction,
  timeoutSeconds,
  sql,
}) {
  const effectiveAgentId = (agentId && agentId !== "null") ? agentId : "main";
  const effectiveTimeout = Math.max(timeoutSeconds ?? 300, 60); // minimum 60s
  const skillArg = skillKey ? ["--skill", skillKey] : [];

  let output = "";
  let errorMsg = null;
  let success = true;

  try {
    const args = [
      "agent",
      "--agent", effectiveAgentId,
      "--message", instruction,
      "--json",
      ...skillArg,
    ];

    const raw = execFileSync("openclaw", args, {
      timeout: effectiveTimeout * 1000,
      env: process.env,
      encoding: "utf8",
    });

    const parsed = JSON.parse(raw);
    const payloads = parsed?.result?.payloads ?? parsed?.payloads ?? [];
    output = Array.isArray(payloads)
      ? payloads.map((p) => p.text ?? "").join("\n").trim()
      : parsed?.result ?? parsed?.text ?? JSON.stringify(parsed);
  } catch (err) {
    success = false;
    errorMsg = err instanceof Error ? err.message : String(err);
    output = `Error: ${errorMsg}`;
  }

  // Persist step result
  await sql`
    insert into agenda_run_steps (
      run_attempt_id, process_version_id, process_step_id, step_order,
      agent_id, skill_key, input_payload, output_payload, status,
      started_at, finished_at, error_message
    ) values (
      ${runAttemptId},
      ${processVersionId ?? null},
      ${processStepId ?? null},
      ${stepOrder},
      ${effectiveAgentId},
      ${skillKey ?? null},
      ${JSON.stringify({ instruction, skillKey, agentId, timeoutSeconds })},
      ${JSON.stringify({ output })},
      ${success ? "succeeded" : "failed"},
      now(),
      now(),
      ${errorMsg}
    )
  `;

  return { success, output, error: errorMsg };
}

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

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[agenda-worker] Shutting down...");
  await agendaWorker.close();
  await sql.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("[agenda-worker] Started — agenda queue consumer active");
