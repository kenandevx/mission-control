export async function getAgendaOccurrenceColumns(sql) {
  const rows = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'agenda_occurrences'
  `;
  return new Set(rows.map((r) => r.column_name));
}

export async function assertAgendaSchema(sql) {
  const columns = await getAgendaOccurrenceColumns(sql);

  // v1 columns (still used)
  const required = [
    'retry_requested_at',
    'latest_attempt_no',
    'last_retry_reason',
  ];

  // v2 columns (cron-based engine)
  const requiredV2 = [
    'cron_job_id',
    'fallback_attempted',
  ];

  const missing = [...required, ...requiredV2].filter((name) => !columns.has(name));
  if (missing.length > 0) {
    throw new Error(`agenda_occurrences schema mismatch; missing columns: ${missing.join(', ')}. Run DB migration.`);
  }

  return { ok: true, missing: [] };
}
