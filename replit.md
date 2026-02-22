# TastyTrade MCP Server

## Overview
A Model Context Protocol (MCP) server that integrates with TastyTrade brokerage accounts using OAuth authentication. Exposes all TastyTrade API endpoints as callable MCP tools. Built with TypeScript and uses the official TastyTrade JavaScript SDK (`@tastytrade/api`) and DXLink for market data. Supports both stdio (local) and Streamable HTTP (cloud) transports.

## Architecture

### Tech Stack
- **Runtime**: Node.js 20
- **Language**: TypeScript (ES2022, Node16 modules)
- **MCP SDK**: `@modelcontextprotocol/sdk` - Model Context Protocol server implementation
- **TastyTrade SDK**: `@tastytrade/api` v7 - Official TastyTrade JavaScript SDK with OAuth support
- **HTTP Framework**: Express.js - Used for Streamable HTTP transport
- **Transports**: stdio (local/CLI) and Streamable HTTP (cloud/remote)

### Project Structure
```
src/
  index.ts                    - Main entry point, dual transport (stdio + HTTP), OAuth + bearer auth
  tastytrade-client.ts        - TastyTrade client wrapper with OAuth authentication
  oauth-provider.ts           - Built-in OAuth 2.1 authorization server (DCR, PKCE, token management)
  auth-page.ts                - HTML authorization page rendered during OAuth flow
  tools/
    auth-tools.ts             - Authentication tools (OAuth login, status, disconnect)
    account-tools.ts          - Account and customer info tools
    balance-position-tools.ts - Balance and position query tools
    order-tools.ts            - Order management tools (create, cancel, replace, etc.)
    instrument-tools.ts       - Instrument lookup tools (equities, options, futures, crypto)
    market-data-tools.ts      - Market data tools (quotes, candles, Greeks via DXLink)
    transaction-tools.ts      - Transaction history tools
    watchlist-tools.ts        - Watchlist management tools
    risk-margin-tools.ts      - Margin requirements and risk parameter tools
```

### Key Design Decisions
- **OAuth 2.1 Server**: Built-in authorization server supporting PKCE (S256), Dynamic Client Registration (RFC 7591), and standard discovery endpoints (RFC 8414, RFC 9728). Allows ChatGPT and other MCP clients to connect via standard OAuth flow.
- **TastyTrade OAuth**: Uses TastyTrade's OAuth with client secret + refresh token (SDK v7 pattern)
- **Dual transport**: Supports both stdio (for local CLI use) and Streamable HTTP (for cloud deployment)
- **Dual auth**: MCP endpoints accept both direct bearer tokens (MCP_BEARER_TOKEN) and OAuth-issued access tokens
- **Session management**: HTTP transport uses stateful sessions with UUID-based session IDs
- **WebSocket polyfill**: Uses `ws` package to polyfill WebSocket for Node.js (required by TastyTrade SDK's account streamer and DXLink)
- **DXLink integration**: Market data (quotes, candles, Greeks) is fetched via TastyTrade's QuoteStreamer which wraps DXLink

### OAuth 2.1 Flow (for ChatGPT / remote MCP clients)
1. Client discovers OAuth config via `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
2. Client registers dynamically via `POST /oauth/register`
3. Client redirects user to `GET /oauth/authorize` with PKCE challenge
4. User enters their MCP_BEARER_TOKEN on the authorization page
5. Server redirects back with authorization code
6. Client exchanges code for access token at `POST /oauth/token` with PKCE verifier
7. Client uses access token as Bearer token for MCP requests

### Environment Variables
- **MCP_TRANSPORT**: Set to `http` for cloud mode, defaults to `stdio` for local mode
- **MCP_BEARER_TOKEN**: Secret token to protect the HTTP endpoint (required for cloud deployment)
- **PORT**: HTTP server port (defaults to 5000)

### Available MCP Tools (73)
- **Auth**: authenticate_oauth, check_auth_status, disconnect
- **Accounts**: get_customer_accounts, get_customer_resource, get_full_account_resource, get_account_status
- **Balances/Positions**: get_account_balances, get_positions, get_balance_snapshots
- **Orders**: create_order, order_dry_run, cancel_order, replace_order, edit_order, get_orders, get_live_orders, create_complex_order, etc.
- **Instruments**: get_equity, get_option_chain, get_nested_option_chain, get_futures, get_cryptocurrencies, search_symbols, etc.
- **Market Data**: get_quote, get_candles, get_options_greeks, get_market_metrics, get_api_quote_token
- **Transactions**: get_transactions, get_transaction, get_total_fees
- **Watchlists**: get_all_watchlists, create_watchlist, delete_watchlist, get_public_watchlists, get_pairs_watchlists
- **Risk/Margin**: get_margin_requirements, estimate_margin_requirements, get_effective_margin_requirements, get_position_limit, get_net_liq_history, get_net_liq_value

## Usage

### Build and Run
```bash
npm run build      # Compile TypeScript
npm start          # Run the MCP server (stdio mode)
npm run dev        # Build and run in stdio mode
npm run dev:http   # Build and run in HTTP mode on port 5000
```

### Local Usage (stdio)
```bash
# MCP Inspector
npx @modelcontextprotocol/inspector node build/index.js

# Claude Desktop / ChatGPT Desktop config
{
  "mcpServers": {
    "tastytrade": {
      "command": "node",
      "args": ["/path/to/build/index.js"]
    }
  }
}
```

### Cloud Usage (HTTP)
Set `MCP_TRANSPORT=http` and `MCP_BEARER_TOKEN=your-secret-token`, then connect MCP clients to:
```
https://your-replit-url/mcp
```
Health check available at `/health`.

### TastyTrade Authentication
Before using any tools, authenticate with:
```
authenticate_oauth({
  clientSecret: "your-client-secret",
  refreshToken: "your-refresh-token",
  oauthScopes: ["read", "trade"],
  sandbox: false
})
```

## Deployment
- **Target**: VM (always-on, stateful sessions)
- **Build**: `npm run build`
- **Run**: `MCP_TRANSPORT=http node build/index.js`
- **Port**: 5000

## Recent Changes
- 2026-02-22: Added OAuth 2.1 authorization server for ChatGPT compatibility (PKCE, DCR, discovery endpoints)
- 2026-02-20: Added dual transport (stdio + Streamable HTTP) with bearer token auth
- 2026-02-20: Initial implementation with full TastyTrade API coverage (73 tools)
