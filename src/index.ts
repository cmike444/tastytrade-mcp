#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { registerAuthTools } from "./tools/auth-tools.js";
import { registerAccountTools } from "./tools/account-tools.js";
import { autoAuthenticate, startKeepalive, preConnectQuoteStreamer } from "./tastytrade-client.js";
import { registerBalancePositionTools } from "./tools/balance-position-tools.js";
import { registerOrderTools } from "./tools/order-tools.js";
import { registerInstrumentTools } from "./tools/instrument-tools.js";
import { registerMarketDataTools } from "./tools/market-data-tools.js";
import { registerTransactionTools } from "./tools/transaction-tools.js";
import { registerWatchlistTools } from "./tools/watchlist-tools.js";
import { registerRiskMarginTools } from "./tools/risk-margin-tools.js";
import { registerBacktestTools } from "./tools/backtest-tools.js";
import { registerDiscoveryTools } from "./tools/discovery-tools.js";
import { registerAccountResources } from "./resources/account-resources.js";
import { registerWatchlistResources } from "./resources/watchlist-resources.js";
import { registerSkillResources } from "./resources/skill-resources.js";
import { registerSkillTools } from "./tools/skill-tools.js";
import {
  getServerMetadata,
  getProtectedResourceMetadata,
  registerClient,
  getClient,
  isClientRedirectValid,
  createAuthorizationCode,
  exchangeCode,
  validateAccessToken,
  getOAuthMetrics,
} from "./oauth-provider.js";
import { renderAuthorizationPage } from "./auth-page.js";
import { getConnectionStatus } from "./tastytrade-client.js";
import { recordToolCall, recordHttpRequest, getMetricsSnapshot, initMetrics, startMetricsPersistence } from "./metrics.js";
import { logger } from "./logger.js";

const TOOL_DISCOVERY_MODE = process.env.TOOL_DISCOVERY_MODE === "true";
const _drainMs = parseInt(process.env.SHUTDOWN_DRAIN_MS || "10000", 10);
const SHUTDOWN_DRAIN_MS = Number.isFinite(_drainMs) && _drainMs >= 0 ? _drainMs : 10000;

let shuttingDown = false;
let inFlightMcpRequests = 0;

const SERVER_INSTRUCTIONS = `Before making any tool calls, load the skill guide by calling read_skill with no arguments. It maps every tool to its correct usage pattern and documents common pitfalls. Skipping this step leads to incorrect parameter shapes and avoidable errors.`;

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "tastytrade-mcp-server", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS }
  );

  // Wrap server.tool() so every registered handler is transparently instrumented
  // with latency and error-rate tracking. The handler is always the last argument
  // regardless of which overload is used (name+cb, name+desc+cb, name+schema+cb, etc.).
  const originalTool = server.tool.bind(server);
  server.tool = function (name: string, ...args: unknown[]) {
    const lastIdx = args.length - 1;
    const originalHandler = args[lastIdx] as (...a: unknown[]) => Promise<CallToolResult>;
    args[lastIdx] = async (...handlerArgs: unknown[]): Promise<CallToolResult> => {
      const start = Date.now();
      let isError = false;
      try {
        const result = await originalHandler(...handlerArgs);
        if (result.isError) isError = true;
        return result;
      } catch (err) {
        isError = true;
        throw err;
      } finally {
        recordToolCall(name, Date.now() - start, isError);
      }
    };
    return Reflect.apply(originalTool, server, [name, ...args]) as ReturnType<typeof server.tool>;
  };

  // Tools are registered in a fixed deterministic order on every startup.
  // This ensures the tool list schema is identical across sessions, which is
  // required for Anthropic prompt caching: the provider caches the tool
  // definitions prefix when it receives identical content on consecutive turns.
  registerAuthTools(server);
  registerSkillTools(server);
  registerAccountTools(server);
  registerBalancePositionTools(server);
  registerOrderTools(server);
  registerInstrumentTools(server);
  registerMarketDataTools(server);
  registerTransactionTools(server);
  registerWatchlistTools(server);
  registerRiskMarginTools(server);
  registerBacktestTools(server);

  if (TOOL_DISCOVERY_MODE) {
    registerDiscoveryTools(server);
    logger.info("[TastyTrade] TOOL_DISCOVERY_MODE enabled: discovery meta-tools registered (list_tool_categories, search_tools, get_tool_details).");
  }

  registerAccountResources(server);
  registerWatchlistResources(server);
  registerSkillResources(server);

  return server;
}

const BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
const MODE = process.env.MCP_TRANSPORT || "stdio";


