/**
 * Shared OpenClaw config reader.
 * Reads ~/.openclaw/openclaw.json directly (not `openclaw config get` which redacts secrets).
 * Single source of truth for gateway token, URL, and paths.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || resolve(process.env.HOME || "/home/clawdbot", ".openclaw");

let _cached = null;

/**
 * Read and cache openclaw.json. Returns the parsed config object.
 * Handles JSON5-like trailing commas that OpenClaw sometimes writes.
 */
function loadConfig() {
  if (_cached) return _cached;
  const configPath = resolve(OPENCLAW_HOME, "openclaw.json");
  const raw = readFileSync(configPath, "utf8");
  // Strip trailing commas before } or ] (OpenClaw writes JSON5-ish files)
  const cleaned = raw.replace(/,(\s*[}\]])/g, "$1");
  _cached = JSON.parse(cleaned);
  return _cached;
}

/** Clear cached config (e.g. after token rotation). */
export function clearConfigCache() {
  _cached = null;
}

/** Gateway auth token from openclaw.json → gateway.auth.token */
export function getGatewayToken() {
  try {
    const cfg = loadConfig();
    return String(cfg?.gateway?.auth?.token || "").trim() || null;
  } catch {
    return null;
  }
}

/** Gateway WebSocket URL constructed from bind + port in openclaw.json */
export function getGatewayUrl() {
  try {
    const cfg = loadConfig();
    const port = cfg?.gateway?.port || 18789;
    const bind = cfg?.gateway?.bind || "loopback";
    const host = bind === "loopback" ? "127.0.0.1" : bind;
    return `ws://${host}:${port}`;
  } catch {
    return "ws://127.0.0.1:18789";
  }
}

/** Gateway HTTP base URL (for hooks, REST endpoints) */
export function getGatewayHttpUrl() {
  try {
    const cfg = loadConfig();
    const port = cfg?.gateway?.port || 18789;
    const bind = cfg?.gateway?.bind || "loopback";
    const host = bind === "loopback" ? "127.0.0.1" : bind;
    return `http://${host}:${port}`;
  } catch {
    return "http://127.0.0.1:18789";
  }
}

/** OPENCLAW_HOME path */
export function getOpenClawHome() {
  return OPENCLAW_HOME;
}
