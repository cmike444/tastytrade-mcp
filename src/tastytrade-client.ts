import TastytradeClient from "@tastytrade/api";
import WebSocket from "ws";

(global as any).WebSocket = WebSocket;
(global as any).window = { WebSocket, setTimeout, clearTimeout };

let client: TastytradeClient | null = null;
let isAuthenticated = false;

export interface TastyTradeConfig {
  clientSecret: string;
  refreshToken: string;
  oauthScopes: string[];
  sandbox?: boolean;
}

export function getClient(): TastytradeClient {
  if (!client) {
    throw new Error("TastyTrade client is not initialized. Call authenticateOAuth first.");
  }
  return client;
}

export function isClientAuthenticated(): boolean {
  return isAuthenticated && client !== null;
}

export async function authenticateOAuth(config: TastyTradeConfig): Promise<string> {
  const baseConfig = config.sandbox
    ? TastytradeClient.SandboxConfig
    : TastytradeClient.ProdConfig;

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
