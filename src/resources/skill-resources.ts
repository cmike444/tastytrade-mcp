import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = join(__dirname, "../../skills");

interface SkillData {
  name: string;
  description: string;
  mainContent: string;
  references: Map<string, string>;
}

function loadSkill(skillDir: string): SkillData | null {
  const skillMdPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) return null;

  const mainContent = readFileSync(skillMdPath, "utf-8");

  const nameMatch = mainContent.match(/^name:\s*(.+)$/m);
  const descMatch = mainContent.match(/^description:\s*>?\s*\n([\s\S]*?)(?=^[a-z]|\n---)/m)
    ?? mainContent.match(/^description:\s*(.+)$/m);

  const name = nameMatch?.[1].trim() ?? basename(skillDir);
  const rawDesc = descMatch?.[1] ?? descMatch?.[0]?.replace(/^description:\s*/, "") ?? "";
  const description = rawDesc.replace(/\s+/g, " ").trim().slice(0, 200);

  const references = new Map<string, string>();
  const refsDir = join(skillDir, "references");
  if (existsSync(refsDir)) {
    for (const file of readdirSync(refsDir)) {
      if (extname(file) === ".md") {
        const refName = basename(file, ".md");
        references.set(refName, readFileSync(join(refsDir, file), "utf-8"));
      }
    }
  }

  return { name, description, mainContent, references };
}

function loadAllSkills(): Map<string, SkillData> {
  const skills = new Map<string, SkillData>();
  if (!existsSync(SKILLS_ROOT)) return skills;

  for (const entry of readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(SKILLS_ROOT, entry.name);
    const skill = loadSkill(skillDir);
    if (skill) {
      skills.set(entry.name, skill);
    }
  }
  return skills;
}

const SKILLS_MAP = loadAllSkills();

export const SKILLS = Array.from(SKILLS_MAP.values()).map(s => ({
  name: s.name,
  dirName: Array.from(SKILLS_MAP.entries()).find(([, v]) => v === s)?.[0] ?? s.name,
  description: s.description,
}));

export function getSkillContent(dirName: string, section?: string): string | null {
  const skill = SKILLS_MAP.get(dirName);
  if (!skill) return null;

  if (!section) return skill.mainContent;

  // Check if section matches a reference file name first
  const refKey = section.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  for (const [key, content] of skill.references) {
    if (key.toLowerCase() === refKey || key.toLowerCase().replace(/-/g, "") === refKey.replace(/-/g, "")) {
      return content;
    }
  }
  // Also check by plain name
  if (skill.references.has(section)) return skill.references.get(section)!;

  // Fall back to heading extraction from main content
  return extractSection(skill.mainContent, section);
}

function extractSection(content: string, section: string): string {
  const lines = content.split("\n");
  const normalizedSection = section.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

  let startLine = -1;
  let startDepth = 0;

  // Exact/prefix heading match first
  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (!headingMatch) continue;
    const depth = headingMatch[1].length;
    const title = headingMatch[2].toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    if (title === normalizedSection || title.startsWith(normalizedSection)) {
      startLine = i;
      startDepth = depth;
      break;
    }
  }

  // Fallback: substring match
  if (startLine === -1) {
    for (let i = 0; i < lines.length; i++) {
      const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (!headingMatch) continue;
      const depth = headingMatch[1].length;
      const title = headingMatch[2].toLowerCase();
      if (title.includes(section.toLowerCase())) {
        startLine = i;
        startDepth = depth;
        break;
      }
    }
  }

  if (startLine === -1) return content;

  const sectionLines: string[] = [lines[startLine]];
  for (let i = startLine + 1; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#{1,6})\s+/);
    if (headingMatch && headingMatch[1].length <= startDepth) break;
    sectionLines.push(lines[i]);
  }
  return sectionLines.join("\n");
}

export function listSkillReferences(dirName: string): Array<{ name: string; path: string }> {
  const skill = SKILLS_MAP.get(dirName);
  if (!skill) return [];
  return Array.from(skill.references.keys()).map(name => ({
    name,
    path: `${dirName}/references/${name}`,
  }));
}

export function registerSkillResources(server: McpServer) {
  for (const [dirName, skill] of SKILLS_MAP) {
    // Main SKILL.md resource
    server.resource(
      `skill-${dirName}`,
      `skill://${dirName}`,
      {
        description: skill.description,
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [{ uri: uri.toString(), mimeType: "text/markdown", text: skill.mainContent }],
      })
    );

    // Register each reference file as its own resource
    for (const [refName, refContent] of skill.references) {
      server.resource(
        `skill-${dirName}-ref-${refName}`,
        `skill://${dirName}/references/${refName}`,
        {
          description: `Reference: ${refName} (part of ${dirName} skill)`,
          mimeType: "text/markdown",
        },
        async (uri) => ({
          contents: [{ uri: uri.toString(), mimeType: "text/markdown", text: refContent }],
        })
      );
    }
  }

  // Backward-compat alias: skill://tastytrade/overview → tastytrade main
  const tastytrade = SKILLS_MAP.get("tastytrade");
  if (tastytrade) {
    server.resource(
      "skill-tastytrade-overview",
      "skill://tastytrade/overview",
      { description: "TastyTrade skill guide (alias for skill://tastytrade)", mimeType: "text/markdown" },
      async (uri) => ({
        contents: [{ uri: uri.toString(), mimeType: "text/markdown", text: tastytrade.mainContent }],
      })
    );
  }
}
