import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isClientAuthenticated, disconnectClient, autoAuthenticate } from "../tastytrade-client.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerAuthTools(server: McpServer) {
  server.tool(
    "check_auth_status",
    "Check if the TastyTrade client is currently authenticated and reconnect if needed.",
    {},
    READ_ONLY,
    async () => {
      if (isClientAuthenticated()) {
        return { content: [{ type: "text" as const, text: "Status: Authenticated and connected to TastyTrade." }] };
      }
      try {
        const result = await autoAuthenticate();
        return { content: [{ type: "text" as const, text: `Status: Reconnected. ${result}` }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Status: Not authenticated. ${error.message}` }], isError: true };
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
