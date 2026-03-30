import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(process.cwd());

type Json = Record<string, unknown>;
const ok = (data: Json = {}) => NextResponse.json({ ok: true, ...data });
const fail = (msg: string, status = 400) => NextResponse.json({ ok: false, error: msg }, { status });

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Json;
    const action = String(body.action || "");

    if (action === "checkUpdates") {
      try {
        await execFileAsync("git", ["fetch", "--quiet"], { cwd: PROJECT_ROOT, timeout: 15000 });
        const { stdout } = await execFileAsync("git", ["rev-list", "HEAD..origin/main", "--count"], { cwd: PROJECT_ROOT, timeout: 5000 });
        const behind = parseInt(stdout.trim(), 10) || 0;
        let latestCommit = "";
        if (behind > 0) {
          const { stdout: logOut } = await execFileAsync("git", ["log", "origin/main", "-1", "--format=%s"], { cwd: PROJECT_ROOT, timeout: 5000 });
          latestCommit = logOut.trim();
        }
        return ok({ behind, latestCommit });
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Failed to check updates");
      }
    }

    if (action === "update") {
      try {
        const { stdout: pullOut } = await execFileAsync("git", ["pull", "--ff-only"], { cwd: PROJECT_ROOT, timeout: 30000 });
        await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: PROJECT_ROOT, timeout: 120000 });
        // Run DB migrations (schema.sql uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, safe to re-run)
        try {
          await execFileAsync("docker", ["compose", "exec", "-T", "db", "psql", "-U", "openclaw", "-d", "mission_control", "-f", "/workspace/db/schema.sql"], { cwd: PROJECT_ROOT, timeout: 30000 });
        } catch (dbErr) {
          console.warn("[system] DB migration warning (non-fatal):", dbErr instanceof Error ? dbErr.message : dbErr);
        }
        await execFileAsync("npx", ["next", "build"], { cwd: PROJECT_ROOT, timeout: 180000 });
        const mcServices = resolve(PROJECT_ROOT, "scripts/mc-services.sh");
        if (existsSync(mcServices)) {
          await execFileAsync("bash", [mcServices, "restart"], { cwd: PROJECT_ROOT, timeout: 30000 });
        }
        return ok({ message: "Update complete. Migrations applied, services restarted.", pullOutput: pullOut.trim() });
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Update failed");
      }
    }

    if (action === "cleanReset") {
      try {
        const mcServices = resolve(PROJECT_ROOT, "scripts/mc-services.sh");

        // Keep Next.js running (dev/start), only wipe DB contents and restart workers.
        await execFileAsync(
          "docker",
          ["compose", "exec", "-T", "db", "psql", "-U", "openclaw", "-d", "mission_control", "-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"],
          { cwd: PROJECT_ROOT, timeout: 30000 },
        );
        await execFileAsync("docker", ["compose", "run", "--rm", "db-init"], {
          cwd: PROJECT_ROOT,
          timeout: 120000,
        });

        // Purge all runtime-generated artifacts inside this workspace.
        const artifactsRoot = resolve(PROJECT_ROOT, "runtime-artifacts");
        await rm(artifactsRoot, { recursive: true, force: true });
        await mkdir(artifactsRoot, { recursive: true });

        // Restart only persistent worker services (not nextjs), so dev/start UI stays alive.
        if (existsSync(mcServices)) {
          for (const svc of ["task-worker", "bridge-logger", "agenda-scheduler", "agenda-worker"]) {
            await execFileAsync("bash", [mcServices, "restart", svc], { cwd: PROJECT_ROOT, timeout: 30000 }).catch(() => {});
          }
        }

        return ok({ message: "Clean reset complete. Database and runtime artifacts wiped; worker services restarted." });
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Clean reset failed");
      }
    }

    if (action === "uninstall") {
      try {
        const mcServices = resolve(PROJECT_ROOT, "scripts/mc-services.sh");
        if (existsSync(mcServices)) {
          await execFileAsync("bash", [mcServices, "stop"], { cwd: PROJECT_ROOT, timeout: 15000 }).catch(() => {});
        }
        await execFileAsync("docker", ["compose", "down", "--volumes", "--remove-orphans"], { cwd: PROJECT_ROOT, timeout: 30000 }).catch(() => {});
        for (const cmd of ["mc-services", "mc-update", "mc-clean"]) {
          await execFileAsync("rm", ["-f", `/usr/local/bin/${cmd}`]).catch(() => {});
        }
        return ok({ message: "Mission Control uninstalled. Services stopped, volumes removed. You can safely delete this directory." });
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Uninstall failed");
      }
    }

    return fail(`Unknown action: ${action}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "System operation failed", 500);
  }
}
