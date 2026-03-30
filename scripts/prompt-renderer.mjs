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
  sections.push("You are handling one task. Use only the information below.");

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

  const ad = clean(artifactDir);
  const outputRules = [
    "- Return only the requested deliverable.",
    "- Do not include internal labels, IDs, or system metadata.",
    "- Do not repeat section labels unless they help the final result.",
    "- Do not invent missing facts.",
  ];
  if (ad) {
    outputRules.push(`- If you create any output files, save them to: ${ad}`);
  }
  sections.push(`Output rules:\n${outputRules.join("\n")}`);

  return sections.filter((s) => clean(s)).join("\n\n");
}
