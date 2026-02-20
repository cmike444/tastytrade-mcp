#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAuthTools } from "./tools/auth-tools.js";
import { registerAccountTools } from "./tools/account-tools.js";
import { registerBalancePositionTools } from "./tools/balance-position-tools.js";
import { registerOrderTools } from "./tools/order-tools.js";
import { registerInstrumentTools } from "./tools/instrument-tools.js";
import { registerMarketDataTools } from "./tools/market-data-tools.js";
import { registerTransactionTools } from "./tools/transaction-tools.js";
import { registerWatchlistTools } from "./tools/watchlist-tools.js";
import { registerRiskMarginTools } from "./tools/risk-margin-tools.js";

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TastyTrade MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
