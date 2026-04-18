import TastytradeClient from "@tastytrade/api";
import WebSocket from "ws";
import { createRequire } from "module";

(global as any).WebSocket = WebSocket;
(global as any).window = { WebSocket, setTimeout, clearTimeout };

const KEEPALIVE_BUFFER_SECONDS = 60;
const KEEPALIVE_FALLBACK_INTERVAL_MS = 55 * 60 * 1000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;

const _require = createRequire(import.meta.url);

let client: TastytradeClient | null = null;
let isAuthenticated = false;

let quoteStreamerConnected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let currentConnectVersion = 0;
let explicitlyDisconnecting = false;
const listenedFeeds = new WeakSet<object>();
let lastKeepaliveAt: number | null = null;
let keepaliveActive = false;

function cancelPendingReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleQuoteStreamerReconnect(): void {
  if (explicitlyDisconnecting || !quoteStreamerConnected || !client) return;

  cancelPendingReconnect();

  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts),
    RECONNECT_MAX_MS
  );
  reconnectAttempts++;

  console.warn(
    `[DXLink] Scheduling reconnect attempt ${reconnectAttempts} in ${Math.round(delay / 1000)}s.`
  );

  const capturedClient = client;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!client || client !== capturedClient || explicitlyDisconnecting) return;

    try {
      console.warn("[DXLink] Reconnecting quoteStreamer...");
      await client.quoteStreamer.connect();
      reconnectAttempts = 0;
      console.warn("[DXLink] quoteStreamer reconnected successfully.");
    } catch (err: any) {
      console.warn(`[DXLink] Reconnect failed: ${err?.message ?? err}. Scheduling retry.`);
      scheduleQuoteStreamerReconnect();
    }
  }, delay);
}

function attachFeedListeners(feed: any, myVersion: number): void {
  if (listenedFeeds.has(feed)) return;
  listenedFeeds.add(feed);

  const channel = feed.getChannel?.();
  if (channel && typeof channel.addErrorListener === "function") {
    channel.addErrorListener((err: any) => {
      if (err?.message === "Bye" || err?.message === "Reconnect") {
        console.warn(`[DXLink] Server disconnect signal: ${err.message}. Scheduling reconnect.`);
        if (myVersion === currentConnectVersion) {
          scheduleQuoteStreamerReconnect();
        }
      } else if (err?.message) {
        console.warn(`[DXLink] Channel error: ${err.type ?? "UNKNOWN"} — ${err.message}`);
      }
    });
  }

  if (typeof feed.addStateChangeListener === "function") {
    feed.addStateChangeListener((state: string) => {
      if (
        state === "CLOSED" &&
        myVersion === currentConnectVersion &&
        !explicitlyDisconnecting &&
        quoteStreamerConnected
      ) {
        console.warn("[DXLink] Channel closed unexpectedly. Scheduling reconnect.");
        scheduleQuoteStreamerReconnect();
      }
    });
  }
}

