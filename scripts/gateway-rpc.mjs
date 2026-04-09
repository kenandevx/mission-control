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

let _callGateway = null;

/**
 * Lazily load callGateway from OpenClaw's dist.
 * First call incurs ~1.5s module loading; cached after that.
 */
async function getCallGateway() {
  if (!_callGateway) {
    const mod = await import("/usr/lib/node_modules/openclaw/dist/call-Iw4xDZUX.js");
    _callGateway = mod.r;
    if (typeof _callGateway !== "function") {
      throw new Error("Failed to import callGateway from OpenClaw dist");
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
