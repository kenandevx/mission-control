/**
 * Shared prompt-rendering logic for agenda occurrences.
 * Used by both the scheduler (via direct import) and API routes (force-retry re-render).
 *
 * Extracts process steps and calls renderUnifiedTaskMessage.
 * The rendered string is persisted in agenda_occurrences.rendered_prompt.
 */

import { getSql } from "@/lib/local-db";
import { renderUnifiedTaskMessage } from "@/scripts/prompt-renderer.mjs";
import { getOccurrenceArtifactDir } from "@/scripts/runtime-artifacts.mjs";

type Sql = ReturnType<typeof getSql>;

interface AgendaEvent {
  id: string;
  title: string;
  free_prompt?: string | null;
  session_target?: string | null;
}

/**
 * Render the full task prompt for an event + occurrence.
 * Loads all linked process versions and their steps from the DB.
 *
 * When session_target is 'main', a minimal prompt is used (no Execution rules,
 * no Output rules) to prevent framework instructions from leaking into the
 * user's main session chat.
 */
export async function renderPromptForOccurrence(
  sql: Sql,
  event: AgendaEvent,
  occurrenceId: string,
): Promise<string> {
  const [override] = await sql`
    SELECT overridden_title, overridden_free_prompt
    FROM agenda_occurrence_overrides
    WHERE occurrence_id = ${occurrenceId}
    LIMIT 1
  `;

  const effectiveTitle = String(override?.overridden_title || event.title || "Agenda task").trim();
  const effectiveRequest = override?.overridden_free_prompt !== undefined && override?.overridden_free_prompt !== null
    ? String(override.overridden_free_prompt)
    : (event.free_prompt ? String(event.free_prompt) : "");

  // Load linked process versions
  const processes = await sql`
    SELECT aep.process_version_id, aep.sort_order
    FROM agenda_event_processes aep
    WHERE aep.agenda_event_id = ${event.id}
    ORDER BY aep.sort_order ASC
  `;

  const composedSteps: Array<{
    order: number;
    title: string;
    instruction: string;
    skillKey: string | null;
  }> = [];

  let seq = 1;
  for (const proc of processes) {
    const stepRows = await sql`
      SELECT * FROM process_steps
      WHERE process_version_id = ${proc.process_version_id}
      ORDER BY step_order ASC
    `;
    for (const stepRow of stepRows) {
      composedSteps.push({
        order: seq++,
        title: stepRow.title ?? `Step ${stepRow.step_order}`,
        instruction: String(stepRow.instruction ?? ""),
        skillKey: stepRow.skill_key ?? null,
      });
    }
  }

  const artifactDir = getOccurrenceArtifactDir({ eventId: event.id, occurrenceId });

  // Main session events get a clean prompt — no internal framework rules.
  // The user WILL see this prompt in their Telegram chat if the session
  // target is 'main', so keep it minimal and user-facing only.
  const isMainSession = event.session_target === "main";

  return renderUnifiedTaskMessage({
    title: effectiveTitle,
    context: "",
    instructions: composedSteps,
    request: effectiveRequest,
    artifactDir,
    isMainSession,
  });
}
