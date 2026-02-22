import TastytradeClient from "@tastytrade/api";
import WebSocket from "ws";

(global as any).WebSocket = WebSocket;
(global as any).window = { WebSocket, setTimeout, clearTimeout };

let client: TastytradeClient | null = null;
let isAuthenticated = false;

export interface TastyTradeOAuthConfig {
  clientSecret: string;
  refreshToken: string;
  oauthScopes: string[];
  sandbox?: boolean;
}

export function getClient(): TastytradeClient {
  if (!client) {
    throw new Error("TastyTrade client is not initialized. Authentication has not completed.");
  }
  return client;
}

export function isClientAuthenticated(): boolean {
  return isAuthenticated && client !== null;
}

export async function authenticateOAuth(config: TastyTradeOAuthConfig): Promise<string> {
  const baseConfig = config.sandbox
    ? TastytradeClient.SandboxConfig
    : TastytradeClient.ProdConfig;

  console.error("[TastyTrade] Attempting OAuth authentication...");

  try {
    client = new TastytradeClient({
      ...baseConfig,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
      oauthScopes: config.oauthScopes,
    } as any);

    const accounts = await client.accountsAndCustomersService.getCustomerAccounts();
    isAuthenticated = true;

    const accountCount = Array.isArray(accounts) ? accounts.length : 0;
    return `Successfully authenticated via OAuth. Found ${accountCount} account(s).`;
  } catch (error: any) {
    if (error.response) {
      console.error(`[TastyTrade] API Error Status: ${error.response.status}`);
      console.error(`[TastyTrade] API Error Data:`, JSON.stringify(error.response.data));
      console.error(`[TastyTrade] API Error URL: ${error.response.config?.url}`);
    }
    throw error;
  }
}

export async function autoAuthenticate(): Promise<string> {
  const clientSecret = process.env.TASTYTRADE_CLIENT_SECRET;
  const refreshToken = process.env.TASTYTRADE_REFRESH_TOKEN;
  const sandbox = process.env.TASTYTRADE_SANDBOX === "true";

  if (clientSecret && refreshToken) {
    return authenticateOAuth({
      clientSecret,
      refreshToken,
      oauthScopes: ["read", "trade"],
      sandbox,
    });
  }

  throw new Error(
    "No TastyTrade credentials found. Set TASTYTRADE_CLIENT_SECRET and TASTYTRADE_REFRESH_TOKEN as secrets."
  );
}

export async function disconnectClient(): Promise<void> {
  if (client) {
    try {
      await client.quoteStreamer.disconnect();
    } catch {}
    try {
      client.accountStreamer.stop();
    } catch {}
    client = null;
    isAuthenticated = false;
  }
}
