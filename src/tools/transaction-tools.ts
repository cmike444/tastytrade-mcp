import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

type DetailTier = "summary" | "standard" | "full";

const TRANSACTION_SUMMARY_FIELDS = ["id", "transaction-type", "transaction-date", "net-value", "symbol"];
const TRANSACTION_STANDARD_FIELDS = [
  "id", "transaction-type", "transaction-sub-type", "transaction-date",
  "executed-at", "symbol", "instrument-type", "quantity", "price",
  "net-value", "regulatory-fees", "clearing-fees", "action", "description"
];

function projectTransaction(item: any, detail: DetailTier): any {
  if (detail === "full") return item;
  const fields = detail === "summary" ? TRANSACTION_SUMMARY_FIELDS : TRANSACTION_STANDARD_FIELDS;
  const result: Record<string, any> = {};
  for (const field of fields) {
    if (item[field] !== undefined) result[field] = item[field];
  }
  return result;
}

function applyTransactionProjection(data: any, limit: number, detail: DetailTier): any {
  if (detail === "full" && limit === 0) return data;

  let items: any[] = [];
  let meta: any = undefined;

  if (Array.isArray(data)) {
    items = data;
  } else if (data?.data?.items) {
    items = data.data.items;
    meta = { pagination: data.data.pagination };
  } else if (data?.items) {
    items = data.items;
    meta = { pagination: data.pagination };
  } else {
    return detail === "full" ? data : projectTransaction(data, detail);
  }

  if (limit > 0) {
    items = items.slice(0, limit);
  }

  const projected = items.map(item => projectTransaction(item, detail));

  if (data?.data?.items !== undefined) {
    return { data: { items: projected, pagination: data.data.pagination }, context: data.context };
  } else if (data?.items !== undefined) {
    return { items: projected, ...meta };
  }
  return projected;
}

export function registerTransactionTools(server: McpServer) {
  server.tool(
    "get_transactions",
    "Get a paginated list of transactions for an account. Use 'limit' to cap the number of records returned (default 50). Use 'detail' to control response size: 'summary' returns 5 key fields, 'standard' returns common fields (default), 'full' returns the complete raw API payload.",
    {
      accountNumber: z.string().describe("The account number"),
      limit: z.number().default(50).describe("Maximum number of transactions to return (default 50, set to 0 for no limit)"),
      detail: z.enum(["summary", "standard", "full"]).default("standard").describe("Response detail level: 'summary' (5 fields: id, type, date, net-value, symbol), 'standard' (common fields, default), 'full' (complete raw payload)"),
      perPage: z.number().optional().describe("Number of transactions per page (API-level pagination)"),
      pageOffset: z.number().optional().describe("Page offset for pagination"),
      sort: z.string().optional().describe("Sort direction ('Asc' or 'Desc')"),
      type: z.string().optional().describe("Filter by transaction type"),
      subType: z.string().optional().describe("Filter by transaction sub-type"),
      startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
      endDate: z.string().optional().describe("End date in YYYY-MM-DD format"),
      symbol: z.string().optional().describe("Filter by symbol"),
    },
    READ_ONLY,
    async ({ accountNumber, limit, detail, perPage, pageOffset, sort, type, subType, startDate, endDate, symbol }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (perPage) queryParams["per-page"] = perPage;
        if (pageOffset) queryParams["page-offset"] = pageOffset;
        if (sort) queryParams.sort = sort;
        if (type) queryParams.type = type;
        if (subType) queryParams["sub-type"] = subType;
        if (startDate) queryParams["start-date"] = startDate;
        if (endDate) queryParams["end-date"] = endDate;
        if (symbol) queryParams.symbol = symbol;
        const transactions = await getClient().transactionsService.getAccountTransactions(accountNumber, queryParams);
        const result = applyTransactionProjection(transactions, limit, detail);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_transaction",
    "Get a specific transaction by ID.",
    {
      accountNumber: z.string().describe("The account number"),
      transactionId: z.string().describe("The transaction ID"),
    },
    READ_ONLY,
    async ({ accountNumber, transactionId }) => {
      try {
        const transaction = await getClient().transactionsService.getTransaction(accountNumber, transactionId);
        return { content: [{ type: "text" as const, text: JSON.stringify(transaction) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_total_fees",
    "Get the total fees for an account for the current day.",
    {
      accountNumber: z.string().describe("The account number"),
    },
    READ_ONLY,
    async ({ accountNumber }) => {
      try {
        const fees = await getClient().transactionsService.getTotalFees(accountNumber);
        return { content: [{ type: "text" as const, text: JSON.stringify(fees) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
