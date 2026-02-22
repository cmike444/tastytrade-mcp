#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { registerAuthTools } from "./tools/auth-tools.js";
import { registerAccountTools } from "./tools/account-tools.js";
import { registerBalancePositionTools } from "./tools/balance-position-tools.js";
import { registerOrderTools } from "./tools/order-tools.js";
import { registerInstrumentTools } from "./tools/instrument-tools.js";
import { registerMarketDataTools } from "./tools/market-data-tools.js";
import { registerTransactionTools } from "./tools/transaction-tools.js";
import { registerWatchlistTools } from "./tools/watchlist-tools.js";
import { registerRiskMarginTools } from "./tools/risk-margin-tools.js";
import {
  getServerMetadata,
  getProtectedResourceMetadata,
  registerClient,
  getClient,
  isClientRedirectValid,
  createAuthorizationCode,
  exchangeCode,
  validateAccessToken,
} from "./oauth-provider.js";
import { renderAuthorizationPage } from "./auth-page.js";

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "tastytrade-mcp-server",
    version: "1.0.0",
  });

  registerAuthTools(server);
  registerAccountTools(server);
  registerBalancePositionTools(server);
  registerOrderTools(server);
  registerInstrumentTools(server);
  registerMarketDataTools(server);
  registerTransactionTools(server);
  registerWatchlistTools(server);
  registerRiskMarginTools(server);

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

  const sessions: Record<string, { transport: StreamableHTTPServerTransport; server: McpServer }> = {};

  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    const baseUrl = getBaseUrl(req);
    res.json(getProtectedResourceMetadata(baseUrl, baseUrl));
  });

  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    const baseUrl = getBaseUrl(req);
    res.json(getServerMetadata(baseUrl));
  });

  app.post("/oauth/register", (req, res) => {
    const result = registerClient(req.body);
    if ("error" in result) {
      res.status(400).json({ error: "invalid_client_metadata", error_description: result.error });
      return;
    }
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
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, token } =
      req.body as Record<string, string>;

    const submitClient = getClient(client_id);
    if (!submitClient || !isClientRedirectValid(submitClient, redirect_uri)) {
      res.status(400).json({ error: "invalid_request", error_description: "Invalid client or redirect URI" });
      return;
    }

    if (!BEARER_TOKEN || token !== BEARER_TOKEN) {
      res.type("html").send(
        renderAuthorizationPage({
          client_id,
          redirect_uri,
          state: state || "",
          code_challenge,
          code_challenge_method: code_challenge_method || "S256",
          scope: scope || "mcp:tools",
          client_name: submitClient.client_name,
        })
      );
      return;
    }

    const code = createAuthorizationCode({
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method: code_challenge_method || "S256",
      scope: scope || "mcp:tools",
    });

    const url = new URL(redirect_uri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    res.redirect(url.toString());
  });

  app.post("/oauth/token", (req, res) => {
    const { grant_type, code, client_id, code_verifier, redirect_uri } = req.body as Record<
      string,
      string
    >;

    if (grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    if (!code || !client_id || !code_verifier || !redirect_uri) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const tokenResult = exchangeCode(code, client_id, code_verifier, redirect_uri);
    if (!tokenResult) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    res.json({
      access_token: tokenResult.token,
      token_type: "Bearer",
      expires_in: 86400,
      scope: tokenResult.scope,
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", transport: "streamable-http", tools: 73, oauth: true });
  });

  app.post("/mcp", async (req, res) => {
    if (!authenticateRequest(req, res)) return;

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions[sessionId]) {
      const { transport } = sessions[sessionId];
      await transport.handleRequest(req, res, req.body);
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

    sessions[newSessionId] = { transport, server };

    transport.onclose = () => {
      delete sessions[newSessionId];
    };

    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    if (!authenticateRequest(req, res)) return;

    const sessionId = req.headers["mcp-session-id"] as string;
    const session = sessions[sessionId];

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    await session.transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    if (!authenticateRequest(req, res)) return;

    const sessionId = req.headers["mcp-session-id"] as string;
    const session = sessions[sessionId];

    if (session) {
      await session.transport.close();
      session.server.close();
      delete sessions[sessionId];
    }

    res.status(200).end();
  });

  const port = parseInt(process.env.PORT || "5000", 10);
  app.listen(port, "0.0.0.0", () => {
    console.error(`TastyTrade MCP Server running on http://0.0.0.0:${port}/mcp`);
    console.error(`Health check: http://0.0.0.0:${port}/health`);
    console.error("OAuth 2.1 endpoints enabled (PKCE + Dynamic Client Registration)");
    if (BEARER_TOKEN) {
      console.error("Bearer token authentication is ENABLED");
    } else {
      console.error("WARNING: No MCP_BEARER_TOKEN set. Server is unprotected!");
    }
  });
}

async function startStdioServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TastyTrade MCP Server running on stdio");
}

async function main() {
  if (MODE === "http") {
    await startHttpServer();
  } else {
    await startStdioServer();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
