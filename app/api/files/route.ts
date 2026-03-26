import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

/**
 * GET /api/files?path=/home/clawdbot/.openclaw/workspace/hello.md
 *
 * Serves files from allowed directories for ticket attachment downloads.
 * Only paths under ALLOWED_ROOTS can be served.
 */

const ALLOWED_ROOTS = [
  "/home/clawdbot/.openclaw/workspace",
  "/home/clawdbot/.openclaw",
  "/storage",
  "/tmp",
];

const MIME_MAP: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".toml": "application/toml",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".log": "text/plain",
  ".sh": "text/x-shellscript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".css": "text/css",
  ".py": "text/x-python",
  ".rs": "text/x-rust",
  ".go": "text/x-go",
  ".sql": "application/sql",
  ".env": "text/plain",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

function isAllowed(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  // Prevent path traversal
  if (resolved !== filePath && resolved !== path.normalize(filePath)) {
    // Allow both — resolve handles symlinks, normalize handles ..
  }
  return ALLOWED_ROOTS.some((root) => resolved.startsWith(root + "/") || resolved === root);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ ok: false, error: "Missing path parameter" }, { status: 400 });
  }

  const resolved = path.resolve(filePath);

  if (!isAllowed(resolved)) {
    return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return NextResponse.json({ ok: false, error: "Not a file" }, { status: 400 });
    }

    const buffer = fs.readFileSync(resolved);
    const mimeType = getMimeType(resolved);
    const fileName = path.basename(resolved);
    const forceDownload = request.nextUrl.searchParams.get("download") === "1";

    // For images and PDFs, allow inline viewing; for others, force download
    const inlineTypes = ["image/", "application/pdf", "text/"];
    const isInline = !forceDownload && inlineTypes.some((t) => mimeType.startsWith(t));
    const disposition = isInline
      ? `inline; filename="${fileName}"`
      : `attachment; filename="${fileName}"`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": disposition,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "File not found";
    if (message.includes("ENOENT")) {
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
