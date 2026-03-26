import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

type SkillInfo = {
  key: string;
  name: string;
  description: string;
};

export async function GET() {
  try {
    // Try to read installed skills from openclaw config
    const homeDir = process.env.HOME || "/home/clawdbot";
    const openclawDir = resolve(homeDir, ".openclaw");

    // Read skills from openclaw extensions directory
    const extensionsDir = resolve(openclawDir, "extensions");
    const skills: SkillInfo[] = [];

    if (existsSync(extensionsDir)) {
      const { readdirSync } = await import("fs");
      try {
        const entries = readdirSync(extensionsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillKey = entry.name;
            const pkgPath = resolve(extensionsDir, skillKey, "package.json");
            if (existsSync(pkgPath)) {
              try {
                const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
                skills.push({
                  key: skillKey,
                  name: pkg.name || skillKey,
                  description: pkg.description || "",
                });
              } catch {
                skills.push({ key: skillKey, name: skillKey, description: "" });
              }
            }
          }
        }
      } catch {
        // Extensions dir not readable
      }
    }

    // Also try openclaw CLI for installed skills
    try {
      const result = execSync("openclaw skills list --json 2>/dev/null || echo '[]'", {
        timeout: 5000,
        encoding: "utf8",
      });
      const cliSkills = JSON.parse(result);
      if (Array.isArray(cliSkills)) {
        for (const s of cliSkills) {
          if (!skills.find((existing) => existing.key === s.key)) {
            skills.push({ key: s.key, name: s.name || s.key, description: s.description || "" });
          }
        }
      }
    } catch {
      // CLI not available or returned non-JSON
    }

    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json({ skills: [], error: error instanceof Error ? error.message : "Failed to load skills" }, { status: 200 });
  }
}
