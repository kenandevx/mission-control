import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

export async function GET() {
  try {
    const sql = getSql();
    // Check DB connectivity
    await sql`select 1`;
    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "error", error: "database_unavailable" }, { status: 503 });
  }
}