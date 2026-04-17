import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ stepId: string; filename: string }> },
) {
  try {
    const sql = getSql();
    const { stepId, filename } = await params;

    const [step] = await sql`
      select artifact_payload from agenda_run_steps where id = ${stepId}
    `;

    // Handle both properly-encoded jsonb and double-stringified legacy data
    let payload = step?.artifact_payload;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch { payload = null; }
    }

    if (!payload?.files) {
      return NextResponse.json({ ok: false, error: "No artifacts" }, { status: 404 });
    }

    const file = (payload.files as { name: string; mimeType: string; path: string }[]).find(
      (f) => f.name === decodeURIComponent(filename)
    );

    if (!file || !file.path || !existsSync(file.path)) {
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }

    const data = await readFile(file.path);
    // Serve inline so <img>/Next Image can render previews.
    // The detail sheet's download link uses <a download={...}> which forces the
    // browser to download same-origin files regardless of Content-Disposition,
    // so switching away from "attachment" doesn't break the download button.
    const safeFilename = file.name.replace(/"/g, '');
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${safeFilename}"`,
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}
