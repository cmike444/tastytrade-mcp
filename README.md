# TastyTrade MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that connects to your TastyTrade brokerage account and exposes 72 trading tools. Built with the official [TastyTrade JavaScript SDK](https://github.com/tastytrade/tastytrade-api-js) and [DXLink](https://tools.dxfeed.com/dxlink) for real-time market data, quotes, and options Greeks.

Works with **ChatGPT Desktop**, **Claude Desktop**, or any MCP-compatible client -- both locally and in the cloud.

---

## Features

- **72 MCP tools** covering the full TastyTrade API
- **Automatic authentication** using stored TastyTrade credentials (client secret + refresh token)
- **OAuth 2.1 authorization server** for ChatGPT and remote MCP clients (PKCE, Dynamic Client Registration)
- **Real-time market data** via DXLink (quotes, candles, options Greeks)
- **Dual transport**: stdio (local) and Streamable HTTP (cloud)
- **Bearer token security** for cloud deployments

---

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- A TastyTrade account with API access (client secret and refresh token)

---

## Installation

```bash
git clone <your-repo-url>
cd tastytrade-mcp-server
npm install
npm run build
```

---

## Usage

### Option 1: Local (stdio)

Run the server directly and connect MCP clients via stdio.

```bash
node build/index.js
```

#### ChatGPT Desktop

Add this to your ChatGPT Desktop MCP configuration:

```json
{
  "mcpServers": {
    "tastytrade": {
      "command": "node",
      "args": ["/absolute/path/to/build/index.js"]
    }
  }
}
```

#### Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tastytrade": {
      "command": "node",
      "args": ["/absolute/path/to/build/index.js"]
    }
  }
}
```

#### MCP Inspector (for testing)

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

### Option 2: Cloud (Streamable HTTP)

Run the server as a web service so MCP clients can connect remotely.

```bash
MCP_TRANSPORT=http MCP_BEARER_TOKEN=your-secret-token node build/index.js
```

The server starts on port 5000 (configurable via `PORT` env var).

- **MCP endpoint**: `https://your-server-url/mcp`
- **Health check**: `https://your-server-url/health`

Connect your MCP client to the `/mcp` endpoint and include the bearer token in the `Authorization` header:

```
Authorization: Bearer your-secret-token
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_TRANSPORT` | No | `stdio` | Transport mode: `stdio` (local) or `http` (cloud) |
| `MCP_BEARER_TOKEN` | For cloud | - | Secret token to protect the HTTP endpoint |
| `TASTYTRADE_CLIENT_SECRET` | Yes | - | TastyTrade OAuth client secret (auto-loaded on startup) |
| `TASTYTRADE_REFRESH_TOKEN` | Yes | - | TastyTrade OAuth refresh token (auto-loaded on startup) |
| `TASTYTRADE_SANDBOX` | No | `false` | Set to `true` to use TastyTrade's sandbox/test environment |
| `PORT` | No | `5000` | HTTP server port (cloud mode only) |
| `TOOL_DISCOVERY_MODE` | No | `false` | Enable dynamic tool discovery mode (see below) |

---

## Dynamic Tool Discovery Mode

By default, all tools are registered at startup and broadcast to the LLM on every turn (~12,000–15,000 tokens of schema overhead per request). For token-sensitive deployments, you can enable **dynamic tool discovery** mode, which reduces the initial schema overhead to ~200–500 tokens.

### Enabling Discovery Mode

```bash
TOOL_DISCOVERY_MODE=true node build/index.js
```

When enabled, only three lightweight meta-tools are exposed at startup:

| Meta-tool | Description |
|---|---|
| `list_tool_categories` | Returns the top-level tool categories (Account, Orders, Market Data, Instruments, Watchlists, Risk, Auth) with a count of tools in each |
| `search_tools` | Keyword search over all tool names and descriptions — returns matching tools with one-sentence summaries |
| `get_tool_details` | Returns the full input schema and annotations for a specific tool by name |

Full tool schemas are stored in an internal registry but are **not broadcast** to the LLM in the initial context. The model discovers and fetches schemas on demand.

### Example Interaction Flow

```
User: What's the current price of AAPL?

Model → list_tool_categories()
← "Market Data (7 tools), Account (9 tools), ..."

Model → search_tools("quote price real-time")
← "get_quote [Market Data]: Get real-time quote data for one or more symbols using DXLink..."

Model → get_tool_details("get_quote")
← Full JSON schema with parameters (symbols, timeoutMs)

Model → get_quote(symbols=["AAPL"])
← { bid: 174.20, ask: 174.22, last: 174.21, ... }
```

On subsequent turns within the same session, the model can skip the discovery step and call `get_quote` directly if it already knows the schema from earlier in the conversation.

### Backward Compatibility

When `TOOL_DISCOVERY_MODE` is not set (or set to `false`), all tools register at startup exactly as before. Existing integrations are unaffected.

---

## TastyTrade Authentication

