import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rootDir = process.cwd();
const envPath = resolve(rootDir, ".env");
const seedPath = resolve(rootDir, "db", "seed.sql");
const schemaPath = resolve(rootDir, "db", "schema.sql");

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

function getDbUrl() {
  return process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32", cwd: rootDir });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runSqlFile(dbUrl, filePath) {
  if (!existsSync(filePath)) {
    console.error(`SQL file not found: ${filePath}`);
    process.exit(1);
  }
  run("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", filePath]);
}

async function wipePublicSchema(dbUrl) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql.unsafe(`do $$ declare r record; begin
      for r in select tablename from pg_tables where schemaname='public' loop execute format('drop table if exists public.%I cascade', r.tablename); end loop;
      for r in select sequence_name from information_schema.sequences where sequence_schema='public' loop execute format('drop sequence if exists public.%I cascade', r.sequence_name); end loop;
    end $$;`);
  } finally {
    await sql.end();
  }
}

async function confirmReset() {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("This will delete app tables/data in public. Continue? (yes/no): ");
    const normalized = answer.trim().toLowerCase();
    return normalized === "yes" || normalized === "y";
  } finally {
    rl.close();
  }
}

loadEnvFile(envPath);

async function main() {
  const mode = process.argv[2] ?? "setup";
  const dbUrl = getDbUrl() || "postgresql://openclaw:openclaw@localhost:5432/mission_control";

  if (mode === "migrate" || mode === "setup") {
    runSqlFile(dbUrl, schemaPath);
    if (existsSync(seedPath)) runSqlFile(dbUrl, seedPath);
    process.exit(0);
  }

  if (mode === "seed") {
    runSqlFile(dbUrl, seedPath);
    process.exit(0);
  }

  if (mode === "reset") {
    const confirmed = await confirmReset();
    if (!confirmed) {
      console.log("Cancelled.");
      process.exit(0);
    }
    await wipePublicSchema(dbUrl);
    console.log("Wipe complete. Run `npm run db:setup` to recreate schema.");
    process.exit(0);
  }

  console.error(`Unknown mode "${mode}". Use: migrate | seed | setup | reset`);
  process.exit(1);
}

await main();