function attachQuoteStreamerHandlers(c: TastytradeClient): void {
  const qs = c.quoteStreamer as any;
  let activeDxLinkWsClient: any = null;

  qs.connect = async function patchedConnect() {
    cancelPendingReconnect();
    const myVersion = ++currentConnectVersion;

    if (activeDxLinkWsClient !== null) {
      try {
        console.warn("[QuoteStreamer] Disconnecting previous WebSocket client before reconnect");
        activeDxLinkWsClient.disconnect();
      } catch (err: any) {
        console.warn(`[QuoteStreamer] Error disconnecting old client: ${err?.message ?? err}`);
      }
      activeDxLinkWsClient = null;
    }

    const { DXLinkWebSocketClient } = _require("@dxfeed/dxlink-websocket-client");
    const { DXLinkFeed, FeedContract, FeedDataFormat } = _require("@dxfeed/dxlink-feed");

    const tokenResponse = await qs.accountsAndCustomersService.getApiQuoteToken();
    qs.dxLinkUrl = tokenResponse["dxlink-url"];
    qs.dxLinkAuthToken = tokenResponse["token"];

    const wsClient = new DXLinkWebSocketClient();
    activeDxLinkWsClient = wsClient;

    wsClient.connect(qs.dxLinkUrl);
    wsClient.setAuthToken(qs.dxLinkAuthToken);

    qs.dxLinkFeed = new DXLinkFeed(wsClient, FeedContract.AUTO);
    qs.dxLinkFeed.configure({
      acceptAggregationPeriod: 10,
      acceptDataFormat: FeedDataFormat.COMPACT,
    });

    qs.eventListeners.forEach((listener: any) =>
      qs.dxLinkFeed.addEventListener(listener)
    );

    quoteStreamerConnected = true;
    reconnectAttempts = 0;

    attachFeedListeners(qs.dxLinkFeed, myVersion);
  };
}

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

    attachQuoteStreamerHandlers(client);

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
    explicitlyDisconnecting = true;
    cancelPendingReconnect();
    quoteStreamerConnected = false;
    try {
      await client.quoteStreamer.disconnect();
    } catch {}
    try {
      client.accountStreamer.stop();
    } catch {}
    client = null;
    isAuthenticated = false;
    explicitlyDisconnecting = false;
  }
}

export function getConnectionStatus() {
  const expiresIn = client?.accessToken?.expiresIn;
  const tokenExpiresAt =
    typeof expiresIn === "number"
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;
  return {
    isAuthenticated,
    keepaliveActive,
    quoteStreamerConnected,
    tokenExpiresAt,
    lastKeepaliveAt: lastKeepaliveAt ? new Date(lastKeepaliveAt).toISOString() : null,
  };
}

export function startKeepalive(): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function deriveInterval(): number {
    const expiresIn = client?.accessToken?.expiresIn;
    if (typeof expiresIn === "number") {
      return Math.max(5000, (expiresIn - KEEPALIVE_BUFFER_SECONDS) * 1000);
    }
    return KEEPALIVE_FALLBACK_INTERVAL_MS;
  }

  async function keepalive(): Promise<void> {
    if (cancelled) return;

    console.error("[TastyTrade] Keepalive: pinging TastyTrade...");

    let pingOk = false;
    if (isAuthenticated && client) {
      try {
        await client.accountsAndCustomersService.getCustomerAccounts();
        pingOk = true;
        lastKeepaliveAt = Date.now();
        console.error("[TastyTrade] Keepalive: ping succeeded.");
      } catch (err: any) {
        console.error(`[TastyTrade] Keepalive: ping failed — ${err?.message ?? err}`);
      }
    }

    let reauthed = false;
    if (!pingOk || !isAuthenticated) {
      console.error("[TastyTrade] Keepalive: re-authenticating...");
      try {
        const result = await autoAuthenticate();
        reauthed = true;
        console.error(`[TastyTrade] Keepalive: re-authentication succeeded — ${result}`);
      } catch (err: any) {
        console.error(`[TastyTrade] Keepalive: re-authentication failed — ${err?.message ?? err}`);
      }
    }

    if (reauthed && quoteStreamerConnected && client) {
      try {
        console.warn("[TastyTrade] Keepalive: reconnecting quoteStreamer after re-auth...");
        await client.quoteStreamer.connect();
        console.warn("[TastyTrade] Keepalive: quoteStreamer reconnected.");
      } catch (err: any) {
        console.warn(
          `[TastyTrade] Keepalive: quoteStreamer reconnect failed — ${err?.message ?? err}`
        );
      }
    }

    if (!cancelled) {
      const interval = deriveInterval();
      console.error(`[TastyTrade] Keepalive: next check in ${Math.round(interval / 1000)}s.`);
      timer = setTimeout(keepalive, interval);
    }
  }

  keepaliveActive = true;
  const interval = deriveInterval();
  console.error(`[TastyTrade] Keepalive: scheduled, first check in ${Math.round(interval / 1000)}s.`);
  timer = setTimeout(keepalive, interval);

  return function cancel() {
    cancelled = true;
    keepaliveActive = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    console.error("[TastyTrade] Keepalive: cancelled.");
  };
}
