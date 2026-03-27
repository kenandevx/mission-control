import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";

type SkillInfo = {
  key: string;
  name: string;
  description: string;
};

type SkillsCache = {
  at: number;
  skills: SkillInfo[];
};

let skillsCache: SkillsCache | null = null;
const SKILLS_CACHE_TTL_MS = 60_000;

function loadSkillsFromFs(): SkillInfo[] {
  const homeDir = process.env.HOME || "/home/clawdbot";
  const skills: SkillInfo[] = [];

  const skillsDirs = [
    resolve(homeDir, ".openclaw/workspace/skills"),
    resolve(homeDir, ".openclaw/skills"),
  ];

  for (const dir of skillsDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillKey = entry.name;
        if (skills.some((s) => s.key === skillKey)) continue;

        const skillMdPath = resolve(dir, skillKey, "SKILL.md");
        if (!existsSync(skillMdPath)) continue;

        try {
          const content = readFileSync(skillMdPath, "utf8");
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          let name = skillKey;
          let description = "";
          if (fmMatch) {
            const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
            const descMatch = fmMatch[1].match(/^description:\s*(.+)$/m);
            if (nameMatch) name = nameMatch[1].trim();
            if (descMatch) description = descMatch[1].trim();
          }
          skills.push({ key: skillKey, name, description });
        } catch {
          skills.push({ key: skillKey, name: skillKey, description: "" });
        }
      }
    } catch {
      // ignore unreadable dir
    }
  }

  return skills;
}

export async function GET() {
  try {
    const now = Date.now();
    if (skillsCache && now - skillsCache.at < SKILLS_CACHE_TTL_MS) {
      return NextResponse.json({ skills: skillsCache.skills });
    }

    const skills = loadSkillsFromFs();
    skillsCache = { at: now, skills };
    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json(
      { skills: [], error: error instanceof Error ? error.message : "Failed to load skills" },
      { status: 200 },
    );
  }
}
