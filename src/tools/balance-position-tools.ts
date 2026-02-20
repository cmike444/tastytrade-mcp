import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";

export function registerBalancePositionTools(server: McpServer) {
  server.tool(
    "get_account_balances",
    "Get current balance values for an account including cash, equity, and buying power.",
    {
      accountNumber: z.string().describe("The account number to get balances for"),
    },
    async ({ accountNumber }) => {
      try {
        const balances = await getClient().balancesAndPositionsService.getAccountBalanceValues(accountNumber);
        return { content: [{ type: "text" as const, text: JSON.stringify(balances, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_positions",
    "Get all current positions for an account. Can be filtered by symbol or underlying symbol.",
    {
      accountNumber: z.string().describe("The account number to get positions for"),
      symbol: z.string().optional().describe("Filter positions by specific symbol"),
      underlyingSymbol: z.string().optional().describe("Filter positions by underlying symbol"),
    },
    async ({ accountNumber, symbol, underlyingSymbol }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (symbol) queryParams.symbol = symbol;
        if (underlyingSymbol) queryParams["underlying-symbol"] = underlyingSymbol;
        const positions = await getClient().balancesAndPositionsService.getPositionsList(accountNumber, queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(positions, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_balance_snapshots",
    "Get balance snapshots for an account showing historical balance data.",
    {
      accountNumber: z.string().describe("The account number to get snapshots for"),
      timeOfDay: z.string().optional().describe("Time of day for snapshot (e.g., 'BOD' for beginning of day, 'EOD' for end of day)"),
    },
    async ({ accountNumber, timeOfDay }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (timeOfDay) queryParams["time-of-day"] = timeOfDay;
        const snapshots = await getClient().balancesAndPositionsService.getBalanceSnapshots(accountNumber, queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(snapshots, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
