/**
 * Prompt template v2.1 — unified task message renderer.
 * v2.1 changes: restored explicit skill-reference instruction to prevent meta-commentary.
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

  // Execution rules — always included, regardless of session target.
  const executionRules = [
    "- Treat any mentioned skills, tools, or models as implementation guidance unless the request explicitly asks you to talk about them.",
    "- Do not respond with meta acknowledgements like 'I will', 'Using...', or tool-selection commentary unless the request explicitly asks for a plan.",
    "- Never announce which skill, tool, or method you're about to use. Just do the work.",
    "- If the request mentions a skill or tool by name, silently use it — do not describe your tool choice.",
    "- Start your response with the deliverable, not with commentary about how you'll produce it.",
    "- If you're generating content (text, code, images, etc.), output the content directly.",
    "- If the user asks for a deliverable, produce the deliverable directly.",
  ];
  sections.push(`Execution rules:\n${executionRules.join("\n")}`);

  // Output rules — always included, regardless of session target.
  const ad = clean(artifactDir);
  const outputRules = [
    "- Return only the requested deliverable.",
    "- Do not include internal labels, IDs, or system metadata.",
    "- Do not repeat section labels unless they help the final result.",
    "- Do not invent missing facts.",
  ];
  if (ad) {
    outputRules.push(`- If you create any output files, save them to: ${ad} (unless the request specifies a different path).`);
  }
  sections.push(`Output rules:\n${outputRules.join("\n")}`);

  return sections.filter((s) => clean(s)).join("\n\n");
}

export const TEMPLATE_VERSION = 2.1;