The server automatically authenticates with TastyTrade on startup using the `TASTYTRADE_CLIENT_SECRET` and `TASTYTRADE_REFRESH_TOKEN` environment variables. No manual authentication step is needed.

To obtain your client secret and refresh token, register for API access through TastyTrade's developer portal.

Use the `check_auth_status` tool to verify the connection status or retry authentication if needed.

---

## OAuth 2.1 Authorization Server

For remote MCP clients like ChatGPT, the server includes a built-in OAuth 2.1 authorization server that supports:

- **PKCE** (S256) for secure authorization code exchange
- **Dynamic Client Registration** (RFC 7591) for automatic client onboarding
- **Discovery endpoints** (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`)

### OAuth Flow

1. Client discovers OAuth config via `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
2. Client registers dynamically via `POST /oauth/register`
3. Client redirects user to `GET /oauth/authorize` with PKCE challenge
4. User enters their `MCP_BEARER_TOKEN` on the authorization page
5. Server redirects back with authorization code
6. Client exchanges code for access token at `POST /oauth/token` with PKCE verifier
7. Client uses access token as Bearer token for MCP requests

---

## Available Tools (72)

### Authentication (2)
| Tool | Description |
|---|---|
| `check_auth_status` | Check current authentication status |
| `disconnect` | Disconnect from TastyTrade |

### Accounts (4)
| Tool | Description |
|---|---|
| `get_customer_accounts` | Get all accounts for the authenticated customer |
| `get_customer_resource` | Get customer profile information |
| `get_full_account_resource` | Get full details for a specific account |
| `get_account_status` | Get trading status for an account |

### Balances & Positions (3)
| Tool | Description |
|---|---|
| `get_account_balances` | Get current balances for an account |
| `get_positions` | Get all positions for an account |
| `get_balance_snapshots` | Get historical balance snapshots |

### Orders (14)
| Tool | Description |
|---|---|
| `get_live_orders` | Get live (open) orders for an account |
| `get_orders` | Get orders with optional filtering |
| `get_order` | Get a specific order by ID |
| `create_order` | Submit a new order |
| `order_dry_run` | Preview an order without submitting |
| `cancel_order` | Cancel an open order |
| `replace_order` | Replace an existing order |
| `edit_order` | Edit an existing order |
| `create_complex_order` | Create a multi-leg complex order |
| `cancel_complex_order` | Cancel a complex order |
| `reconfirm_order` | Reconfirm an order |
| `replacement_order_dry_run` | Preview a replacement order |
| `get_customer_live_orders` | Get live orders across all accounts |
| `get_customer_orders` | Get orders across all accounts |

### Instruments (24)
| Tool | Description |
|---|---|
| `get_equity` | Get details for a specific equity |
| `get_equity_definitions` | Get equity definitions with filtering |
| `get_active_equities` | Get all active equities |
| `get_equity_options` | Get equity options for a symbol |
| `get_single_equity_option` | Get a specific equity option |
| `get_option_chain` | Get the option chain for a symbol |
| `get_nested_option_chain` | Get a nested option chain |
| `get_compact_option_chain` | Get a compact option chain |
| `get_futures` | Get futures contracts |
| `get_single_future` | Get a specific futures contract |
| `get_future_option_chain` | Get futures option chain |
| `get_nested_future_option_chain` | Get nested futures option chain |
| `get_future_options` | Get future options |
| `get_single_future_option` | Get a specific future option |
| `get_futures_products` | Get all futures products |
| `get_single_future_product` | Get a specific futures product |
| `get_future_option_products` | Get future option products |
| `get_single_future_option_product` | Get a specific future option product |
| `get_cryptocurrencies` | Get available cryptocurrencies |
| `get_single_cryptocurrency` | Get a specific cryptocurrency |
| `get_warrants` | Get available warrants |
| `get_single_warrant` | Get a specific warrant |
| `get_quantity_decimal_precisions` | Get quantity decimal precision rules |
| `search_symbols` | Search for symbols by text query |

### Market Data (7)
| Tool | Description |
|---|---|
| `get_market_metrics` | Get market metrics (IV rank, IV percentile, etc.) |
| `get_historical_dividends` | Get historical dividend data |
| `get_historical_earnings` | Get historical earnings data |
| `get_quote` | Get a real-time quote via DXLink |
| `get_candles` | Get historical candlestick data via DXLink |
| `get_options_greeks` | Get options Greeks (delta, gamma, theta, vega, rho) via DXLink |
| `get_api_quote_token` | Get a DXLink API quote token |

### Transactions (3)
| Tool | Description |
|---|---|
| `get_transactions` | Get transaction history for an account |
| `get_transaction` | Get a specific transaction by ID |
| `get_total_fees` | Get total fees for an account |

### Watchlists (9)
| Tool | Description |
|---|---|
| `get_all_watchlists` | Get all personal watchlists |
| `get_watchlist` | Get a specific watchlist |
| `create_watchlist` | Create a new watchlist |
| `replace_watchlist` | Replace/update a watchlist |
| `delete_watchlist` | Delete a watchlist |
| `get_public_watchlists` | Get public watchlists |
| `get_public_watchlist` | Get a specific public watchlist |
| `get_pairs_watchlists` | Get pairs trading watchlists |
| `get_pairs_watchlist` | Get a specific pairs watchlist |

### Risk & Margin (6)
| Tool | Description |
|---|---|
| `get_margin_requirements` | Get margin/capital requirements for an account |
| `estimate_margin_requirements` | Estimate margin for an order (dry run) |
| `get_effective_margin_requirements` | Get effective margin for a specific symbol |
| `get_position_limit` | Get position limits for an account |
| `get_net_liq_history` | Get net liquidating value history |
| `get_net_liq_value` | Get current net liquidating value |

---

## Prompt Caching

Anthropic and OpenAI both support **prompt caching**: when the tool definitions sent to the model are identical between consecutive turns, the provider caches the schema computation and charges a fraction of the normal rate on subsequent requests. With 73 tools (approximately 12,000–15,000 tokens of schema overhead), caching can reduce per-turn token costs by **50–90%** in multi-turn conversations.

### How it works with this server

This server is designed so that tool definitions are always emitted in the **same deterministic order** on every startup:

1. Auth tools
2. Account tools
3. Balance & position tools
4. Order tools
5. Instrument tools
6. Market data tools
7. Transaction tools
8. Watchlist tools
9. Risk & margin tools

Because the order never changes, MCP clients that forward the tool list to Anthropic or OpenAI will send an identical schema prefix on every request within and across sessions, allowing the provider to serve the schema from its cache.

### Verifying caching is active (Anthropic)

When you use Claude through the Anthropic API with tool definitions, the response includes usage statistics. Look for a non-zero `cache_read_input_tokens` field:

```json
{
  "usage": {
    "input_tokens": 512,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 14203
  }
}
```

A non-zero `cache_read_input_tokens` value confirms that the tool schema was served from Anthropic's prompt cache. On the first request in a new cache window, you will see `cache_creation_input_tokens` instead — this is the one-time cost to seed the cache.

### HTTP Cache-Control headers

The server sets the following `Cache-Control` headers on each response type:

| Endpoint | Header | Reason |
|---|---|---|
| `/.well-known/oauth-protected-resource` | `public, max-age=3600` | Stable OAuth metadata |
| `/.well-known/oauth-authorization-server` | `public, max-age=3600` | Stable OAuth metadata |
| `POST /mcp` | `no-store` | Dynamic tool calls may contain sensitive financial data |
| `GET /mcp` (SSE) | `no-store` | Live server-sent event streams are non-cacheable |
| `DELETE /mcp` | `no-store` | Session teardown responses are not cacheable |
| `/health` | `no-store` | Live server status |

### Client-side requirements

Prompt caching is handled by the **client application**, not this server. The current MCP SDK does not expose an API to inject provider-specific `cache_control` annotations (e.g. Anthropic's `{"type": "ephemeral"}`) into the tool list at the protocol level — this lives in the LLM API request assembled by the client. To enable caching:

- **Anthropic API**: Add `{"type": "ephemeral"}` as a `cache_control` annotation to the last tool definition in the list you send to the Anthropic API. The stable, deterministic ordering of the tool schema from this server ensures the content hash matches on every turn.
- **OpenAI API**: Prompt caching is automatic for prompts over 1,024 tokens; no extra configuration is needed.

---

## Deploying on Replit

This project is configured for deployment on Replit as an always-on VM:

1. Set the following secrets in the Replit Secrets panel:
   - `MCP_BEARER_TOKEN`
   - `TASTYTRADE_CLIENT_SECRET`
   - `TASTYTRADE_REFRESH_TOKEN`
2. Click **Publish** to deploy
3. Your MCP endpoint will be available at `https://your-replit-url/mcp`

---

## Project Structure

```
src/
  index.ts                    - Entry point (dual transport + OAuth 2.1 + bearer auth + TOOL_DISCOVERY_MODE)
  tastytrade-client.ts        - TastyTrade client wrapper (auto-authentication on startup)
  oauth-provider.ts           - Built-in OAuth 2.1 authorization server (DCR, PKCE, token management)
  auth-page.ts                - HTML authorization page rendered during OAuth flow
  tools/
    tool-registry.ts          - Internal registry of all tool definitions (used by discovery mode)
    discovery-tools.ts        - Meta-tools: list_tool_categories, search_tools, get_tool_details
    auth-tools.ts             - Authentication tools
    account-tools.ts          - Account & customer tools
    balance-position-tools.ts - Balances & positions
    order-tools.ts            - Order management
    instrument-tools.ts       - Instrument lookups
    market-data-tools.ts      - Market data (DXLink)
    transaction-tools.ts      - Transaction history
    watchlist-tools.ts        - Watchlist management
    risk-margin-tools.ts      - Margin & risk parameters
```

---

## License

MIT
