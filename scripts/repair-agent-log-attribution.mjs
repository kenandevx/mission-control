import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = process.cwd();
const envPath = resolve(rootDir, ".env.local");
const templateEnvPath = process.env.DASHBOARD_TEMPLATE_ENV?.trim() || "/etc/clawd/template.env";

function loadEnvFile(pathname) {
  if (!existsSync(pathname)) return;
  const source = readFileSync(pathname, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}

loadEnvFile(envPath);
loadEnvFile(templateEnvPath);

const dbUrl = process.env.SUPABASE_DB_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
const workspaceId = process.env.OPENCLAW_WORKSPACE_ID?.trim() || "";

if (!dbUrl) throw new Error("Missing SUPABASE_DB_URL/DATABASE_URL.");
if (!workspaceId) throw new Error("Missing OPENCLAW_WORKSPACE_ID.");

const { default: postgres } = await import("postgres");
const sql = postgres(dbUrl, { max: 1, prepare: false });

try {
  const before = await sql`
    select
      count(*)::int as total,
      count(*) filter (where runtime_agent_id is null and session_key like 'agent:%:%')::int as missing_runtime_with_session
    from public.agent_logs
    where workspace_id = ${workspaceId}
  `;

  const updated = await sql`
    update public.agent_logs
    set runtime_agent_id = split_part(session_key, ':', 2)
    where workspace_id = ${workspaceId}
      and (runtime_agent_id is null or runtime_agent_id = '')
      and session_key like 'agent:%:%'
      and split_part(session_key, ':', 2) <> ''
    returning id
  `;

  const after = await sql`
    select
      count(*)::int as total,
      count(*) filter (where runtime_agent_id='developer-agent')::int as runtime_dev,
      count(*) filter (where session_key ilike 'agent:developer-agent:%')::int as skey_dev,
      count(*) filter (where runtime_agent_id='main')::int as runtime_main,
      count(*) filter (where session_key ilike 'agent:main:%')::int as skey_main
    from public.agent_logs
    where workspace_id = ${workspaceId}
  `;

  console.log(JSON.stringify({
    workspaceId,
    before: before[0],
    updatedFromSessionKey: updated.length,
    after: after[0],
  }, null, 2));
} finally {
  await sql.end();
}
