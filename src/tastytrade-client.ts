import TastytradeClient from "@tastytrade/api";
import WebSocket from "ws";
import { createRequire } from "module";
import { logger } from "./logger.js";
import { execute as cbExecute, getCircuitBreakerStatus } from "./circuit-breaker.js";

(global as any).WebSocket = WebSocket;
(global as any).window = { WebSocket, setTimeout, clearTimeout };

const KEEPALIVE_BUFFER_SECONDS = 60;
const KEEPALIVE_FALLBACK_INTERVAL_MS = 55 * 60 * 1000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;

const _require = createRequire(import.meta.url);

let client: TastytradeClient | null = null;
let isAuthenticated = false;

// Session token obtained via POST /sessions (username + password).
// Required by TastyTrade internal services (e.g. backtesting API) that do not
// accept OAuth JWTs. Separate from the OAuth access token stored in the SDK client.
let sessionToken: string | null = null;

let quoteStreamerConnected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let currentConnectVersion = 0;
let explicitlyDisconnecting = false;
const listenedFeeds = new WeakSet<object>();
let lastKeepaliveAt: number | null = null;
let keepaliveActive = false;

// Module-scope reference to the active DXLinkWebSocketClient so disconnectClient()
// can explicitly close the underlying socket (no orphaned connections on teardown).
let activeDxLinkWsClient: any = null;

// Reconnect notification: tool handlers register here to clear stale event
// buffers when a reconnect occurs mid-collection.
const reconnectSubscribers: Set<() => void> = new Set();

/**
 * Register a callback that fires immediately after every successful reconnect.
 * Returns an unsubscribe function.
 */
export function onReconnect(cb: () => void): () => void {
  reconnectSubscribers.add(cb);
  return () => reconnectSubscribers.delete(cb);
}

function notifyReconnect(): void {
  for (const cb of reconnectSubscribers) {
    try { cb(); } catch {}
  }
}

export interface CandleSubscriptionEntry {
  symbol: string;
  fromTime: number;
  periodMinutes: number;
  candleType: string;
}

const activeQuoteRefCounts: Map<string, number> = new Map();
const activeCandleRefCounts: Map<string, { count: number; entry: CandleSubscriptionEntry }> = new Map();

// In-flight quote coalescing: keyed by streamer symbol.
// When multiple concurrent callers request the same symbol, only one WebSocket
// subscription is opened; additional callers attach to the existing promise.
const inflightQuoteRequests: Map<string, Promise<any[]>> = new Map();

/**
 * Returns a promise that resolves with all events for `symbol` collected over
 * `timeoutMs` milliseconds.  If an identical in-flight subscription already
 * exists for the symbol, the caller attaches to it and no duplicate subscribe
 * message is sent to DXLink.
 *
 * Returns `{ promise, isNew }`.  The caller is responsible for calling
 * `quoteStreamer.subscribe([symbol])` and managing ref-count registration ONLY
 * when `isNew === true`.
 */
