/**
 * Prompt template v2.3 — unified task message renderer.
 * v2.3 changes: consolidated execution rules (7 near-duplicate bullets → 3
 * focused ones) and tightened output rules for clearer LLM comprehension.
 * Same semantics as v2.2: no meta-commentary, artifacts go in the artifact
 * directory, final response goes in `response.md`.
 *
 * When you modify these rules, existing events continue using whatever
 * rendered_prompt they already have (persisted at schedule time).
 * Only new cron runs and manual retries will pick up the new template.
 */

function isGenericTitle(value) {
  const t = String(value || "").trim().toLowerCase();
  if (!t) return true;
  const generic = new Set(["new event", "event", "test", "untitled", "new task", "task"]);
  return generic.has(t);
}

function clean(v) {
  return String(v ?? "").trim();
}

export function renderUnifiedTaskMessage({ title, context, request, instructions, artifactDir }) {
  const sections = [];

  const t = clean(title);
  if (t && !isGenericTitle(t)) sections.push(`Task:\n${t}`);

  const c = clean(context);
  if (c) sections.push(`Context:\n${c}`);

  const validInstructions = Array.isArray(instructions)
    ? instructions
      .map((s, idx) => {
        const stepNo = Number(s?.order ?? idx + 1);
        const stepTitle = clean(s?.title) || `Step ${stepNo}`;
        const stepInstruction = clean(s?.instruction);
        if (!stepInstruction) return null;
        const skillTag = clean(s?.skillKey) ? ` [Skill: ${clean(s.skillKey)}]` : "";
        return `${stepNo}. ${stepTitle}${skillTag} — ${stepInstruction}`;
      })
      .filter(Boolean)
    : [];

  if (validInstructions.length > 0) {
    sections.push(`Instructions:\n${validInstructions.join("\n")}`);
  }

  const r = clean(request);
  if (r) sections.push(`Request:\n${r}`);

  // Execution rules — how to approach the task.
  const executionRules = [
    "- Start with the deliverable. No preamble, plans, or meta-commentary ('I will...', 'Using X...', 'Let me...').",
    "- Any skills, tools, or models named in the request are implementation guidance — use them silently. Don't announce or describe your tool choice.",
    "- Produce content directly (text, code, images, files). Don't describe what you're about to do — do it.",
  ];
  sections.push(`Execution rules:\n${executionRules.join("\n")}`);

  // Output rules — what the final output must contain.
  const ad = clean(artifactDir);
  const outputRules = [
    "- Return only the requested deliverable. No internal labels, IDs, section headers, or system metadata echoed back.",
    "- Don't fabricate facts. If something required is missing, state what's missing rather than inventing it.",
  ];
  if (ad) {
    outputRules.push(`- Artifact directory: ${ad}`);
    outputRules.push("- Save every file you create, download, fetch, or reference (assets, images, PDFs, guides — anything) into the artifact directory above. Never save files anywhere else in the workspace.");
    outputRules.push("- Also write your final written response to `response.md` inside the artifact directory. Produce the response inline as normal — `response.md` is how Mission Control captures it.");
  }
  sections.push(`Output rules:\n${outputRules.join("\n")}`);

  return sections.filter((s) => clean(s)).join("\n\n");
}

export const TEMPLATE_VERSION = 2.3;
