import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerRiskMarginTools(server: McpServer) {
  server.tool(
    "get_margin_requirements",
    "Get margin/capital requirements report for an account.",
    {
      accountNumber: z.string().describe("The account number"),
    },
    READ_ONLY,
    async ({ accountNumber }) => {
      try {
        const margin = await getClient().marginRequirementsService.getMarginRequirements(accountNumber);
        return { content: [{ type: "text" as const, text: JSON.stringify(margin, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "estimate_margin_requirements",
    "Estimate margin requirements for an order (dry run) given an account.",
    {
      accountNumber: z.string().describe("The account number"),
      orderJson: z.string().describe("JSON string of the order to estimate margin for"),
    },
    READ_ONLY,
    async ({ accountNumber, orderJson }) => {
      try {
        const order = JSON.parse(orderJson);
        const margin = await getClient().marginRequirementsService.postMarginRequirements(accountNumber, order);
        return { content: [{ type: "text" as const, text: JSON.stringify(margin, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_effective_margin_requirements",
    "Get effective margin requirements for a specific underlying symbol in an account.",
    {
      accountNumber: z.string().describe("The account number"),
      underlyingSymbol: z.string().describe("The underlying symbol to get margin requirements for"),
    },
    READ_ONLY,
    async ({ accountNumber, underlyingSymbol }) => {
      try {
        const margin = await getClient().riskParametersService.getEffectiveMarginRequirements(accountNumber, underlyingSymbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(margin, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_position_limit",
    "Get the position limit for an account.",
    {
      accountNumber: z.string().describe("The account number"),
    },
    READ_ONLY,
    async ({ accountNumber }) => {
      try {
        const limit = await getClient().riskParametersService.getPositionLimit(accountNumber);
        return { content: [{ type: "text" as const, text: JSON.stringify(limit, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_net_liq_history",
    "Get net liquidating value history for an account over time.",
    {
      accountNumber: z.string().describe("The account number"),
      timeBack: z.string().optional().describe("Time period to look back (e.g., '1d', '1m', '3m', '1y', 'all')"),
    },
    READ_ONLY,
    async ({ accountNumber, timeBack }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (timeBack) queryParams["time-back"] = timeBack;
        const history = await getClient().netLiquidatingValueHistoryService.getNetLiquidatingValueHistory(accountNumber, queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(history, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_net_liq_value",
    "Get the current net liquidating value for an account.",
    {
      accountNumber: z.string().describe("The account number"),
    },
    READ_ONLY,
    async ({ accountNumber }) => {
      try {
        const value = await getClient().netLiquidatingValueHistoryService.getNetLiquidatingValue(accountNumber);
        return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
