# TastyTrade MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that connects to your TastyTrade brokerage account and exposes 73 trading tools. Built with the official [TastyTrade JavaScript SDK](https://github.com/tastytrade/tastytrade-api-js) and [DXLink](https://tools.dxfeed.com/dxlink) for real-time market data, quotes, and options Greeks.

Works with **ChatGPT Desktop**, **Claude Desktop**, or any MCP-compatible client -- both locally and in the cloud.

---

## Features

- **73 MCP tools** covering the full TastyTrade API
- **OAuth 2.0 authentication** using client secret + refresh token
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
| `PORT` | No | `5000` | HTTP server port (cloud mode only) |

---

## TastyTrade Authentication

Once connected through any MCP client, the first step is to authenticate with your TastyTrade account using the `authenticate_oauth` tool:

```
authenticate_oauth({
  clientSecret: "your-client-secret",
  refreshToken: "your-refresh-token",
  oauthScopes: ["read", "trade"],
  sandbox: false
})
```

**Parameters:**
- `clientSecret` - Your TastyTrade API client secret
- `refreshToken` - Your TastyTrade OAuth refresh token
- `oauthScopes` - Permissions: `"read"` for account data, `"trade"` for order execution
- `sandbox` - Set to `true` to use TastyTrade's sandbox/test environment

To obtain your client secret and refresh token, register for API access through TastyTrade's developer portal.

---

## Available Tools (73)

### Authentication (3)
| Tool | Description |
|---|---|
| `authenticate_oauth` | Authenticate with TastyTrade using OAuth 2.0 |
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

## Deploying on Replit

This project is configured for deployment on Replit as an always-on VM:

1. Set the `MCP_BEARER_TOKEN` secret in the Replit Secrets panel
2. Click **Publish** to deploy
3. Your MCP endpoint will be available at `https://your-replit-url/mcp`

---

## Project Structure

```
src/
  index.ts                    - Entry point (dual transport + bearer auth)
  tastytrade-client.ts        - TastyTrade client wrapper (OAuth)
  tools/
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