export function getOrCreateInflightQuote(
  symbol: string,
  timeoutMs: number,
  qs: any
): { promise: Promise<any[]>; isNew: boolean } {
  const existing = inflightQuoteRequests.get(symbol);
  if (existing) {
    logger.info(`[DXLink] Coalescing quote request for ${symbol} to existing in-flight subscription.`);
    return { promise: existing, isNew: false };
  }

  const events: any[] = [];
  const listener = (evts: any[]) => {
    for (const e of evts) {
      if (e.eventSymbol === symbol) events.push(e);
    }
  };

  qs.addEventListener(listener);

  // Clear stale pre-reconnect events if the WebSocket reconnects mid-collection.
  const unsubReconnect = onReconnect(() => {
    events.length = 0;
    logger.info(`[DXLink] Reconnect detected mid-collection for ${symbol} — event buffer cleared.`);
  });

  const promise = new Promise<any[]>((resolve) => {
    setTimeout(() => {
      unsubReconnect();
      qs.removeEventListener(listener);
      inflightQuoteRequests.delete(symbol);
      resolve(events);
    }, timeoutMs);
  });

  inflightQuoteRequests.set(symbol, promise);
  return { promise, isNew: true };
}

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
    logger.warn(`[DXLink] Replaying ${symbols.length} quote subscription(s) after reconnect: ${symbols.join(", ")}`);
    try {
      qs.subscribe(symbols);
    } catch (err: any) {
      logger.warn(`[DXLink] Failed to replay quote subscriptions: ${err?.message ?? err}`);
    }
  }

  for (const { entry: sub } of activeCandleRefCounts.values()) {
    logger.warn(`[DXLink] Replaying candle subscription for ${sub.symbol} after reconnect.`);
    try {
      qs.subscribeCandles(sub.symbol, sub.fromTime, sub.periodMinutes, sub.candleType);
    } catch (err: any) {
      logger.warn(`[DXLink] Failed to replay candle subscription for ${sub.symbol}: ${err?.message ?? err}`);
    }
  }

  // Notify tool handlers that a reconnect has occurred so they can discard
  // any pre-reconnect events they may have already buffered.
  notifyReconnect();
}

function cancelPendingReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleQuoteStreamerReconnect(): void {
  if (explicitlyDisconnecting || !client) return;

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

function attachFeedListeners(feed: any, myVersion: number, qs: any): void {
  if (listenedFeeds.has(feed)) return;
  listenedFeeds.add(feed);

  const channel = feed.getChannel?.();
  if (channel && typeof channel.addErrorListener === "function") {
    channel.addErrorListener((err: any) => {
      if (err?.message === "Bye" || err?.message === "Reconnect") {
        logger.warn(`[DXLink] Server disconnect signal: ${err.message}. Scheduling reconnect.`);
        if (myVersion === currentConnectVersion && !explicitlyDisconnecting) {
          // Mark as disconnected so /health reports 503 until reconnect succeeds.
          quoteStreamerConnected = false;
          qs.isConnected = false;
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
        // Mark as disconnected so /health reports 503 until reconnect succeeds.
        quoteStreamerConnected = false;
        qs.isConnected = false;
        scheduleQuoteStreamerReconnect();
      }
    });
  }
}

const WS_CONNECT_READY_TIMEOUT_MS = 15_000;

function attachQuoteStreamerHandlers(c: TastytradeClient): void {
  const qs = c.quoteStreamer as any;

  qs.connect = async function patchedConnect() {
    cancelPendingReconnect();
    const myVersion = ++currentConnectVersion;

    // Explicitly close any existing DXLinkWebSocketClient before creating a new
    // one.  Without this the old socket lingers as an orphaned connection until
    // it times out on the server side.
    if (activeDxLinkWsClient !== null) {
      try {
        logger.warn("[QuoteStreamer] Closing previous WebSocket client before reconnect.");
        activeDxLinkWsClient.disconnect();
      } catch (err: any) {
        logger.warn(`[QuoteStreamer] Error closing old WebSocket client: ${err?.message ?? err}`);
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

    // --- Lifecycle logging for wsClient state transitions ---
    if (typeof wsClient.addConnectionStateChangeListener === "function") {
      wsClient.addConnectionStateChangeListener((state: string) => {
        if (myVersion !== currentConnectVersion) return;
        switch (state) {
          case "CONNECTING":
            logger.info("[DXLink] WebSocket connecting...");
            break;
          case "CONNECTED":
            logger.info("[DXLink] WebSocket connected and ready.");
            break;
          case "NOT_CONNECTED":
            logger.warn("[DXLink] WebSocket not connected.");
            break;
          default:
            logger.info(`[DXLink] WebSocket state → ${state}`);
        }
      });
    }

    logger.info(`[DXLink] Initiating WebSocket connection to ${qs.dxLinkUrl}`);
    wsClient.connect(qs.dxLinkUrl);
    wsClient.setAuthToken(qs.dxLinkAuthToken);

    // --- Await readiness before declaring the feed usable ---
    // subscribe() calls that land before the WS handshake completes are silently
    // dropped by DXLink, causing get_quote to return empty even when markets are
    // open.  We wait for the "CONNECTED" state signal (or a generous timeout
    // fallback) before marking the connection as ready.
    await new Promise<void>((resolve) => {
      // Check if already connected (state raced ahead before we registered).
      if (typeof wsClient.getConnectionState === "function" &&
          wsClient.getConnectionState() === "CONNECTED") {
        resolve();
        return;
      }

      // If the client has no state-change API, resolve immediately and let the
      // caller proceed (best-effort degradation).
      if (typeof wsClient.addConnectionStateChangeListener !== "function") {
        resolve();
        return;
      }

      const fallback = setTimeout(() => {
        logger.warn("[DXLink] WebSocket readiness timeout — proceeding anyway.");
        wsClient.removeConnectionStateChangeListener?.(readyListener);
        resolve();
      }, WS_CONNECT_READY_TIMEOUT_MS);

      const readyListener = (state: string) => {
        if (state === "CONNECTED") {
          clearTimeout(fallback);
          wsClient.removeConnectionStateChangeListener?.(readyListener);
          resolve();
        } else if (state === "NOT_CONNECTED") {
          // Connection dropped before becoming ready; resolve so the outer
          // try/catch in scheduleQuoteStreamerReconnect can handle it.
          clearTimeout(fallback);
          wsClient.removeConnectionStateChangeListener?.(readyListener);
          resolve();
        }
      };
      wsClient.addConnectionStateChangeListener(readyListener);
    });

    // Bail out if this connect attempt was superseded by a newer one.
    if (myVersion !== currentConnectVersion) {
      logger.warn("[DXLink] Connect attempt superseded — aborting stale patchedConnect.");
      return;
    }

    qs.dxLinkFeed = new DXLinkFeed(wsClient, FeedContract.AUTO);
    qs.dxLinkFeed.configure({
      acceptAggregationPeriod: 10,
      acceptDataFormat: FeedDataFormat.COMPACT,
    });

    qs.eventListeners.forEach((listener: any) =>
      qs.dxLinkFeed.addEventListener(listener)
    );

    quoteStreamerConnected = true;
    // Keep qs.isConnected in sync so market-data tools can skip the connect()
    // call on the first request after a successful pre-connect or reconnect.
    qs.isConnected = true;
    reconnectAttempts = 0;

    attachFeedListeners(qs.dxLinkFeed, myVersion, qs);

    replaySubscriptions(qs);
  };
}

export interface TastyTradeOAuthConfig {
  clientSecret: string;
  refreshToken: string;
  oauthScopes: string[];
  sandbox?: boolean;
}

/**
 * Explicit set of TastytradeClient REST service property names.
 * Only these services are proxied through the circuit breaker; all other
 * client properties (quoteStreamer, accountStreamer, accessToken, config, etc.)
 * are returned as-is to avoid interfering with DXLink/WebSocket machinery.
 */
const REST_SERVICE_PROPS = new Set([
  "accountsAndCustomersService",
  "accountStatusService",
  "balancesAndPositionsService",
  "instrumentsService",
  "marketMetricsService",
  "marginRequirementsService",
  "netLiquidatingValueHistoryService",
  "orderService",
  "riskParametersService",
  "symbolSearchService",
  "transactionsService",
  "watchlistsService",
]);

type AnyRecord = Record<string, unknown>;

function makeServiceProxy<T extends object>(service: T): T {
  return new Proxy(service, {
    get(obj, prop: string) {
      const value = (obj as AnyRecord)[prop];
      if (typeof value === "function") {
        const fn = value as (...a: unknown[]) => Promise<unknown>;
        return (...args: unknown[]) => cbExecute(() => fn.apply(obj, args));
      }
      return value;
    },
  });
}

function makeCircuitBreakerProxy(target: TastytradeClient): TastytradeClient {
  return new Proxy(target, {
    get(obj, prop: string) {
      const raw = (obj as unknown as AnyRecord)[prop];
      if (REST_SERVICE_PROPS.has(prop)) {
        return makeServiceProxy(raw as object);
      }
      return raw;
    },
  });
}

export function getClient(): TastytradeClient {
  if (!client) {
    throw new Error("TastyTrade client is not initialized. Authentication has not completed.");
  }
  // REST service calls go through the circuit breaker via makeCircuitBreakerProxy.
  // Non-REST properties (quoteStreamer, accessToken, etc.) are returned directly.
  return makeCircuitBreakerProxy(client);
}

/**
 * Fetches a backtester-compatible OAuth access token by calling /oauth/token
 * with grant_type=refresh_token but WITHOUT the `scope` parameter.
 *
 * Why this is necessary:
 * The TastyTrade SDK always sends `scope: "read trade"` when refreshing tokens.
 * The backtesting server (backtester.vast.tastyworks.com) rejects tokens issued
 * with a scope claim and only accepts scope-less tokens. Fetching the token
 * directly without scope produces a functionally identical JWT that the
 * backtesting API accepts.
 */
async function fetchBacktestToken(): Promise<void> {
  const clientSecret = process.env.TASTYTRADE_CLIENT_SECRET;
  const refreshToken = process.env.TASTYTRADE_REFRESH_TOKEN;
  const sandbox = process.env.TASTYTRADE_SANDBOX === "true";
  if (!clientSecret || !refreshToken) {
    throw new Error("TASTYTRADE_CLIENT_SECRET and TASTYTRADE_REFRESH_TOKEN must be set");
  }
  const baseUrl = sandbox
    ? "https://api.cert.tastyworks.com"
    : "https://api.tastyworks.com";
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_secret: clientSecret,
    // Intentionally no `scope` — scope-bearing tokens are rejected by the
    // backtesting API even though the SDK uses them for the main API.
  });
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "tastytrade-sdk-js",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`Backtest token fetch failed (${res.status}): ${text.slice(0, 200)}`),
      { status: res.status }
    );
  }
  const data = (await res.json()) as { access_token?: string };
  const token = data?.access_token;
  if (!token || typeof token !== "string") {
    throw new Error("Backtest token response did not contain an access_token");
  }
  sessionToken = token;
}

