import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { authenticateOAuth, isClientAuthenticated, disconnectClient } from "../tastytrade-client.js";

export function registerAuthTools(server: McpServer) {
  server.tool(
    "authenticate_oauth",
    "Authenticate with TastyTrade using OAuth 2.0 credentials (client secret and refresh token). Required before using any other tools.",
    {
      clientSecret: z.string().describe("OAuth client secret from TastyTrade developer portal"),
      refreshToken: z.string().describe("OAuth refresh token obtained from TastyTrade authorization flow"),
      oauthScopes: z.array(z.string()).default(["read", "trade"]).describe("OAuth scopes to request (e.g., ['read', 'trade'])"),
      sandbox: z.boolean().default(false).describe("Use sandbox/certification environment instead of production"),
    },
    async ({ clientSecret, refreshToken, oauthScopes, sandbox }) => {
      try {
        const result = await authenticateOAuth({ clientSecret, refreshToken, oauthScopes, sandbox });
        return { content: [{ type: "text" as const, text: result }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Authentication failed: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "check_auth_status",
    "Check if the TastyTrade client is currently authenticated.",
    {},
    async () => {
      const status = isClientAuthenticated() ? "Authenticated" : "Not authenticated";
      return { content: [{ type: "text" as const, text: `Status: ${status}` }] };
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
