import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";

export function registerAccountTools(server: McpServer) {
  server.tool(
    "get_customer_accounts",
    "Get a list of all customer accounts associated with the authenticated user.",
    {},
    async () => {
      try {
        const accounts = await getClient().accountsAndCustomersService.getCustomerAccounts();
        return { content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_customer_resource",
    "Get the full customer resource (profile information) for the authenticated user.",
    {},
    async () => {
      try {
        const customer = await getClient().accountsAndCustomersService.getCustomerResource();
        return { content: [{ type: "text" as const, text: JSON.stringify(customer, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_full_account_resource",
    "Get full details for a specific customer account.",
    {
      accountNumber: z.string().describe("The account number to retrieve details for"),
    },
    async ({ accountNumber }) => {
      try {
        const account = await getClient().accountsAndCustomersService.getFullCustomerAccountResource(accountNumber);
        return { content: [{ type: "text" as const, text: JSON.stringify(account, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_account_status",
    "Get the trading status and permissions for a specific account.",
    {
      accountNumber: z.string().describe("The account number to check status for"),
    },
    async ({ accountNumber }) => {
      try {
        const status = await getClient().accountStatusService.getAccountStatus(accountNumber);
        return { content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