/** Returns the scope-less OAuth token accepted by the backtesting API. */
export async function requireSessionToken(): Promise<string> {
  if (!isAuthenticated) {
    throw new Error("TastyTrade client is not authenticated. Use check_auth_status to reconnect.");
  }
  if (!sessionToken) {
    // Route through the circuit breaker so failures count toward the threshold.
    try {
      await cbExecute(() => fetchBacktestToken());
    } catch (err: any) {
      throw new Error(`Backtesting token unavailable: ${err.message}`);
    }
  }
  return sessionToken!;
}

/** Returns the OAuth JWT used by the SDK for the main TastyTrade API. */
export function getSessionToken(): string {
  if (!client || !isAuthenticated) {
    throw new Error("TastyTrade client is not authenticated. Use check_auth_status to reconnect.");
  }
  const token = client.accessToken?.token;
  if (!token) {
    throw new Error("Session token is unavailable — try re-authenticating.");
  }
  return token;
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

    // Extend orderService with postComplexOrderDryRun so tools can preflight
    // multi-leg orders via POST /accounts/{id}/complex-orders/dry-run.
    // This endpoint is absent from the library but the service exposes httpClient.
    // We inline the library's extractResponseData logic (data.data.items >
    // data.data > raw) to avoid importing the non-exported internal subpath.
    {
      const svc = client.orderService as any;
      if (typeof svc.httpClient?.postData !== "function") {
        throw new Error(
          "[TastyTrade] orderService.httpClient.postData is not available — SDK internals have changed. " +
          "complex_order_dry_run patch cannot be applied."
        );
      }
      if (typeof svc.postComplexOrderDryRun !== "function") {
        svc.postComplexOrderDryRun = async function(accountNumber: string, order: any) {
          const response = await this.httpClient.postData(
            `/accounts/${accountNumber}/complex-orders/dry-run`, order, {}
          );
          // Mirror the library's extractResponseData logic:
          //   items list  →  data.data.items
          //   single obj  →  data.data
          //   fallback    →  raw response
          if (response?.data?.data?.items !== undefined) return response.data.data.items;
          if (response?.data?.data !== undefined) return response.data.data;
          return response;
        };
      }
    }

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
    return cbExecute(() =>
      authenticateOAuth({
        clientSecret,
        refreshToken,
        oauthScopes: ["read", "trade"],
        sandbox,
      })
    );
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
    // Clear qs.isConnected so market-data tools know to reconnect on next use.
    (client.quoteStreamer as any).isConnected = false;
    activeQuoteRefCounts.clear();
    activeCandleRefCounts.clear();
    // Explicitly close the underlying DXLinkWebSocketClient so the socket is
    // terminated immediately rather than left as an orphaned connection.
    if (activeDxLinkWsClient !== null) {
      try {
        activeDxLinkWsClient.disconnect();
        logger.info("[DXLink] Underlying WebSocket client closed on disconnect.");
      } catch (err: any) {
        logger.warn(`[DXLink] Error closing underlying WebSocket client: ${err?.message ?? err}`);
      }
      activeDxLinkWsClient = null;
    }
    try {
      await client.quoteStreamer.disconnect();
    } catch {}
    try {
      client.accountStreamer.stop();
    } catch {}
    client = null;
    isAuthenticated = false;
    sessionToken = null;
    explicitlyDisconnecting = false;
  }
}

