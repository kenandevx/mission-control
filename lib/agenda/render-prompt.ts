/**
 * Shared prompt-rendering logic for agenda occurrences.
 * Used by both the scheduler (via direct import) and API routes (force-retry re-render).
 *
 * Extracts process steps and calls renderUnifiedTaskMessage.
 * The rendered string is persisted in agenda_occurrences.rendered_prompt.
 */

import { getSql } from "@/lib/local-db";
import { renderUnifiedTaskMessage } from "@/scripts/prompt-renderer.mjs";
import { getRunArtifactDir } from "@/scripts/runtime-artifacts.mjs";

type Sql = ReturnType<typeof getSql>;

interface AgendaEvent {
  id: string;
  title: string;
  free_prompt?: string | null;
}

/**
 * Render the full task prompt for an event + occurrence.
 * Loads all linked process versions and their steps from the DB.
 */
export async function renderPromptForOccurrence(
  sql: Sql,
  event: AgendaEvent,
  occurrenceId: string,
): Promise<string> {
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

  const artifactDir = getRunArtifactDir({
    kind: "agenda",
    entityId: event.id,
    occurrenceId,
    runId: "artifacts",
  });

  return renderUnifiedTaskMessage({
    title: event.title,
    context: "",
    instructions: composedSteps,
    request: event.free_prompt ? String(event.free_prompt) : "",
    artifactDir,
  });
}
