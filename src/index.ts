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

function authenticateRequest(req: express.Request, res: express.Response): boolean {
  if (!BEARER_TOKEN) {
    return true;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header. Use: Bearer <token>" });
    return false;
  }
  const token = authHeader.slice(7);
  if (token !== BEARER_TOKEN) {
    res.status(403).json({ error: "Invalid bearer token" });
    return false;
  }
  return true;
}

async function startHttpServer() {
  const app = express();
  app.use(express.json());

  const sessions: Record<string, { transport: StreamableHTTPServerTransport; server: McpServer }> = {};

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", transport: "streamable-http", tools: 73 });
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