export function getConnectionStatus() {
  // Use the SDK's stable .expiration getter (based on token creation time + expiresIn)
  // rather than recomputing Date.now() + expiresIn on every call, which would drift.
  const expiration = client?.accessToken?.expiration;
  const tokenExpiresAt = expiration instanceof Date ? expiration.toISOString() : null;
  return {
    isAuthenticated,
    keepaliveActive,
    backtestTokenAvailable: sessionToken !== null,
    quoteStreamerConnected,
    tokenExpiresAt,
    lastKeepaliveAt: lastKeepaliveAt ? new Date(lastKeepaliveAt).toISOString() : null,
    circuitBreaker: getCircuitBreakerStatus(),
  };
}

/**
 * Pre-connects the DXLink quote streamer immediately after authentication.
 * Call this once during server startup (after autoAuthenticate) to eliminate
 * the cold-start latency that would otherwise occur on the first get_quote call.
 * No-ops if already connected or if no client is authenticated.
 */
export async function preConnectQuoteStreamer(): Promise<void> {
  if (!client || !isAuthenticated) {
    logger.warn("[DXLink] preConnectQuoteStreamer: skipping — client not authenticated.");
    return;
  }
  if (quoteStreamerConnected) {
    logger.info("[DXLink] preConnectQuoteStreamer: already connected, skipping.");
    return;
  }
  logger.info("[DXLink] Pre-connecting quote streamer on startup...");
  try {
    await client.quoteStreamer.connect();
    logger.info("[DXLink] Quote streamer pre-connected successfully. WebSocket is warm.");
  } catch (err: any) {
    logger.warn(`[DXLink] Quote streamer pre-connect failed: ${err?.message ?? err}. Will retry on first use.`);
  }
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
        await cbExecute(() => client!.accountsAndCustomersService.getCustomerAccounts());
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