function getBaseUrl(req: express.Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${proto}://${host}`;
}

function authenticateRequest(req: express.Request, res: express.Response): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const baseUrl = getBaseUrl(req);
    res
      .status(401)
      .set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
      )
      .json({ error: "unauthorized" });
    return false;
  }

  const token = authHeader.slice(7);

  if (BEARER_TOKEN && token === BEARER_TOKEN) {
    return true;
  }

  const oauthToken = validateAccessToken(token);
  if (oauthToken) {
    return true;
  }

  const baseUrl = getBaseUrl(req);
  res
    .status(401)
    .set(
      "WWW-Authenticate",
      `Bearer error="invalid_token", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
    )
    .json({ error: "invalid_token" });
  return false;
}

async function startHttpServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const sessions: Record<string, { transport: StreamableHTTPServerTransport; server: McpServer; createdAt: number }> = {};

  // Interval at which SSE keepalive comment lines are sent to every active
  // GET /mcp connection. Replit's reverse-proxy has a ~60 s idle timeout for
  // streaming responses; 25 s keeps us well under it.
  const SSE_PING_MS = 25_000;

  // Count every HTTP request and its outcome for the /status metrics endpoint.
  app.use((req, _res, next) => {
    _res.on("finish", () => {
      let path = req.path;
      if (path.startsWith("/oauth/")) path = "/oauth/*";
      else if (path.startsWith("/.well-known/")) path = "/.well-known/*";
      recordHttpRequest(path, _res.statusCode);
    });
    next();
  });

  app.get("/status", (_req, res) => {
    const snapshot = getMetricsSnapshot();
    const sessionList = Object.entries(sessions).map(([id, s]) => ({
      id,
      ageSeconds: Math.floor((Date.now() - s.createdAt) / 1000),
    }));
    const payload = {
      server: { ...snapshot.server, transportMode: MODE },
      tools: snapshot.tools,
      http: snapshot.http,
      mcp: {
        activeSessions: Object.keys(sessions).length,
        sessions: sessionList,
      },
      tastytrade: getConnectionStatus(),
      oauth: getOAuthMetrics(),
      skillCache: snapshot.skillCache,
    };
    res.set("Cache-Control", "no-store");
    res.type("application/json").send(JSON.stringify(payload, null, 2));
  });

  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    const baseUrl = getBaseUrl(req);
    res.set("Cache-Control", "public, max-age=3600");
    res.json(getProtectedResourceMetadata(`${baseUrl}/mcp`, baseUrl));
  });

  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    const baseUrl = getBaseUrl(req);
    res.set("Cache-Control", "public, max-age=3600");
    res.json(getServerMetadata(baseUrl));
  });

  app.post("/oauth/register", (req, res) => {
    logger.info(`[OAuth] POST /oauth/register body:`, JSON.stringify(req.body));
    const result = registerClient(req.body);
    if ("error" in result) {
      logger.warn(`[OAuth] Registration failed:`, result.error);
      res.status(400).json({ error: "invalid_client_metadata", error_description: result.error });
      return;
    }
    logger.info(`[OAuth] Registered client: ${result.client_id} (${result.client_name})`);
    res.status(201).json(result);
  });

  app.get("/oauth/authorize", (req, res) => {
    const {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      scope,
      response_type,
    } = req.query as Record<string, string>;

    if (response_type !== "code") {
      res.status(400).json({ error: "unsupported_response_type" });
      return;
    }

    if (!client_id || !redirect_uri || !code_challenge) {
      res.status(400).json({ error: "invalid_request", error_description: "Missing required parameters" });
      return;
    }

    if (code_challenge_method && code_challenge_method !== "S256") {
      res.status(400).json({ error: "invalid_request", error_description: "Only S256 code_challenge_method is supported" });
      return;
    }

    const client = getClient(client_id);
    logger.info(`[OAuth] GET /oauth/authorize client_id=${client_id} found=${!!client}`);
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    if (!isClientRedirectValid(client, redirect_uri)) {
      res.status(400).json({ error: "invalid_request", error_description: "redirect_uri not registered for this client" });
      return;
    }

    res.type("html").send(
      renderAuthorizationPage({
        client_id,
        redirect_uri,
        state: state || "",
        code_challenge,
        code_challenge_method: code_challenge_method || "S256",
        scope: scope || "mcp:tools",
        client_name: client.client_name,
      })
    );
  });

  app.post("/oauth/authorize/submit", (req, res) => {
    try {
      logger.info(`[OAuth] POST /oauth/authorize/submit body keys:`, Object.keys(req.body || {}));
      const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, token } =
        req.body as Record<string, string>;

      logger.info(`[OAuth] Submit: client_id=${client_id} redirect_uri=${redirect_uri}`);

      const submitClient = getClient(client_id);
      if (!submitClient || !isClientRedirectValid(submitClient, redirect_uri)) {
        logger.warn(`[OAuth] Submit error: invalid client or redirect. client=${!!submitClient}`);
        res.status(400).json({ error: "invalid_request", error_description: "Invalid client or redirect URI" });
        return;
      }

      if (!BEARER_TOKEN || token !== BEARER_TOKEN) {
        logger.warn(`[OAuth] Submit: invalid bearer token`);
        res.status(401).json({ error: "invalid_token" });
        return;
      }

      const code = createAuthorizationCode({
        client_id,
        redirect_uri,
        code_challenge,
        code_challenge_method: code_challenge_method || "S256",
        scope: scope || "mcp:tools",
      });

      logger.info(`[OAuth] Submit: code created, returning redirect URL to client`);
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) redirectUrl.searchParams.set("state", state);
      res.json({ redirect_url: redirectUrl.toString() });
    } catch (err) {
      logger.error(`[OAuth] Submit crash:`, err);
      res.status(500).json({ error: "server_error", error_description: "Internal error during authorization" });
    }
  });

  app.post("/oauth/token", (req, res) => {
    logger.info(`[OAuth] POST /oauth/token body:`, JSON.stringify(req.body));
    const { grant_type, code, client_id, code_verifier, redirect_uri, client_secret } = req.body as Record<
      string,
      string
    >;

    if (grant_type !== "authorization_code") {
      logger.warn(`[OAuth] Token error: unsupported grant_type=${grant_type}`);
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    if (!code || !client_id || !code_verifier || !redirect_uri) {
      logger.warn(`[OAuth] Token error: missing params code=${!!code} client_id=${!!client_id} verifier=${!!code_verifier} uri=${!!redirect_uri}`);
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const tokenResult = exchangeCode(code, client_id, code_verifier, redirect_uri, client_secret);
    if (!tokenResult) {
      logger.warn(`[OAuth] Token error: invalid_grant for client_id=${client_id}`);
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    logger.info(`[OAuth] Token issued for client_id=${client_id}`);
    res.json({
      access_token: tokenResult.token,
      token_type: "Bearer",
      expires_in: 86400,
      scope: tokenResult.scope,
    });
  });

  app.get("/health", (_req, res) => {
    const conn = getConnectionStatus();
    const healthy = conn.isAuthenticated && conn.quoteStreamerConnected;
    res.set("Cache-Control", "no-store");
    if (healthy) {
      res.status(200).json({ status: "ok", auth: true, wsConnected: true });
    } else {
      const reason = !conn.isAuthenticated
        ? "TastyTrade authentication unavailable"
        : "DXLink WebSocket not connected";
      res.status(503).json({
        status: "degraded",
        auth: conn.isAuthenticated,
        wsConnected: conn.quoteStreamerConnected,
        reason,
      });
    }
  });

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    logger.info(`[MCP] POST sessionId=${sessionId || "none"} method=${req.body?.method || "?"}`);

    if (shuttingDown) {
      res.status(503).json({ error: "server_shutting_down", message: "Server is shutting down. Please reconnect shortly." });
      return;
    }

    if (!authenticateRequest(req, res)) return;

    inFlightMcpRequests++;
    try {
      if (sessionId && sessions[sessionId]) {
        const { transport } = sessions[sessionId];
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Session ID was provided but the server has no record of it (e.g. after a
      // redeployment that cleared in-memory sessions).  Return a JSON-RPC error
      // response with HTTP 404 so that spec-compliant clients know to re-initialize.
      if (sessionId && !sessions[sessionId]) {
        logger.warn(`[MCP] Session ${sessionId} not found (server restarted?). Client must re-initialize.`);
        res.status(404).json({
          jsonrpc: "2.0",
          id: req.body?.id ?? null,
          error: { code: -32001, message: "Session not found or expired. Please disconnect and reconnect the MCP integration to start a new session." },
        });
        return;
      }

      if (!isInitializeRequest(req.body)) {
        res.status(400).json({ error: "First request must be an initialize request" });
        return;
      }

      const newSessionId = randomUUID();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      });
      const server = createMcpServer();
      await server.connect(transport);

      sessions[newSessionId] = { transport, server, createdAt: Date.now() };
      logger.info(`[MCP] Session ${newSessionId} created. Active sessions: ${Object.keys(sessions).length}`);

      transport.onclose = () => {
        delete sessions[newSessionId];
        logger.info(`[MCP] Session ${newSessionId} closed. Active sessions: ${Object.keys(sessions).length}`);
      };

      await transport.handleRequest(req, res, req.body);
    } finally {
      inFlightMcpRequests--;
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    logger.info(`[MCP] GET sessionId=${sessionId || "none"}`);
    if (shuttingDown) {
      res.status(503).json({ error: "server_shutting_down", message: "Server is shutting down. Please reconnect shortly." });
      return;
    }
    if (!authenticateRequest(req, res)) return;
    const session = sessions[sessionId];

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Send an SSE comment (": ping") every SSE_PING_MS milliseconds to prevent
    // Replit's reverse-proxy (and any intermediate load balancer) from closing
    // idle SSE connections. SSE comments are invisible to MCP clients but reset
    // the proxy's idle-read timer on every tick.
    const sseKeepalive = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(sseKeepalive);
        return;
      }
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(sseKeepalive);
      }
    }, SSE_PING_MS);

    res.on("close", () => clearInterval(sseKeepalive));

    await session.transport.handleRequest(req, res);
    clearInterval(sseKeepalive);
  });

  app.delete("/mcp", async (req, res) => {
    if (shuttingDown) {
      res.status(503).json({ error: "server_shutting_down", message: "Server is shutting down. Please reconnect shortly." });
      return;
    }
    if (!authenticateRequest(req, res)) return;

    res.set("Cache-Control", "no-store");

    const sessionId = req.headers["mcp-session-id"] as string;
    const session = sessions[sessionId];

    if (session) {
      await session.transport.close();
      session.server.close();
      delete sessions[sessionId];
    }

    res.status(200).end();
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error("[Express] Unhandled error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "server_error" });
    }
  });

  const port = parseInt(process.env.PORT || "5000", 10);
  app.listen(port, "0.0.0.0", () => {
    logger.info(`TastyTrade MCP Server running on http://0.0.0.0:${port}/mcp`);
    logger.info(`Health check: http://0.0.0.0:${port}/health`);
    logger.info("OAuth 2.1 endpoints enabled (PKCE + Dynamic Client Registration)");
    if (BEARER_TOKEN) {
      logger.info("Bearer token authentication is ENABLED");
    } else {
      logger.warn("WARNING: No MCP_BEARER_TOKEN set. Server is unprotected!");
    }
  });
}

