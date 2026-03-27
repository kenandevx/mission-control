import { getSql } from "@/lib/local-db";

export async function getInstanceName(): Promise<string> {
  try {
    const sql = getSql();
    const rows = await sql`select instance_name from worker_settings where id = 1 limit 1`;
    const name = String(rows[0]?.instance_name || "").trim();
    return name || "Mission Control";
  } catch {
    return "Mission Control";
  }
}
