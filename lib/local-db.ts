import postgres from "postgres";

const connectionString = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
let sql: postgres.Sql | null = null;

export function getSql() {
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL or OPENCLAW_DATABASE_URL.");
  }
  if (!sql) {
    sql = postgres(connectionString, {
      max: 10,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}

export async function closeSql() {
  if (!sql) return;
  await sql.end({ timeout: 5 });
  sql = null;
}
