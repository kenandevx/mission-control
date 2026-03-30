import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join, resolve } from "path";

export async function GET(): Promise<NextResponse> {
  try {
    const configPath = resolve(process.env.OPENCLAW_DIR ?? join(process.env.HOME ?? "/home/clawdbot", ".openclaw"), "openclaw.json");
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const agents = config.agents as { defaults?: { models?: Record<string, { alias?: string }>; model?: { primary?: string } }; list?: { id: string; model?: string }[] } | undefined;

    const defaults = agents?.defaults ?? {};
    const configuredModels = defaults.models ?? {};

    // Build model list from agents.defaults.models
    const models = Object.entries(configuredModels).map(([id, meta]) => ({
      id,
      alias: meta?.alias ?? id,
    }));

    // Sort: alias first if present, otherwise alphabetical
    models.sort((a, b) => {
      const aIsAlias = a.alias !== a.id;
      const bIsAlias = b.alias !== b.id;
      if (aIsAlias && !bIsAlias) return -1;
      if (!aIsAlias && bIsAlias) return 1;
      return a.alias.localeCompare(b.alias);
    });

    return NextResponse.json({
      models,
      defaultModel: (defaults as Record<string,unknown>).defaultModel ?? null,
    });
  } catch (err) {
    console.error("[models] Failed to read openclaw.json:", err);
    return NextResponse.json({ models: [], defaultModel: null }, { status: 500 });
  }
}
