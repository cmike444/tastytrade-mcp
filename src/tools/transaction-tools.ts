import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerTransactionTools(server: McpServer) {
  server.tool(
    "get_transactions",
    "Get a paginated list of transactions for an account.",
    {
      accountNumber: z.string().describe("The account number"),
      perPage: z.number().optional().describe("Number of transactions per page"),
      pageOffset: z.number().optional().describe("Page offset for pagination"),
      sort: z.string().optional().describe("Sort direction ('Asc' or 'Desc')"),
      type: z.string().optional().describe("Filter by transaction type"),
      subType: z.string().optional().describe("Filter by transaction sub-type"),
      startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
      endDate: z.string().optional().describe("End date in YYYY-MM-DD format"),
      symbol: z.string().optional().describe("Filter by symbol"),
    },
    READ_ONLY,
    async ({ accountNumber, perPage, pageOffset, sort, type, subType, startDate, endDate, symbol }) => {
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
        return { content: [{ type: "text" as const, text: JSON.stringify(transactions, null, 2) }] };
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
        return { content: [{ type: "text" as const, text: JSON.stringify(transaction, null, 2) }] };
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
        return { content: [{ type: "text" as const, text: JSON.stringify(fees, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
