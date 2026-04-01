import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getCachedAgents, getCachedSessions, getAgentStatuses } from "@/lib/runtime/cache";

function readActiveSessionModel(agentId: string): string | null {
  // Read sessions.json directly to get the active session's model override.
  // sessions.json stores modelOverride per active session (e.g. when a user switches model mid-session).
  // This gives us the *actual* runtime model rather than just the configured default.
  try {
    const sessionsPath = resolve(process.env.OPENCLAW_HOME ?? `${process.env.HOME}/.openclaw`, "agents", agentId, "sessions", "sessions.json");
    if (!existsSync(sessionsPath)) return null;
    const raw = readFileSync(sessionsPath, "utf8");
    const sessions = JSON.parse(raw);

    // Find the most recently updated non-cron, non-subagent session for this agent
    const candidates = Object.entries(sessions)
      .filter(([key]) => !key.includes(":cron:") && !key.includes(":subagent:"))
      .sort(([, a], [, b]) => {
        const aTs = (a as Record<string, unknown>).updatedAt as number ?? 0;
        const bTs = (b as Record<string, unknown>).updatedAt as number ?? 0;
        return bTs - aTs;
      });

    if (!candidates.length) return null;
    const latest = candidates[0][1] as Record<string, unknown>;
    const modelOverride = latest.modelOverride as string | null;
    if (modelOverride) return modelOverride;
    const model = latest.model as string | null;
    return model;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const [registeredAgents] = await Promise.all([
      getCachedAgents(),
      getCachedSessions(), // ensures sessions cache is populated
    ]);

    // Derive status from session activity timestamps
    const agentStatuses = getAgentStatuses();

    const agents = registeredAgents.map((a) => {
      const runtime = agentStatuses[a.id];
      // Prefer the active session's runtime model override over the configured default.
      // This reflects the model actually being used right now.
      const activeModel = readActiveSessionModel(a.id);
      return {
        id: a.id,
        name: a.identityName || a.name || a.id,
        model: activeModel ?? a.model ?? null,
        status: runtime?.status ?? "idle",
        lastHeartbeatAt: runtime?.lastHeartbeatAt ?? null,
        isDefault: a.isDefault ?? false,
      };
    });

    return NextResponse.json({ agents });
  } catch (err) {
    console.error("[/api/agents]", err);
    return NextResponse.json({ agents: [] });
  }
}
