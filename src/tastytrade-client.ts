import TastytradeClient from "@tastytrade/api";
import WebSocket from "ws";
import { createRequire } from "module";
import { logger } from "./logger.js";

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

export interface CandleSubscriptionEntry {
  symbol: string;
  fromTime: number;
  periodMinutes: number;
  candleType: string;
}

const activeQuoteRefCounts: Map<string, number> = new Map();
const activeCandleRefCounts: Map<string, { count: number; entry: CandleSubscriptionEntry }> = new Map();

function candleKey(entry: CandleSubscriptionEntry): string {
  return `${entry.symbol}|${entry.fromTime}|${entry.periodMinutes}|${String(entry.candleType)}`;
}

export function registerQuoteSubscriptions(symbols: string[]): void {
  for (const s of symbols) {
    activeQuoteRefCounts.set(s, (activeQuoteRefCounts.get(s) ?? 0) + 1);
  }
}

export function unregisterQuoteSubscriptions(symbols: string[]): void {
  for (const s of symbols) {
    const count = activeQuoteRefCounts.get(s);
    if (count !== undefined) {
      if (count <= 1) {
        activeQuoteRefCounts.delete(s);
      } else {
        activeQuoteRefCounts.set(s, count - 1);
      }
    }
  }
}

export function registerCandleSubscription(entry: CandleSubscriptionEntry): void {
  const key = candleKey(entry);
  const existing = activeCandleRefCounts.get(key);
  if (existing) {
    activeCandleRefCounts.set(key, { count: existing.count + 1, entry });
  } else {
    activeCandleRefCounts.set(key, { count: 1, entry });
  }
}

export function unregisterCandleSubscription(entry: CandleSubscriptionEntry): void {
  const key = candleKey(entry);
  const existing = activeCandleRefCounts.get(key);
  if (existing) {
    if (existing.count <= 1) {
      activeCandleRefCounts.delete(key);
    } else {
      activeCandleRefCounts.set(key, { count: existing.count - 1, entry: existing.entry });
    }
  }
}

function replaySubscriptions(qs: any): void {
  if (activeQuoteRefCounts.size > 0) {
    const symbols = [...activeQuoteRefCounts.keys()];
    console.warn(`[DXLink] Replaying ${symbols.length} quote subscription(s) after reconnect: ${symbols.join(", ")}`);
    try {
      qs.subscribe(symbols);
    } catch (err: any) {
      console.warn(`[DXLink] Failed to replay quote subscriptions: ${err?.message ?? err}`);
    }
  }

  for (const { entry: sub } of activeCandleRefCounts.values()) {
    console.warn(`[DXLink] Replaying candle subscription for ${sub.symbol} after reconnect.`);
    try {
      qs.subscribeCandles(sub.symbol, sub.fromTime, sub.periodMinutes, sub.candleType);
    } catch (err: any) {
      console.warn(`[DXLink] Failed to replay candle subscription for ${sub.symbol}: ${err?.message ?? err}`);
    }
  }
}

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

  logger.warn(
    `[DXLink] Scheduling reconnect attempt ${reconnectAttempts} in ${Math.round(delay / 1000)}s.`
  );

  const capturedClient = client;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!client || client !== capturedClient || explicitlyDisconnecting) return;

    try {
      logger.warn("[DXLink] Reconnecting quoteStreamer...");
      await client.quoteStreamer.connect();
      reconnectAttempts = 0;
      logger.warn("[DXLink] quoteStreamer reconnected successfully.");
    } catch (err: any) {
      logger.warn(`[DXLink] Reconnect failed: ${err?.message ?? err}. Scheduling retry.`);
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
        logger.warn(`[DXLink] Server disconnect signal: ${err.message}. Scheduling reconnect.`);
        if (myVersion === currentConnectVersion) {
          scheduleQuoteStreamerReconnect();
        }
      } else if (err?.message) {
        logger.warn(`[DXLink] Channel error: ${err.type ?? "UNKNOWN"} — ${err.message}`);
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
        logger.warn("[DXLink] Channel closed unexpectedly. Scheduling reconnect.");
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
        logger.warn("[QuoteStreamer] Disconnecting previous WebSocket client before reconnect");
        activeDxLinkWsClient.disconnect();
      } catch (err: any) {
        logger.warn(`[QuoteStreamer] Error disconnecting old client: ${err?.message ?? err}`);
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

    replaySubscriptions(qs);
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

  logger.info("[TastyTrade] Attempting OAuth authentication...");

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
      logger.error(`[TastyTrade] API Error Status: ${error.response.status}`);
      logger.error(`[TastyTrade] API Error Data:`, JSON.stringify(error.response.data));
      logger.error(`[TastyTrade] API Error URL: ${error.response.config?.url}`);
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
    activeQuoteRefCounts.clear();
    activeCandleRefCounts.clear();
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

    logger.info("[TastyTrade] Keepalive: pinging TastyTrade...");

    let pingOk = false;
    if (isAuthenticated && client) {
      try {
        await client.accountsAndCustomersService.getCustomerAccounts();
        pingOk = true;
        lastKeepaliveAt = Date.now();
        logger.info("[TastyTrade] Keepalive: ping succeeded.");
      } catch (err: any) {
        logger.warn(`[TastyTrade] Keepalive: ping failed — ${err?.message ?? err}`);
      }
    }

    let reauthed = false;
    if (!pingOk || !isAuthenticated) {
      logger.info("[TastyTrade] Keepalive: re-authenticating...");
      try {
        const result = await autoAuthenticate();
        reauthed = true;
        logger.info(`[TastyTrade] Keepalive: re-authentication succeeded — ${result}`);
      } catch (err: any) {
        logger.error(`[TastyTrade] Keepalive: re-authentication failed — ${err?.message ?? err}`);
      }
    }

    if (reauthed && quoteStreamerConnected && client) {
      try {
        logger.warn("[TastyTrade] Keepalive: reconnecting quoteStreamer after re-auth...");
        await client.quoteStreamer.connect();
        logger.warn("[TastyTrade] Keepalive: quoteStreamer reconnected.");
      } catch (err: any) {
        logger.warn(
          `[TastyTrade] Keepalive: quoteStreamer reconnect failed — ${err?.message ?? err}`
        );
      }
    }

    if (!cancelled) {
      const interval = deriveInterval();
      logger.info(`[TastyTrade] Keepalive: next check in ${Math.round(interval / 1000)}s.`);
      timer = setTimeout(keepalive, interval);
    }
  }

  keepaliveActive = true;
  const interval = deriveInterval();
  logger.info(`[TastyTrade] Keepalive: scheduled, first check in ${Math.round(interval / 1000)}s.`);
  timer = setTimeout(keepalive, interval);

  return function cancel() {
    cancelled = true;
    keepaliveActive = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    logger.info("[TastyTrade] Keepalive: cancelled.");
  };
}
