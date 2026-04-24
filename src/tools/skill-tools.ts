import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { getSkillContent, listSkillReferences, SKILLS } from "../resources/skill-resources.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerSkillTools(server: McpServer) {
  server.tool(
    "list_skills",
    "List all available skill guides on this server with their names and one-line descriptions.",
    {},
    READ_ONLY,
    async () => {
      const items = SKILLS.map(s => ({
        name: s.dirName,
        displayName: s.name,
        description: s.description,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
    }
  );

  server.tool(
    "read_skill",
    [
      "Load a skill guide. Call this at the start of any session to prime yourself with tool references, symbol formats, and trading workflows.",
      "Use 'name' to select a skill: 'tastytrade' (MCP tool guide + expert assistant), 'trading-strategies' (7-strategy quantitative playbook), 'markov-regime' (regime classifier).",
      "Use 'section' to load a specific section heading or reference file (e.g. 'vrp', 'order-execution', 'mcp-tool-reference', 'Symbol Formats').",
      "Omit both params to load the full tastytrade skill guide.",
    ].join(" "),
    {
      name: z.enum(["tastytrade", "trading-strategies", "markov-regime"])
        .default("tastytrade")
        .describe("Which skill to load. Defaults to 'tastytrade'."),
      section: z.string().optional().describe(
        "Optional section heading or reference file name to extract. Examples: 'vrp', 'order-execution', 'mcp-tool-reference', 'Symbol Formats', 'strikeSelection Methods'. Omit for the full skill."
      ),
      listReferences: z.boolean().optional().describe(
        "If true, return the list of available reference file names for this skill instead of content."
      ),
    },
    READ_ONLY,
    async ({ name, section, listReferences }) => {
      const dirName = name ?? "tastytrade";

      if (listReferences) {
        const refs = listSkillReferences(dirName);
        return { content: [{ type: "text" as const, text: JSON.stringify(refs) }] };
      }

      const content = getSkillContent(dirName, section);
      if (content === null) {
        return {
          content: [{ type: "text" as const, text: `Skill '${dirName}' not found. Use list_skills to see available skills.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: content }] };
    }
  );

  const REPORT_TYPES = ["morning", "open", "noon", "preclose", "eod", "weekend"] as const;

  server.tool(
    "read_daily_bundle",
    [
      "Read a pre-fetched daily report bundle from disk and return its contents.",
      "Use this at the start of any daily report prompt (morning, open, noon, preclose, eod, weekend).",
      "If the bundle file does not exist, returns an error with the exact shell command to generate it.",
    ].join(" "),
    {
      report: z.enum(REPORT_TYPES).describe(
        "Which report bundle to read. One of: morning, open, noon, preclose, eod, weekend."
      ),
    },
    READ_ONLY,
    async ({ report }) => {
      const filePath = `/tmp/tt_brief_${report}.json`;
      if (!existsSync(filePath)) {
        return {
          content: [{
            type: "text" as const,
            text: `Bundle file not found: ${filePath}\n\nThe file does not exist. Generate it by running:\n\n  python3 scripts/prefetch.py --report ${report}\n\nThen retry this tool call.`,
          }],
          isError: true,
        };
      }
      try {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        return { content: [{ type: "text" as const, text: JSON.stringify(parsed) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: "text" as const,
            text: `Failed to read or parse ${filePath}: ${message}\n\nTry regenerating the bundle:\n\n  python3 scripts/prefetch.py --report ${report}`,
          }],
          isError: true,
        };
      }
    }
  );
}
