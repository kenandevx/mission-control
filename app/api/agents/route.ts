import { NextResponse } from "next/server";
import { getCachedAgents, getCachedSessions } from "@/lib/runtime/cache";

export async function GET() {
  try {
    const [registeredAgents, parsedSessions] = await Promise.all([
      getCachedAgents(),
      getCachedSessions(),
    ]);

    // Build session lookup: agentId → { lastHeartbeatAt, status }
    const sessions: Record<string, { lastHeartbeatAt: string | null; status: string }> = {};
    if (parsedSessions && typeof parsedSessions === "object") {
      for (const [agentId, sessionData] of Object.entries(parsedSessions)) {
        if (agentId === "stores" || agentId === "sessions") continue;
        const s = sessionData as Record<string, unknown>;
        if (!s || typeof s !== "object") continue;
        sessions[agentId] = {
          lastHeartbeatAt: (s.lastHeartbeatAt as string | null) ?? null,
          status: (s.status as string) ?? "idle",
        };
      }
    }

    const agents = registeredAgents.map((a) => {
      const runtime = sessions[a.id] ?? {};
      return {
        id: a.id,
        name: a.identityName || a.name || a.id,
        model: a.model ?? null,
        status: runtime.status ?? "idle",
        lastHeartbeatAt: runtime.lastHeartbeatAt ?? null,
        isDefault: a.isDefault ?? false,
      };
    });

    return NextResponse.json({ agents });
  } catch (err) {
    console.error("[/api/agents]", err);
    return NextResponse.json({ agents: [] });
  }
}
