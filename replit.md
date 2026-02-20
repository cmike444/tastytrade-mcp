# TastyTrade MCP Server

## Overview
A Model Context Protocol (MCP) server that integrates with TastyTrade brokerage accounts using OAuth authentication. Exposes all TastyTrade API endpoints as callable MCP tools. Built with TypeScript and uses the official TastyTrade JavaScript SDK (`@tastytrade/api`) and DXLink for market data.

## Architecture

### Tech Stack
- **Runtime**: Node.js 20
- **Language**: TypeScript (ES2022, Node16 modules)
- **MCP SDK**: `@modelcontextprotocol/sdk` - Model Context Protocol server implementation
- **TastyTrade SDK**: `@tastytrade/api` v7 - Official TastyTrade JavaScript SDK with OAuth support
- **Transport**: stdio (standard MCP transport for local/CLI use)

### Project Structure
```
src/
  index.ts                    - Main entry point, creates MCP server and registers all tools
  tastytrade-client.ts        - TastyTrade client wrapper with OAuth authentication
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
- **OAuth 2.0**: Uses TastyTrade's OAuth with client secret + refresh token (SDK v7 pattern)
- **stdio transport**: MCP server communicates via stdin/stdout JSON-RPC, suitable for use with Claude Desktop, MCP Inspector, etc.
- **WebSocket polyfill**: Uses `ws` package to polyfill WebSocket for Node.js (required by TastyTrade SDK's account streamer and DXLink)
- **DXLink integration**: Market data (quotes, candles, Greeks) is fetched via TastyTrade's QuoteStreamer which wraps DXLink

### Available MCP Tools (60+)
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
npm run build   # Compile TypeScript
npm start       # Run the MCP server
npm run dev     # Build and run in one step
```

### Connecting with MCP Inspector
```bash
npx @modelcontextprotocol/inspector node build/index.js
```

### Claude Desktop Configuration
Add to your Claude Desktop config:
```json
{
  "mcpServers": {
    "tastytrade": {
      "command": "node",
      "args": ["/path/to/build/index.js"]
    }
  }
}
```

### Authentication
Before using any tools, authenticate with:
```
authenticate_oauth({
  clientSecret: "your-client-secret",
  refreshToken: "your-refresh-token",
  oauthScopes: ["read", "trade"],
  sandbox: false
})
```

## Recent Changes
- 2026-02-20: Initial implementation with full TastyTrade API coverage
