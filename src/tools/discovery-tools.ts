import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAllTools, getToolByName, searchTools, getCategoryStats } from "./tool-registry.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerDiscoveryTools(server: McpServer) {
  server.tool(
    "list_tool_categories",
    "List the top-level tool categories available on this server with a count of tools in each category. Use this as the starting point to discover what this server can do.",
    {},
    READ_ONLY,
    async () => {
      const stats = getCategoryStats();
      const total = stats.reduce((sum, s) => sum + s.count, 0);
      const lines = [
        `This server has ${total} tools organized into ${stats.length} categories:`,
        "",
        ...stats.map((s) => `- **${s.category}** (${s.count} tool${s.count !== 1 ? "s" : ""})`),
        "",
        "Use search_tools(query) to find tools by keyword, or get_tool_details(tool_name) to see the full schema for a specific tool.",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "search_tools",
    "Search for tools by keyword. Returns matching tool names and one-sentence descriptions ranked by relevance. Use this before calling get_tool_details to find the right tool name.",
    {
      query: z.string().describe("Keywords to search for (e.g., 'quote', 'option chain', 'place order', 'balance')"),
    },
    READ_ONLY,
    async ({ query }) => {
      const results = searchTools(query);
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No tools matched the query "${query}". Try list_tool_categories to browse available categories.`,
            },
          ],
        };
      }

      const lines = [
        `Found ${results.length} tool${results.length !== 1 ? "s" : ""} matching "${query}":`,
        "",
        ...results.map((t) => `- **${t.name}** [${t.category}]: ${t.description}`),
        "",
        "Use get_tool_details(tool_name) to see the full input schema for a specific tool.",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "get_tool_details",
    "Get the full schema (description, input parameters, and annotations) for a specific tool by name. Use search_tools first if you don't know the exact tool name.",
    {
      tool_name: z.string().describe("The exact name of the tool to retrieve details for (e.g., 'get_quote', 'create_order')"),
    },
    READ_ONLY,
    async ({ tool_name }) => {
      const tool = getToolByName(tool_name);
      if (!tool) {
        const all = getAllTools();
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Tool "${tool_name}" not found.`,
                "",
                "Available tool names:",
                ...all.map((t) => `- ${t.name}`),
              ].join("\n"),
            },
          ],
          isError: true,
        };
      }

      const lines = [
        `## ${tool.name}`,
        "",
        `**Category**: ${tool.category}`,
        `**Description**: ${tool.description}`,
        "",
        "**Input Schema**:",
        "```json",
        JSON.stringify(tool.inputSchema, null, 2),
        "```",
      ];

      if (tool.annotations && Object.keys(tool.annotations).length > 0) {
        lines.push("", "**Annotations**:", "```json", JSON.stringify(tool.annotations, null, 2), "```");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
