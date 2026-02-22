import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isClientAuthenticated, disconnectClient, autoAuthenticate } from "../tastytrade-client.js";

export function registerAuthTools(server: McpServer) {
  server.tool(
    "check_auth_status",
    "Check if the TastyTrade client is currently authenticated and reconnect if needed.",
    {},
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
    async () => {
      await disconnectClient();
      return { content: [{ type: "text" as const, text: "Disconnected successfully." }] };
    }
  );
}