async function startStdioServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("TastyTrade MCP Server running on stdio");
}

async function main() {
  // Load persisted metrics counters from disk so call counts and latency
  // survive server restarts, then start the periodic write-back timer.
  await initMetrics();
  startMetricsPersistence();

  let authSucceeded = false;
  try {
    const result = await autoAuthenticate();
    authSucceeded = true;
    logger.info(`[TastyTrade] ${result}`);
  } catch (error: any) {
    logger.warn(`[TastyTrade] Auto-authentication failed: ${error.message}`);
    logger.warn("[TastyTrade] Server will start without TastyTrade connection. Use check_auth_status tool to retry.");
  }

  // Pre-connect the DXLink WebSocket immediately after successful auth so the
  // first get_quote call doesn't pay the connection-establishment cost.
  if (authSucceeded) {
    await preConnectQuoteStreamer();
  }

  const cancelKeepalive = startKeepalive();

  function gracefulShutdown(signal: string) {
    logger.info(`[Process] Received ${signal}, beginning graceful shutdown (drain window: ${SHUTDOWN_DRAIN_MS}ms).`);
    shuttingDown = true;
    cancelKeepalive();

    const deadline = Date.now() + SHUTDOWN_DRAIN_MS;

    function checkDrain() {
      if (inFlightMcpRequests <= 0) {
        logger.info("[Process] All in-flight requests drained. Exiting.");
        process.exit(0);
      }
      if (Date.now() >= deadline) {
        logger.warn(`[Process] Drain timeout exceeded with ${inFlightMcpRequests} request(s) still in flight. Forcing exit.`);
        process.exit(0);
      }
      logger.info(`[Process] Waiting for ${inFlightMcpRequests} in-flight request(s) to complete...`);
      setTimeout(checkDrain, 500);
    }

    checkDrain();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  if (MODE === "http") {
    await startHttpServer();
  } else {
    await startStdioServer();
  }
}

process.on("uncaughtException", (err) => {
  logger.error("[Process] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  logger.error("[Process] Unhandled rejection:", reason);
});

main().catch((error) => {
  logger.error("Fatal error:", error);
  process.exit(1);
});
