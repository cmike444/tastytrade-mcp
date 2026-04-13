import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";
import { formatApiError } from "./error-utils.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

type DetailTier = "summary" | "standard" | "full";

const POSITION_SUMMARY_FIELDS = ["symbol", "quantity", "market-value", "instrument-type", "average-open-price"];
const POSITION_STANDARD_FIELDS = [
  "symbol", "instrument-type", "underlying-symbol", "quantity", "quantity-direction",
  "close-price", "average-open-price", "average-yearly-market-close-price",
  "average-daily-market-close-price", "market-value", "market-value-updated-at",
  "multiplier", "cost-effect", "is-suppressed", "is-frozen", "restricted-quantity",
  "expires-at"
];

function projectPosition(item: any, detail: DetailTier): any {
  if (detail === "full") return item;
  const fields = detail === "summary" ? POSITION_SUMMARY_FIELDS : POSITION_STANDARD_FIELDS;
  const result: Record<string, any> = {};
  for (const field of fields) {
    if (item[field] !== undefined) result[field] = item[field];
  }
  return result;
}

function applyPositionProjection(data: any, detail: DetailTier): any {
  if (detail === "full") return data;

  let items: any[] = [];

  if (Array.isArray(data)) {
    return data.map(item => projectPosition(item, detail));
  } else if (data?.data?.items) {
    items = data.data.items.map((item: any) => projectPosition(item, detail));
    return { data: { items, pagination: data.data.pagination }, context: data.context };
  } else if (data?.items) {
    items = data.items.map((item: any) => projectPosition(item, detail));
    return { items, pagination: data.pagination };
  } else {
    return projectPosition(data, detail);
  }
}

export function registerBalancePositionTools(server: McpServer) {
  server.tool(
    "get_positions",
    "Get current positions for an account with optional filtering. For unfiltered balances use the mcp://accounts/{account_id}/balances resource; for unfiltered positions use mcp://accounts/{account_id}/positions resource. This tool adds filtering by symbol or underlying symbol and detail-level projection. Use 'detail' to control response size: 'summary' returns 5 key fields per position (symbol, quantity, market-value, instrument-type, average-open-price), 'standard' returns common fields (default), 'full' returns the complete raw API payload.",
    {
      accountNumber: z.string().describe("The account number to get positions for"),
      symbol: z.string().optional().describe("Filter positions by specific symbol"),
      underlyingSymbol: z.string().optional().describe("Filter positions by underlying symbol"),
      detail: z.enum(["summary", "standard", "full"]).default("standard").describe("Response detail level: 'summary' (5 key fields), 'standard' (common fields, default), 'full' (complete raw payload)"),
    },
    READ_ONLY,
    async ({ accountNumber, symbol, underlyingSymbol, detail }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (symbol) queryParams.symbol = symbol;
        if (underlyingSymbol) queryParams["underlying-symbol"] = underlyingSymbol;
        const positions = await getClient().balancesAndPositionsService.getPositionsList(accountNumber, queryParams);
        const result = applyPositionProjection(positions, detail);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
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
    READ_ONLY,
    async ({ accountNumber, timeOfDay }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (timeOfDay) queryParams["time-of-day"] = timeOfDay;
        const snapshots = await getClient().balancesAndPositionsService.getBalanceSnapshots(accountNumber, queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(snapshots) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );
}
