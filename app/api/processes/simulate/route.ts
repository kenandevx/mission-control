import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

const AGENTS_DIR = join(homedir(), ".openclaw", "agents");

type ProcessStep = {
  title?: string;
  step_title?: string;
  instruction?: string;
  agent_id?: string;
  agentId?: string;
  skill_key?: string;
  skillKey?: string;
  model_override?: string;
  modelOverride?: string;
  timeout_seconds?: number | null;
  timeoutSeconds?: number | null;
};

type SessionSnapshot = {
  agentId: string;
  sessionFilePath: string;
  byteOffset: number;
};

/**
 * Resolve the active session file for an agent by reading sessions.json
 * and finding the agent:<id>:main entry.
 */
async function getAgentSessionFile(agentId: string): Promise<{ path: string; size: number } | null> {
  try {
    const sessionsJsonPath = join(AGENTS_DIR, agentId, "sessions", "sessions.json");
    const raw = await readFile(sessionsJsonPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, { sessionId?: string }>;

    // Look for the main session key: agent:<id>:main
    const mainKey = `agent:${agentId}:main`;
    const entry = data[mainKey];
    if (!entry?.sessionId) return null;

    const filePath = join(AGENTS_DIR, agentId, "sessions", `${entry.sessionId}.jsonl`);
    const s = await stat(filePath);
    return { path: filePath, size: s.size };
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const sql = getSql();
  const body = await request.json();

  let steps: ProcessStep[] = [];
  if (body?.processId) {
    const [latestPv] = await sql`select id from process_versions where process_id = ${body.processId} order by version_number desc limit 1`;
    if (!latestPv) return NextResponse.json({ ok: false, error: "Process not found" });
    steps = await sql`select * from process_steps where process_version_id = ${latestPv.id} order by step_order asc`;
  } else if (Array.isArray(body?.steps)) {
    steps = body.steps;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const allFiles: string[] = [];
      const pathRegex = /(\/(?:home|storage|tmp|var|opt|root)[^\s\`"')\]>]+\.\w{1,10})/g;

      // ── Snapshot session files BEFORE simulation ──────────────────────
      // Collect unique agent IDs used in this simulation
      const agentIds = [...new Set(steps.map((s) => s.agent_id || s.agentId || "main"))];
      const snapshots: SessionSnapshot[] = [];

      for (const aid of agentIds) {
        const session = await getAgentSessionFile(aid);
        if (session) {
          snapshots.push({
            agentId: aid,
            sessionFilePath: session.path,
            byteOffset: session.size,
          });
        }
      }

      // ── Run simulation steps ──────────────────────────────────────────
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const agentId = step.agent_id || step.agentId || "main";
        const instruction = step.instruction || "";
        const skillKey = step.skill_key || step.skillKey || "";
        const modelOverride = step.model_override || step.modelOverride || "";
        const timeout = (step.timeout_seconds || step.timeoutSeconds || 300) * 1000;

        send({
          stepIndex: i,
          status: "running",
          title: step.title || step.step_title || `Step ${i + 1}`,
          instruction: instruction.slice(0, 500),
          agentId,
          skillKey: skillKey || null,
          modelOverride: modelOverride || null,
        });

        const args = [
          "agent",
          "--agent", agentId,
          "--message", `[SIMULATION MODE — do not make permanent changes, only show what you would do]\n\n${instruction}`,
          "--json",
          "--local",
        ];
        // Note: --skill and --model were removed in OpenClaw 4.x.
        // Skill context should be embedded in the instruction text.
        // Model override requires gateway mode (not available with --local).

        try {
          // Strip gateway env vars to prevent failed gateway connection attempts
          const cleanEnv = { ...process.env };
          delete cleanEnv.OPENCLAW_GATEWAY_URL;
          delete cleanEnv.OPENCLAW_GATEWAY_TOKEN;

          const result = await execFileAsync("openclaw", args, {
            timeout,
            env: cleanEnv,
            maxBuffer: 50 * 1024 * 1024,
          });
          // OpenClaw 4.x writes --json output to stderr, not stdout.
          const rawOutput = (result.stdout || "").trim() ? result.stdout : (result.stderr || "");
          const parsed = JSON.parse(rawOutput);
          const payloads = parsed?.result?.payloads ?? parsed?.payloads ?? [];
          const output = payloads
            .map((p: { text?: string }) => p.text ?? "")
            .join("\n")
            .trim() || JSON.stringify(parsed);

          // Detect files created during this step
          const detected = [...new Set((output.match(pathRegex) || []) as string[])].map(
            (p: string) => p.replace(/[.,;:!?)}\]]+$/, "")
          );
          const stepFiles: Array<{ path: string; name: string; size: number }> = [];
          for (const p of detected) {
            try {
              const s = await stat(p);
              if (s.isFile()) stepFiles.push({ path: p, name: p.split("/").pop() || p, size: s.size });
            } catch {
              // ignore — file doesn't exist or not accessible
            }
          }
          allFiles.push(...stepFiles.map((f) => f.path));

          send({
            stepIndex: i,
            status: "succeeded",
            output,
            filesCreated: stepFiles,
            title: step.title || step.step_title || `Step ${i + 1}`,
            instruction: instruction.slice(0, 500),
            agentId,
            skillKey: skillKey || null,
            modelOverride: modelOverride || null,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          send({
            stepIndex: i,
            status: "failed",
            error: msg,
            title: step.title || step.step_title || `Step ${i + 1}`,
            instruction: instruction.slice(0, 500),
            agentId,
            skillKey: skillKey || null,
            modelOverride: modelOverride || null,
          });
        }
      }

      send({
        done: true,
        allFilesCreated: allFiles,
        // Send snapshots so the cleanup endpoint can truncate session files
        sessionSnapshots: snapshots,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
