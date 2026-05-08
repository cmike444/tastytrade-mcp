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
  token-store.ts              - AES-256-GCM encrypted refresh token persistence (save/load/age)
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
- **TASTYTRADE_CLIENT_SECRET**: TastyTrade OAuth client secret (stored as Replit secret, auto-loaded on startup)
- **TASTYTRADE_REFRESH_TOKEN**: TastyTrade OAuth refresh token (stored as Replit secret, auto-loaded on startup)
- **TASTYTRADE_SANDBOX**: Set to `true` to use TastyTrade sandbox environment (optional)
- **TOKEN_ENCRYPTION_KEY**: 64-char hex string (32 bytes) used for AES-256-GCM encryption of the persisted refresh token file (`tastytrade-session.enc`). If absent or malformed, token persistence is silently disabled and auth falls back to env vars as before. Optional.
- **PORT**: HTTP server port (defaults to 5000)

### Available MCP Tools (72)
- **Auth**: check_auth_status, disconnect
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
The server automatically authenticates with TastyTrade on startup using stored secrets (TASTYTRADE_CLIENT_SECRET and TASTYTRADE_REFRESH_TOKEN). No manual authentication is needed. If credentials need to be updated, set them in Replit secrets. Use `check_auth_status` tool to verify connection or retry authentication.

## Deployment
- **Target**: VM (always-on, stateful sessions)
- **Build**: `npm run build`
- **Run**: `MCP_TRANSPORT=http node build/index.js`
- **Port**: 5000

## Recent Changes
- 2026-05-08: Streaming fix — two root causes for get_quote/get_options_greeks timeouts resolved: (1) patchedConnect now awaits the DXLink feed channel reaching OPENED state (not just WebSocket CONNECTED) so subscriptions are deliverable immediately when connect() returns; (2) switched acceptDataFormat from COMPACT to FULL to avoid silent event-drop when server FEED_CONFIG with eventFields hasn't arrived before FEED_DATA. Added OCC format detection in get_options_greeks (symbols containing spaces or matching OCC pattern return a clear error directing to streamer symbols). Diagnostic improvements: getOrCreateInflightQuote logs first event batch and timeout state with channel state; get_quote timeout message includes DXLink channel state; getConnectionStatus now exposes dxLinkChannelState field.
- 2026-05-01: Task #137 — Encrypted token persistence: new src/token-store.ts implements AES-256-GCM save/load/age APIs. autoAuthenticate tries persisted refresh token first (< 28 days old), falls back to TASTYTRADE_REFRESH_TOKEN env var, and saves the token that succeeded. Keepalive re-auth path also calls saveTokens. check_auth_status now returns persistedTokenAgeDays (days as float, or null). TOKEN_ENCRYPTION_KEY env var controls persistence (64-char hex, optional — disabled gracefully if absent/malformed). tastytrade-session.enc written atomically via .tmp rename. *.enc and *session*.json added to .gitignore. 9 unit tests (npm run test:token-store) + smoke test (npm run test:smoke:auth-persistence) added.
- 2026-05-01: Task #29 — WebSocket hardening: patchedConnect() now awaits DXLink CONNECTED state (using addConnectionStateChangeListener) before resolving, preventing silent subscribe() drops. activeDxLinkWsClient promoted to module scope and explicitly closed in disconnectClient() to prevent orphaned sockets. Lifecycle state logging added. Stale-data guard via onReconnect() pub-sub clears event buffers in get_quote, get_options_greeks, and get_candles if a reconnect occurs mid-collection.
- 2026-05-01: Task #28 — Server observability: src/metrics.ts now persists call counts/latencies to .metrics.json every 60s and restores them on startup so metrics survive restarts.
- 2026-05-01: Task #36 — Futures candle completeness: get_candles now detects futures option symbols (./ prefix) and resolves their streamer symbol via getSingleFutureOption in addition to outright futures (/ prefix via getFutures). Symbol parameter description updated with examples.
- 2026-05-01: Task #44 — HTML candlestick chart: get_candles accepts format: "html" and renders an SVG OHLCV candlestick chart with volume bars using renderCandlestick(). 23 edge-case renderer tests added in src/tests/render-utils.test.ts (npm run test:renderers).
- 2026-05-01: Task #46 — Skill guide health: MCP initialize response now includes instructions field prompting Claude to call read_skill before making tool calls. Drift detection script scripts/check-skill-drift.js added (npm run check:skill-drift) — exits non-zero if any registered tool is missing from the skill guide.
- 2026-04-27: Added hooks/tt-fetch-earnings-straddle.py — PostToolUse hook on get_options_greeks that auto-populates /tmp/tt_earnings_moves.json with implied_move = (ATM_call + ATM_put) / stock_price for each underlying in the response. stock_price from underlying-price field when present; otherwise estimated via put-call parity (K + call − put). ATM selected by call delta closest to 0.50; falls back to median strike when delta absent. Expiry preferred from calendar front_expiry; falls back to nearest future expiry with a complete call+put pair. Merges with any existing sidecar entries. Also supports --fetch UNDERLYING EXPIRY_ISO standalone mode for proactive prefetch via TastyTrade REST API. tt-ff-exit-monitor.py auto-invokes the companion script (via TT_STRADDLE_HOOK env var for testability) when earnings are detected but sidecar is absent; passes front_expiry for earn_in_front, back_expiry for earn_in_back. Added TestSidecar test class, TestSidecar.env support, fixture options_greeks_response.json (AAPL+SPY multi-strike greeks), mock_straddle_fetch.py for integration testing, and integration test for full self-healing path (sidecar-missing → prefetch → ex-earn FF). All 65 tests pass.
- 2026-04-26: Added hooks/tt-ff-exit-monitor.py — PostToolUse hook on get_market_metrics(detail="full") that reads open calendar positions from /tmp/tt_positions.json, computes Forward Factor (FF = (FrontIV − FwdVol) / FwdVol) for each calendar spread, and warns when FF ≤ 0% (edge gone — exit rule triggered). Added 4 integration tests and fixture ff_exit_monitor_full_response.json. Updated SKILL.md Hook-Injected Signals table with new entry.
- 2026-04-26: Added hooks/tests/ — integration test suite for pre-trade enforcement hooks with real-shaped TastyTrade order JSON fixtures (naked_short, bracketed_strangle, put_spread, futures_option_otoco, over_concentrated_strangle). Fixed two bugs in tt-concentration-cap.py: (1) OTOCO trigger-order.legs were not read for opening exposure, (2) OTOCO trigger-order.price was not read for notional calculation — both caused OTOCO orders to silently bypass the 25% concentration cap.
- 2026-02-22: Server-side credential storage - TastyTrade credentials auto-loaded from Replit secrets on startup, removed authenticate_oauth tool to prevent credential exposure through chat
- 2026-02-22: Added OAuth 2.1 authorization server for ChatGPT compatibility (PKCE, DCR, discovery endpoints)
- 2026-02-20: Added dual transport (stdio + Streamable HTTP) with bearer token auth
- 2026-02-20: Initial implementation with full TastyTrade API coverage (73 tools)
