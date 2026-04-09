import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../tastytrade-client.js";

export function registerAccountResources(server: McpServer) {
  const balancesTemplate = new ResourceTemplate("mcp://accounts/{account_id}/balances", {
    list: undefined,
  });

  server.resource(
    "account-balances",
    balancesTemplate,
    {
      description: "Current balance values for an account including cash, equity, and buying power.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const accountId = variables["account_id"] as string;
      try {
        const balances = await getClient().balancesAndPositionsService.getAccountBalanceValues(accountId);
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify(balances),
            },
          ],
        };
      } catch (error: any) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: error.message }),
            },
          ],
        };
      }
    }
  );

  const positionsTemplate = new ResourceTemplate("mcp://accounts/{account_id}/positions", {
    list: undefined,
  });

  server.resource(
    "account-positions",
    positionsTemplate,
    {
      description: "All current positions for an account.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const accountId = variables["account_id"] as string;
      try {
        const positions = await getClient().balancesAndPositionsService.getPositionsList(accountId, {});
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify(positions),
            },
          ],
        };
      } catch (error: any) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: error.message }),
            },
          ],
        };
      }
    }
  );
}
