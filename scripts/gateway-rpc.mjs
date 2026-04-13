/**
 * gateway-rpc.mjs — Direct gateway RPC client for Mission Control.
 *
 * Instead of spawning `openclaw cron ...` CLI subprocesses (~10s CPU each due
 * to full Node.js cold boot), this module imports OpenClaw's callGateway()
 * directly. First call takes ~1.5s (module load + WS handshake), subsequent
 * calls take ~9ms each (fresh WS connection but modules already cached).
 *
 * This eliminates the CPU oscillation caused by the scheduler spawning a
 * heavy CLI process every 15 seconds.
 *
 * Usage:
 *   import { callCron } from "./gateway-rpc.mjs";
 *   const jobs = await callCron("cron.list", {});
 *   const result = await callCron("cron.add", { name: "test", ... });
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

const OPENCLAW_DIST = "/usr/lib/node_modules/openclaw/dist";

let _callGateway = null;

/**
 * Lazily load callGateway from OpenClaw's dist.
 * Discovers the call-*.js chunk dynamically so it survives openclaw updates
 * that change the content-hash in the filename.
 * First call incurs ~1.5s module loading; cached after that.
 */
async function getCallGateway() {
  if (!_callGateway) {
    let chunkFile;
    try {
      const files = readdirSync(OPENCLAW_DIST);
      chunkFile = files.find((f) => f.startsWith("call-") && f.endsWith(".js"));
    } catch {
      throw new Error(`Cannot read OpenClaw dist directory: ${OPENCLAW_DIST}`);
    }
    if (!chunkFile) {
      throw new Error(`No call-*.js chunk found in ${OPENCLAW_DIST} — is openclaw installed?`);
    }
    const mod = await import(join(OPENCLAW_DIST, chunkFile));
    // Try known export names first, then fall back to scanning all exports
    // for a single-argument async function (the gateway caller).
    _callGateway =
      (typeof mod.r === "function" && mod.r) ||
      (typeof mod.callGateway === "function" && mod.callGateway) ||
      Object.values(mod).find((v) => typeof v === "function");
    if (typeof _callGateway !== "function") {
      throw new Error(
        `No callable export found in ${chunkFile}. Exports: ${Object.keys(mod).join(", ")}`
      );
    }
  }
  return _callGateway;
}

/**
 * Call a gateway RPC method directly (no subprocess).
 * @param {string} method - e.g. "cron.list", "cron.add", "cron.status"
 * @param {object} params - method parameters
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<any>}
 */
export async function callCron(method, params = {}, opts = {}) {
  const callGateway = await getCallGateway();
  return callGateway({
    method,
    params,
    timeoutMs: opts.timeoutMs || 15000,
  });
}
