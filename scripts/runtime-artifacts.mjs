import { mkdir, rm, readdir, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";

const ROOT = resolve(process.cwd(), "runtime-artifacts");

function safe(value, fallback = "unknown") {
  const v = String(value ?? fallback).trim() || fallback;
  return v.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getRootArtifactDir() {
  return ROOT;
}

export function getRunArtifactDir({ kind, entityId, occurrenceId, runId }) {
  const k = safe(kind);
  const e = safe(entityId);
  const r = safe(runId);
  if (k === "agenda") {
    return resolve(ROOT, "agenda", e, "occurrences", safe(occurrenceId, "none"), "runs", r);
  }
  if (k === "ticket") {
    return resolve(ROOT, "tickets", e, "runs", r);
  }
  return resolve(ROOT, "adhoc", e, "runs", r);
}

export async function ensureArtifactDir(dir) {
  await mkdir(dir, { recursive: true });
}

/**
 * Compute an artifact dir path WITHOUT creating it.
 * Use this for embedding in prompts — the dir is only created if the agent
 * actually produces artifacts (detected after the run).
 */
export function getRunArtifactDirPath(params) {
  return getRunArtifactDir(params);
}

/**
 * Canonical artifact directory for an agenda occurrence.
 * The agent is told to write output files here.
 * bridge-logger scans this dir (plus any subdirs) after run completion.
 * Path: runtime-artifacts/agenda/{eventId}/occurrences/{occurrenceId}/artifacts
 */
export function getOccurrenceArtifactDir({ eventId, occurrenceId }) {
  return resolve(ROOT, "agenda", safe(eventId), "occurrences", safe(occurrenceId), "artifacts");
}

/**
 * Delete ALL runtime artifacts for a given event (occurrence dirs, runs, etc.).
 * Path: runtime-artifacts/agenda/{safeEventId}/
 * This is called when an event is permanently deleted.
 */
export async function deleteEventArtifacts(eventId) {
  const eventDir = resolve(ROOT, "agenda", safe(eventId));
  try {
    await rm(eventDir, { recursive: true, force: true });
  } catch {
    // Best effort — dir may not exist or already deleted
  }
}

/**
 * Scan all files recursively under a directory (up to 2 levels deep).
 * Used to find files the agent created anywhere under the occurrence dir.
 */
export async function scanArtifactDirRecursive(dir, maxDepth = 2) {
  const files = [];
  async function walk(d, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(resolve(d, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const filePath = resolve(d, entry.name);
        const fstat = await stat(filePath).catch(() => null);
        if (!fstat) continue;
        const ext = extname(entry.name).toLowerCase().slice(1);
        const mimeMap = {
          md: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json",
          pdf: "application/pdf", html: "text/html", xml: "text/xml", yaml: "text/yaml", yml: "text/yaml",
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
          svg: "image/svg+xml", ico: "image/x-icon",
          zip: "application/zip", tar: "application/x-tar", gz: "application/gzip",
          js: "text/javascript", ts: "text/typescript", py: "text/x-python", sh: "text/x-shellscript",
          doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
        files.push({
          name: entry.name,
          mimeType: mimeMap[ext] || "application/octet-stream",
          size: fstat.size,
          path: filePath,
        });
      }
    }
  }
  await walk(dir, 0);
  return files;
}

/**
 * Scan an artifact directory for files the agent created.
 * Returns an array of { name, mimeType, size, path } for each file found.
 */
export async function scanArtifactDir(dir) {
  const files = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = resolve(dir, entry.name);
      const fstat = await stat(filePath);
      const ext = extname(entry.name).toLowerCase().slice(1);
      const mimeMap = {
        md: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json",
        pdf: "application/pdf", html: "text/html", xml: "text/xml", yaml: "text/yaml", yml: "text/yaml",
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
        svg: "image/svg+xml", ico: "image/x-icon",
        zip: "application/zip", tar: "application/x-tar", gz: "application/gzip",
        js: "text/javascript", ts: "text/typescript", py: "text/x-python", sh: "text/x-shellscript",
        doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
      files.push({
        name: entry.name,
        mimeType: mimeMap[ext] || "application/octet-stream",
        size: fstat.size,
        path: filePath,
      });
    }
  } catch {
    // Dir doesn't exist or is empty — that's fine
  }
  return files;
}

/**
 * Clean up a failed run's artifact directory.
 * Deletes the entire run-scoped directory (isolated by design).
 */
export async function cleanupRunArtifacts(dir) {
  if (!dir || !dir.startsWith(ROOT)) return; // Safety: only delete within artifact root
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}

/**
 * Legacy: write request/response/meta to artifact dir.
 * Kept for backward compatibility.
 */
export async function writeRunArtifacts({ dir, requestText, responseText, meta }) {
  const { writeFile } = await import("node:fs/promises");
  await ensureArtifactDir(dir);
  if (typeof requestText === "string") await writeFile(resolve(dir, "request.md"), requestText, "utf8");
  if (typeof responseText === "string") await writeFile(resolve(dir, "response.md"), responseText, "utf8");
  if (meta) await writeFile(resolve(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

export async function purgeRuntimeArtifacts() {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(ROOT, { recursive: true });
}
