import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isClientAuthenticated, disconnectClient, autoAuthenticate } from "../tastytrade-client.js";
import { formatApiError } from "./error-utils.js";
import { getTokenAgeDays } from "../token-store.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerAuthTools(server: McpServer) {
  server.tool(
    "check_auth_status",
    "Check if the TastyTrade client is currently authenticated and reconnect if needed.",
    {},
    READ_ONLY,
    async () => {
      const persistedTokenAgeDays = getTokenAgeDays();
      if (isClientAuthenticated()) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "Authenticated and connected to TastyTrade.",
              persistedTokenAgeDays,
            }),
          }],
        };
      }
      try {
        const result = await autoAuthenticate();
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: `Reconnected. ${result}`,
              persistedTokenAgeDays: getTokenAgeDays(),
            }),
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: `Not authenticated. ${formatApiError(error)}`,
              persistedTokenAgeDays,
            }),
          }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "disconnect",
    "Disconnect from TastyTrade and clean up all connections.",
    {},
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async () => {
      await disconnectClient();
      return { content: [{ type: "text" as const, text: "Disconnected successfully." }] };
    }
  );
}
