import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";
import { formatApiError } from "./error-utils.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerAccountTools(server: McpServer) {
  server.tool(
    "get_account_info",
    [
      "Retrieve account and customer information. Detail levels:",
      "  customer_accounts — List all accounts for the authenticated user (no accountNumber needed).",
      "  customer_resource — Full customer profile for the authenticated user (no accountNumber needed).",
      "  full_account — Full details for a specific account (requires accountNumber).",
      "  account_status — Trading status and permissions for a specific account (requires accountNumber).",
    ].join("\n"),
    {
      detail: z.enum(["customer_accounts", "customer_resource", "full_account", "account_status"]).describe(
        "Level of account detail: 'customer_accounts' (list all accounts), 'customer_resource' (customer profile), 'full_account' (full account details), 'account_status' (trading status and permissions)."
      ),
      accountNumber: z.string().optional().describe("Account number — required for 'full_account' and 'account_status' detail levels."),
    },
    READ_ONLY,
    async ({ detail, accountNumber }) => {
      try {
        const svc = getClient().accountsAndCustomersService;
        let result: any;

        if (detail === "customer_accounts") {
          result = await svc.getCustomerAccounts();
        } else if (detail === "customer_resource") {
          result = await svc.getCustomerResource();
        } else if (detail === "full_account") {
          if (!accountNumber) throw new Error("accountNumber is required for detail 'full_account'");
          result = await svc.getFullCustomerAccountResource(accountNumber);
        } else if (detail === "account_status") {
          if (!accountNumber) throw new Error("accountNumber is required for detail 'account_status'");
          result = await getClient().accountStatusService.getAccountStatus(accountNumber);
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );
}
