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
  const required = [
    'queue_job_id',
    'queued_at',
    'retry_requested_at',
    'latest_attempt_no',
    'last_retry_reason',
  ];

  const missing = required.filter((name) => !columns.has(name));
  if (missing.length > 0) {
    throw new Error(`agenda_occurrences schema mismatch; missing columns: ${missing.join(', ')}`);
  }

  return { ok: true, missing: [] };
}
