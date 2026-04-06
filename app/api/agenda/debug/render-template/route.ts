import { NextResponse } from "next/server";
import { renderUnifiedTaskMessage } from "../../../../../scripts/prompt-renderer.mjs";

type Json = Record<string, unknown>;

const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });
const fail = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status });

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Json;
    const title = String(body.title || "");
    const context = String(body.context || "");
    const requestText = String(body.request || "");
    const instructions = Array.isArray(body.instructions) ? body.instructions as Array<Record<string, unknown>> : [];

    const artifactDir = body.artifactDir ? String(body.artifactDir) : undefined;
    const message = renderUnifiedTaskMessage({
      title,
      context,
      request: requestText,
      instructions,
      artifactDir,
    });

    return ok({ message });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to render template", 500);
  }
}
