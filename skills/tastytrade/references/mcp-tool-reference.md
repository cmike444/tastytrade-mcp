# TastyTrade MCP Server — Master Skill Guide

> Call `read_skill` at the start of any session to load this guide. Use `read_skill` with a `section` parameter to fetch a specific section (e.g., `section: "Symbol Formats"`).

---

## Table of Contents

1. [Authentication & Session Lifecycle](#authentication--session-lifecycle)
2. [Symbol Formats](#symbol-formats)
3. [Detail Level Guide](#detail-level-guide)
4. [Tool Reference](#tool-reference)
   - [Auth (4 tools)](#auth-tools)
   - [Account (5 tools)](#account-tools)
   - [Orders (11 tools)](#order-tools)
   - [Market Data (7 tools)](#market-data-tools)
   - [Instruments (2 tools)](#instrument-tools)
   - [Watchlists (2 tools)](#watchlist-tools)
   - [Risk (6 tools)](#risk-tools)
   - [Backtesting (6 tools)](#backtesting-tools)
5. [MCP Resources](#mcp-resources)
6. [Order Placement Protocol](#order-placement-protocol)
7. [Strategy Playbooks](#strategy-playbooks)
   - [Sell a Cash-Secured Put](#sell-a-cash-secured-put)
   - [Credit Spread (Bull Put / Bear Call)](#credit-spread)
   - [VRP Strangle (16-delta, ~45 DTE)](#vrp-strangle)
   - [0DTE Iron Condor](#0dte-iron-condor)
   - [Roll a Losing Leg](#roll-a-losing-leg)
   - [Close a Position at 50% Profit](#close-a-position-at-50-profit)
8. [Backtesting Playbooks](#backtesting-playbooks)
   - [VRP Strangle Backtest](#vrp-strangle-backtest)
   - [0DTE Iron Condor Backtest](#0dte-iron-condor-backtest)
   - [strikeSelection Methods](#strikeselection-methods)
   - [entryConditions Field Guide](#entryconditions-field-guide)
   - [exitConditions Field Guide](#exitconditions-field-guide)
   - [Earnings-Aware Backtesting](#earnings-aware-backtesting)
   - [Supply & Demand Zone Backtesting](#supply--demand-zone-backtesting)
   - [simulate_trade (One-Shot Lookup)](#simulate_trade-one-shot-lookup)
   - [Reading Backtest Output](#reading-backtest-output)
   - [Interpreting Results Before Going Live](#interpreting-results-before-going-live)
9. [Risk Management](#risk-management)
10. [Account Growth Guidelines](#account-growth-guidelines)
11. [HTML Artifact Guide](#html-artifact-guide)

---

## Authentication & Session Lifecycle

The server authenticates with TastyTrade automatically on startup using the `TASTYTRADE_CLIENT_SECRET` and `TASTYTRADE_REFRESH_TOKEN` environment variables. No manual login is required.

**Session tools:**

| Tool | Purpose |
|------|---------|
| `check_auth_status` | Verify authentication is active; auto-reconnects if token has expired |
| `disconnect` | Tear down the TastyTrade session and all DXLink WebSocket connections |

**Best practice:** Call `check_auth_status` at the start of any session that may have been idle for more than 24 hours. The server will attempt to reconnect automatically if the session token has expired.

**Typical session flow:**
1. `check_auth_status` → confirm connected
2. `get_account_info` with `detail: "customer_accounts"` → list account numbers
3. Use the account number in all subsequent tool calls

---

## Symbol Formats

### Quick-Reference Table

| Asset Class | Format | Example | Notes |
|-------------|--------|---------|-------|
| Equity | Ticker | `AAPL`, `SPY`, `QQQ` | Plain uppercase ticker |
| Equity Option (OCC) | `SYM   YYMMDDCSSSSS` | `SPY   250117C00500000` | 6-char padded symbol, 6-digit date, C/P, 8-digit strike ×1000 |
| Future | `/ROOT` or `/ROOTMMYY` | `/ES`, `/ESM6`, `/ESM25` | Leading slash; contract month+year suffix for specific expiry |
| Future Option | `./ROOT MMYY side strike` | `./ESM6 EW1M6 P4900` | Dot-slash prefix on root; space-separated components |
| Cryptocurrency | Plain ticker | `BTC/USD`, `ETH/USD` | Forward slash in crypto pairs |
| DXLink Streamer | Varies by type | `.SPXW250117P4800` | Use `call-streamer-symbol` / `put-streamer-symbol` from option chain response for Greeks |

### OCC Option Symbol Construction

```
SPY   250117C00500000
^^^   ^^^^^^ ^ ^^^^^^^^
|     |      | |
|     |      | Strike × 1000, zero-padded to 8 digits
|     |      C=Call, P=Put
|     YYMMDD expiration date
6-char symbol (left-padded with spaces)
```

**Example — SPY 500-strike call expiring Jan 17 2025:**
`SPY   250117C00500000`

### Futures Symbol Notes

- `/ES` — front-month E-mini S&P 500 future (no specific contract)
- `/ESM6` — E-mini S&P 500, June 2026 contract (M = June, 6 = 2026)
- Month codes: `F`=Jan `G`=Feb `H`=Mar `J`=Apr `K`=May `M`=Jun `N`=Jul `Q`=Aug `U`=Sep `V`=Oct `X`=Nov `Z`=Dec

### Futures Options Symbol Notes

Format: `./ROOT MONTHYEAR side strike`

```
./ESM6 EW1M6 P4900
^^     ^^^^^ ^^^^^
|      |     Put at 4900
|      Weekly contract code (EW1 = 1st weekly, M6 = June 2026)
Front-month future root with dot-slash prefix
```

Use `get_instrument` with `type: "future_option_chain"` and the futures symbol to discover the correct option symbols and streamer symbols for a given expiry.

### DXLink Streamer Symbols

DXLink streamer symbols differ from OCC symbols. Always fetch them from the option chain response — look for `call-streamer-symbol` and `put-streamer-symbol` fields. Pass these to `get_options_greeks` and `get_quote`.

---

## Detail Level Guide

Many tools accept a `detail` parameter that controls response verbosity:

| Level | Description | Best For |
|-------|-------------|---------|
| `summary` | 3–5 key fields only | Quick overview, minimal tokens |
| `standard` | Most commonly needed fields (default) | Day-to-day use |
| `full` | Complete raw API payload | Debugging, data exploration |

**Tools supporting `detail`:** `get_positions`, `get_market_metrics`, `get_options_greeks`

**Tools supporting `format: "html"`:** `get_positions`, `get_market_metrics`, `get_options_greeks`, `get_net_liq_history`, `get_backtest_results`

---

## Tool Reference

### Auth Tools

#### `check_auth_status`
Check if authenticated; auto-reconnects on expiry.
- **Params:** none
- **Returns:** Status string confirming authenticated or reconnection result
- **Example:**
```json
{ }
```

#### `disconnect`
Tear down all connections gracefully.
- **Params:** none
- **Example:**
```json
{ }
```

#### `list_skills`
Return the names and one-line descriptions of all available skill guides on this server.
- **Params:** none
- **Returns:** JSON array of `{ name, description }` objects
- **Example:**
```json
{ }
```
**Sample response:**
```json
[{ "name": "tastytrade", "description": "TastyTrade MCP server operational guide: all tools, symbol formats, order workflows, strategy playbooks, and backtesting reference." }]
```

#### `read_skill`
Load the TastyTrade operational skill guide. Call this at the start of any session to prime yourself with the full tool reference, symbol formats, and trading workflows.
- **Params:** `section` (optional string) — heading text to extract a specific section; omit for the full document
- **Returns:** Full markdown guide text, or the matching section if `section` is specified
- **Category:** Auth
- **Example — full guide:**
```json
{ }
```
- **Example — specific section:**
```json
{ "section": "Symbol Formats" }
```
- **Example — backtesting reference:**
```json
{ "section": "strikeSelection Methods" }
```
**Available section headings include:** `Authentication & Session Lifecycle`, `Symbol Formats`, `Detail Level Guide`, `Order Placement Protocol`, `Strategy Playbooks`, `Backtesting Playbooks`, `strikeSelection Methods`, `entryConditions Field Guide`, `exitConditions Field Guide`, `Risk Management`, `Account Growth Guidelines`, `HTML Artifact Guide`

---

### Account Tools

#### `get_account_info`
Single unified tool for all account/customer queries. Choose a `detail` level:

| `detail` | What It Returns | Required Params |
|----------|----------------|-----------------|
| `customer_accounts` | List of all accounts with account numbers | none |
| `customer_resource` | Full customer profile | none |
| `full_account` | Complete account record | `accountNumber` |
| `account_status` | Trading permissions and status flags | `accountNumber` |

**Example — list accounts:**
```json
{ "detail": "customer_accounts" }
```

**Example — get account status:**
```json
{ "detail": "account_status", "accountNumber": "5WX12345" }
```

#### `get_positions`
Get current open positions.
- **Params:** `accountNumber` (required), `symbol`, `underlyingSymbol`, `detail` (summary/standard/full), `format` (json/html)
- **Example:**
```json
{ "accountNumber": "5WX12345", "detail": "standard" }
```
- **HTML format** returns a table with P&L color-coding (green/red).

#### `get_balance_snapshots`
Historical balance snapshots (BOD/EOD).
- **Params:** `accountNumber` (required), `timeOfDay` ("BOD" or "EOD")
- **Example:**
```json
{ "accountNumber": "5WX12345", "timeOfDay": "EOD" }
```

#### `get_transactions`
Paginated transaction history.
- **Params:** `accountNumber` (required), `perPage`, `pageOffset`, `sort`, `type`, `subType`, `startDate`, `endDate`, `symbol`
- **Example:**
```json
{ "accountNumber": "5WX12345", "startDate": "2025-01-01", "endDate": "2025-03-31", "perPage": 50 }
```

#### `get_transaction`
Fetch a single transaction by ID.
- **Params:** `accountNumber`, `transactionId` (both required)

#### `get_total_fees`
Total fees incurred today.
- **Params:** `accountNumber` (required)

---

### Order Tools

#### `query_orders`
Unified order query across five scopes:

| `scope` | What It Returns | Required Extras |
|---------|----------------|-----------------|
| `account_live` | Open/live orders for one account | `accountNumber` |
| `account_history` | Filled/cancelled orders for one account | `accountNumber` |
| `account_single` | One specific order | `accountNumber`, `orderId` |
| `customer_live` | Live orders across all accounts | `customerId` |
| `customer_history` | All orders across all accounts | `customerId` |

**Example — live orders:**
```json
{ "scope": "account_live", "accountNumber": "5WX12345" }
```

#### `order_dry_run`
Validate a **single-leg simple** order before submitting. Use ONLY for `Limit`, `Market`, `Stop`, `Stop Limit`, `Notional Market` order types. For multi-leg complex orders or `Net Debit` / `Net Credit` types, use `complex_order_dry_run` instead.
- **Returns:** fees, buying-power effect, warnings, fill estimate
- **Params:** `accountNumber`, `time-in-force`, `order-type`, `price`, `price-effect`, `legs[]`

**Single-leg example (sell to open 1 SPY put):**
```json
{
  "accountNumber": "5WX12345",
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 2.50,
  "price-effect": "Credit",
  "legs": [{
    "instrument-type": "Equity Option",
    "symbol": "SPY   250117P00480000",
    "action": "Sell to Open",
    "quantity": 1
  }]
}
```

#### `complex_order_dry_run`
Validate a **complex (multi-leg)** order before submitting. Supports `Net Debit`, `Net Credit`, `Limit`, and `Market` order types. Always run this before `create_complex_order` for spreads, straddles, strangles, condors, calendars, and any order with 2+ legs.
- **Returns:** fees, buying-power effect, warnings, fill estimate
- **Params:** `accountNumber`, `type` (`"BLAST_ALL"` | `"OCO"` | `"OTOCO"`), `orders[]` (each with `time-in-force`, `order-type`, `price`, `price-effect`, `legs[]`), `trigger-order` (required for OTOCO), `source` (optional)

**4-leg iron condor example (BLAST_ALL):**
```json
{
  "accountNumber": "5WX12345",
  "type": "BLAST_ALL",
  "orders": [{
    "time-in-force": "Day",
    "order-type": "Limit",
    "price": 2.50,
    "price-effect": "Credit",
    "legs": [
      { "instrument-type": "Equity Option", "symbol": "SPY   250117C00465000", "action": "Buy to Open", "quantity": 1 },
      { "instrument-type": "Equity Option", "symbol": "SPY   250117C00460000", "action": "Sell to Open", "quantity": 1 },
      { "instrument-type": "Equity Option", "symbol": "SPY   250117P00445000", "action": "Sell to Open", "quantity": 1 },
      { "instrument-type": "Equity Option", "symbol": "SPY   250117P00440000", "action": "Buy to Open", "quantity": 1 }
    ]
  }]
}
```

#### `create_order`
Submit the order after reviewing the dry-run output.
- **Params:** identical to `order_dry_run`

#### `create_complex_order`
Multi-leg spread/combo in one order. Always run `complex_order_dry_run` first to validate.
- **Params:** `accountNumber`, `type` (`"BLAST_ALL"` | `"OCO"` | `"OTOCO"`), `orders[]`, `trigger-order` (required for OTOCO), `source` (optional)
- **Use for:** spreads, straddles, iron condors, calendars, OCO brackets, OTOCO entry+bracket

#### `cancel_order` / `cancel_complex_order`
Cancel a live order.
- **Params:** `accountNumber`, `orderId`

#### `replace_order`
Replace a live order (cancel + resubmit atomically).
- **Params:** `accountNumber`, `orderId`, plus new order fields

#### `replacement_order_dry_run`
Dry-run a replacement before committing.
- **Params:** same as `replace_order`

#### `edit_order`
Change price only on a live order.
- **Params:** `accountNumber`, `orderId`, `price`, `price-effect`

#### `reconfirm_order`
Re-confirm a stale order that needs acknowledgment.
- **Params:** `accountNumber`, `orderId`

---

### Market Data Tools

#### `get_market_metrics`
IV rank, IV percentile, and volatility data.
- **Params:** `symbols[]` (required), `detail` (summary/standard/full), `format` (json/html)
- **Summary fields:** symbol, IV rank, IV percentile
- **Standard fields:** adds HV, implied move, earnings info
- **HTML format:** IV rank gauge cards

**Example:**
```json
{ "symbols": ["SPY", "QQQ", "AAPL"], "detail": "standard" }
```

#### `get_quote`
Real-time bid/ask/last via DXLink WebSocket.
- **Params:** `symbols[]` (required), `timeoutMs` (default 5000)

**Example:**
```json
{ "symbols": ["SPY", ".SPXW250117P4800"] }
```

#### `get_candles`
OHLCV candlestick data.
- **Params:** `symbol` (required), `periodMinutes`, `daysBack`, `timeoutMs`

**Example — daily candles for 30 days:**
```json
{ "symbol": "SPY", "periodMinutes": 1440, "daysBack": 30 }
```

#### `get_options_greeks`
Delta, gamma, theta, vega, rho via DXLink.
- **Params:** `optionSymbols[]` (DXLink streamer symbols, required), `timeoutMs`, `detail`, `format`
- **Important:** Use `call-streamer-symbol` / `put-streamer-symbol` from the option chain, not OCC symbols.

**Example:**
```json
{ "optionSymbols": [".SPY250117P480"], "detail": "standard" }
```

#### `get_historical_dividends`
Historical dividend records.
- **Params:** `symbol` (required), `limit` (default 10)

#### `get_historical_earnings`
Historical earnings dates and EPS.
- **Params:** `symbol` (required), `limit` (default 10)

#### `get_api_quote_token`
Raw DXLink token for direct WebSocket connections.
- **Params:** none

---

### Instrument Tools

#### `get_instrument`
Look up any instrument definition. Select `type` to choose the asset class and operation:

**Equity types:** `equity`, `equity_definitions`, `active_equities`
**Option types:** `equity_option`, `equity_options`, `option_chain`, `nested_option_chain`, `compact_option_chain`
**Futures types:** `future`, `futures`, `futures_products`, `future_product`
**Futures options:** `future_option`, `future_options`, `future_option_chain`, `nested_future_option_chain`, `future_option_products`, `future_option_product`
**Other:** `cryptocurrency`, `cryptocurrencies`, `warrant`, `warrants`, `quantity_decimal_precisions`

**Example — SPY option chain:**
```json
{ "type": "option_chain", "symbol": "SPY" }
```

**Example — ES futures option chain:**
```json
{ "type": "future_option_chain", "symbol": "/ES" }
```

**Example — nested SPY option chain (grouped by expiry then strike):**
```json
{ "type": "nested_option_chain", "symbol": "SPY" }
```

#### `search_symbols`
Full-text symbol search.
- **Params:** `query` (required)
- **Example:**
```json
{ "query": "apple" }
```

---

### Watchlist Tools

#### `manage_watchlist`
CRUD operations on personal watchlists.

| `action` | Purpose | Required Extras |
|----------|---------|-----------------|
| `get` | Fetch a named watchlist | `watchlistName` |
| `create` | Create a new watchlist | `watchlistName`, `watchlistEntries[]` |
| `replace` | Overwrite an existing watchlist | `watchlistName`, `watchlistEntries[]` |
| `delete` | Remove a watchlist | `watchlistName` |

**Example — create watchlist:**
```json
{
  "action": "create",
  "watchlistName": "High-IV Stocks",
  "watchlistEntries": [
    { "symbol": "TSLA", "instrument-type": "Equity" },
    { "symbol": "NVDA", "instrument-type": "Equity" }
  ]
}
```

> To list all watchlists, read the MCP resource `mcp://watchlists` instead of calling a tool.

#### `manage_public_watchlist`
Access TastyTrade's curated public watchlists.

| `action` | Purpose |
|----------|---------|
| `list_public` | List all public watchlists |
| `get_public` | Get a specific public watchlist by name |
| `list_pairs` | List all pairs watchlists |
| `get_pairs` | Get a specific pairs watchlist |

---

### Risk Tools

#### `get_margin_requirements`
Full margin/capital report for an account.
- **Params:** `accountNumber` (required)

#### `estimate_margin_requirements`
Estimate margin for a hypothetical order.
- **Params:** `accountNumber`, `orderJson` (JSON string of order)

#### `get_effective_margin_requirements`
Effective margin for a specific underlying symbol.
- **Params:** `accountNumber`, `underlyingSymbol`

**Example:**
```json
{ "accountNumber": "5WX12345", "underlyingSymbol": "SPY" }
```

#### `get_position_limit`
Maximum allowed position size for the account.
- **Params:** `accountNumber`

#### `get_net_liq_history`
Historical net liquidating value.
- **Params:** `accountNumber` (required), `timeBack` ("1d", "1m", "3m", "1y", "all"), `format` (json/html)
- **HTML format:** SVG line chart with area fill

**Example:**
```json
{ "accountNumber": "5WX12345", "timeBack": "3m", "format": "html" }
```

#### `get_net_liq_value`
Current net liquidating value (single number).
- **Params:** `accountNumber`

---

### Backtesting Tools

#### `get_available_backtest_dates`
Discover which symbols can be backtested and their date ranges.
- **Params:** `symbol` (optional filter)

**Example:**
```json
{ "symbol": "SPY" }
```

#### `run_backtest`
Submit an options backtest. Returns `backtestId` immediately — poll with `get_backtest_results`.
- **Params:** `symbol`, `startDate`, `endDate`, `legs[]`, `entryConditions`, `exitConditions` (optional)
- **Returns:** `{ backtestId, status }`

See [strikeSelection Methods](#strikeselection-methods), [entryConditions](#entryconditions-field-guide), and [exitConditions](#exitconditions-field-guide) for detailed parameter documentation.

#### `get_backtest_results`
Poll for backtest status and full results.
- **Params:** `backtestId` (required), `format` (json/html)
- **Returns:** `status`, `statistics`, `trials[]`, `snapshots[]`
- **HTML format:** Dashboard with stats bar, equity curve, and scrollable trial table

**Poll loop:** Call every 3–5 seconds until `status === "completed"`.

#### `simulate_trade`
One-shot historical price lookup for specific OCC option symbols.
- **Params:** `underlying`, `legs[]` (OCC symbols), `startTime` (ISO 8601), `endTime` (ISO 8601)
- **Returns:** Array of `{ dateTime, price, effect, underlyingPrice, delta }`

#### `analyze_earnings_backtest`
Compare near-earnings trial performance vs. baseline. Requires a completed backtest.
- **Params:** `symbol`, `backtestId`, `daysBeforeMin` (default 10), `daysBeforeMax` (default 21), `earningsLimit` (default 20)
- **Returns:** `filteredStats`, `baselineStats`, `earningsDatesUsed`, `matchedTrials[]`

#### `analyze_zone_backtest`
Test a trade at every historical touch of a supply/demand price zone.
- **Params:** `symbol`, `zonePrice`, `zoneTolerance` (default 0.005 = ±0.5%), `direction` ("long"/"short"), `legs[]` (OCC symbols), `lookbackDays` (default 504), `holdingPeriodDays`
- **Returns:** `winRate`, `avgPnL`, `expectancy`, per-touch `touches[]`

---

## MCP Resources

Resources are read-only data endpoints that return live data without consuming tool call budget.

| URI | Description |
|-----|-------------|
| `mcp://accounts/{account_id}/balances` | Current account balances (cash, equity, buying power) |
| `mcp://accounts/{account_id}/positions` | All open positions for an account |
| `mcp://watchlists` | All personal watchlists |
| `mcp://watchlists/public` | All TastyTrade public watchlists |
| `mcp://watchlists/{name}` | A specific personal watchlist by name |
| `skill://tastytrade` | This skill guide (full markdown) |
| `skill://tastytrade/overview` | Same as above (alternate URI) |

**Example:** Read balances resource with `account_id = 5WX12345` → `mcp://accounts/5WX12345/balances`

---

## Order Placement Protocol

**Always follow this three-step protocol to avoid unintended trades:**

### Step 1 — Dry Run
- **Single-leg simple orders** (Limit, Market, Stop, Stop Limit, Notional Market): call `order_dry_run`
- **Multi-leg complex orders** (spreads, straddles, condors, calendars, Net Debit / Net Credit): call `complex_order_dry_run`
- **Replacement orders**: call `replacement_order_dry_run`

Review:
- `fees` — commissions and exchange fees
- `buying-power-effect` — BP change on fill (negative = increases BP usage)
- `warnings[]` — any compliance or risk warnings
- `estimated-fill-price` — expected execution price

### Step 2 — Review
Confirm the numbers make sense:
- Is the credit/debit what you expected?
- Is the BP effect acceptable relative to account net liq?
- Are there any warnings that require acknowledgment?

### Step 3 — Submit
Call `create_order` (single-leg), `create_complex_order` (multi-leg), or `replace_order` (replacement) with identical parameters.

**Time-in-force options:**
- `Day` — expires at market close
- `GTC` — good till cancelled
- `GTD` — good till a specific date
- `IOC` — immediate or cancel
- `Ext` / `GTC Ext` — extended hours

**Order types:**
- `Limit` — specify exact price (most common for options)
- `Market` — fill at best available price (avoid for options)
- `Stop` / `Stop Limit` — triggered orders
- `Notional Market` — for equities by dollar amount

**Price effect:**
- `Credit` — you receive premium (selling options, spreads)
- `Debit` — you pay premium (buying options)

---

## Strategy Playbooks

### Sell a Cash-Secured Put

**Goal:** Collect premium on a put; willing to buy 100 shares at strike if assigned.

**Steps:**

1. Get account info and confirm sufficient cash buying power.
```json
{ "detail": "account_status", "accountNumber": "5WX12345" }
```

2. Look up the option chain to find a suitable strike (~30 delta, 30–45 DTE).
```json
{ "type": "nested_option_chain", "symbol": "AAPL" }
```

3. Get Greeks to confirm the delta of your chosen put.
```json
{ "optionSymbols": [".AAPL250117P00180000"], "detail": "standard" }
```

4. Dry-run the order.
```json
{
  "accountNumber": "5WX12345",
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 2.35,
  "price-effect": "Credit",
  "legs": [{
    "instrument-type": "Equity Option",
    "symbol": "AAPL  250117P00180000",
    "action": "Sell to Open",
    "quantity": 1
  }]
}
```

5. Review fees and BP impact from dry-run, then submit with `create_order`.

---

### Credit Spread

**Goal:** Define-risk version of selling a put/call vertical spread.

**Bull Put Spread (sell higher put, buy lower put):**

1. Identify strikes: sell the ~30-delta put, buy a put ~5–10 points lower.
2. Dry-run as complex order with two legs.
```json
{
  "accountNumber": "5WX12345",
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 1.50,
  "price-effect": "Credit",
  "legs": [
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY   250117P00480000",
      "action": "Sell to Open",
      "quantity": 1
    },
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY   250117P00475000",
      "action": "Buy to Open",
      "quantity": 1
    }
  ]
}
```
3. Review dry-run, then `create_complex_order` with same params.

**Bear Call Spread:** Mirror structure with calls. Sell the ~30-delta call, buy a call higher.

---

### VRP Strangle

**Goal:** Capture volatility risk premium by selling both a 16-delta put and 16-delta call at ~45 DTE.

**Steps:**

1. Check IV rank to confirm elevated implied volatility (IV rank > 25 preferred).
```json
{ "symbols": ["SPY"], "detail": "summary" }
```

2. Get nested option chain for the ~45 DTE expiry.
```json
{ "type": "nested_option_chain", "symbol": "SPY" }
```

3. Find 16-delta put and call strikes; fetch Greeks to confirm.
```json
{ "optionSymbols": [".SPY250117P0475", ".SPY250117C0530"], "detail": "summary" }
```

4. Dry-run the strangle.
```json
{
  "accountNumber": "5WX12345",
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 4.20,
  "price-effect": "Credit",
  "legs": [
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY   250117P00475000",
      "action": "Sell to Open",
      "quantity": 1
    },
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY   250117C00530000",
      "action": "Sell to Open",
      "quantity": 1
    }
  ]
}
```

5. Review: check BP usage. A strangle on SPY typically requires $3,000–$6,000 BP. Ensure this is ≤5% of net liq.

6. Submit with `create_complex_order`.

---

### 0DTE Iron Condor

**Goal:** Collect small premium from a tight range on expiry day.

**Steps:**

1. Confirm it is expiration day for the chosen symbol (e.g., SPX Monday/Wednesday/Friday).

2. Get market metrics to check IV.
```json
{ "symbols": ["SPX"], "detail": "summary" }
```

3. Get compact option chain for today's expiry.
```json
{ "type": "compact_option_chain", "symbol": "SPX" }
```

4. Pick strikes ~10–15 delta put side and call side; buy wings ~25 points away.

5. Dry-run 4-leg iron condor.
```json
{
  "accountNumber": "5WX12345",
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 0.75,
  "price-effect": "Credit",
  "legs": [
    { "instrument-type": "Equity Option", "symbol": "SPX   250117P04850000", "action": "Buy to Open", "quantity": 1 },
    { "instrument-type": "Equity Option", "symbol": "SPX   250117P04875000", "action": "Sell to Open", "quantity": 1 },
    { "instrument-type": "Equity Option", "symbol": "SPX   250117C05125000", "action": "Sell to Open", "quantity": 1 },
    { "instrument-type": "Equity Option", "symbol": "SPX   250117C05150000", "action": "Buy to Open", "quantity": 1 }
  ]
}
```

6. Submit with `create_complex_order`.

---

### Roll a Losing Leg

**Goal:** Move a tested strike to a new expiry or farther OTM.

**Steps:**

1. Query live orders and positions.
```json
{ "scope": "account_live", "accountNumber": "5WX12345" }
```

2. Identify the tested leg's order ID.

3. Dry-run the replacement order.
```json
{
  "accountNumber": "5WX12345",
  "orderId": 12345678,
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 0.50,
  "price-effect": "Credit",
  "legs": [
    { "instrument-type": "Equity Option", "symbol": "SPY   250117P00480000", "action": "Buy to Close", "quantity": 1 },
    { "instrument-type": "Equity Option", "symbol": "SPY   250221P00465000", "action": "Sell to Open", "quantity": 1 }
  ]
}
```

4. Review, then use `replace_order` to execute atomically.

---

### Close a Position at 50% Profit

**Goal:** Buy back a short option at 50% of original credit (standard profit-taking rule).

**Steps:**

1. Get positions to find the current mark value.
```json
{ "accountNumber": "5WX12345", "underlyingSymbol": "SPY", "detail": "standard" }
```

2. If mark ≈ 50% of original credit, place closing order.
```json
{
  "accountNumber": "5WX12345",
  "time-in-force": "GTC",
  "order-type": "Limit",
  "price": 1.25,
  "price-effect": "Debit",
  "legs": [{
    "instrument-type": "Equity Option",
    "symbol": "SPY   250117P00475000",
    "action": "Buy to Close",
    "quantity": 1
  }]
}
```

3. Dry-run, review, submit.

---

## Backtesting Playbooks

### VRP Strangle Backtest

**Goal:** Backtest selling 16-delta strangles at 45 DTE on SPY over 5 years.

**Step 1 — Submit backtest:**
```json
{
  "symbol": "SPY",
  "startDate": "2019-01-01",
  "endDate": "2024-01-01",
  "legs": [
    {
      "type": "equity-option",
      "direction": "short",
      "side": "put",
      "quantity": 1,
      "daysUntilExpiration": 45,
      "strikeSelection": "delta",
      "delta": 16
    },
    {
      "type": "equity-option",
      "direction": "short",
      "side": "call",
      "quantity": 1,
      "daysUntilExpiration": 45,
      "strikeSelection": "delta",
      "delta": 16
    }
  ],
  "entryConditions": {
    "frequency": "every day",
    "maximumActiveTrials": 1
  },
  "exitConditions": {
    "takeProfitPercentage": 50,
    "atDaysToExpiration": 21
  }
}
```

**Step 2 — Poll for results (repeat until `status === "completed"`):**
```json
{ "backtestId": "<id-from-step-1>" }
```

**Step 3 — Interpret:** See [Reading Backtest Output](#reading-backtest-output).

---

### 0DTE Iron Condor Backtest

**Goal:** Backtest selling a tight iron condor on SPY with same-day expiry.

```json
{
  "symbol": "SPY",
  "startDate": "2022-01-01",
  "endDate": "2024-01-01",
  "legs": [
    {
      "type": "equity-option",
      "direction": "long",
      "side": "put",
      "quantity": 1,
      "daysUntilExpiration": 0,
      "strikeSelection": "delta",
      "delta": 5
    },
    {
      "type": "equity-option",
      "direction": "short",
      "side": "put",
      "quantity": 1,
      "daysUntilExpiration": 0,
      "strikeSelection": "delta",
      "delta": 10
    },
    {
      "type": "equity-option",
      "direction": "short",
      "side": "call",
      "quantity": 1,
      "daysUntilExpiration": 0,
      "strikeSelection": "delta",
      "delta": 10
    },
    {
      "type": "equity-option",
      "direction": "long",
      "side": "call",
      "quantity": 1,
      "daysUntilExpiration": 0,
      "strikeSelection": "delta",
      "delta": 5
    }
  ],
  "entryConditions": {
    "frequency": "every day",
    "maximumActiveTrials": 1
  },
  "exitConditions": {
    "takeProfitPercentage": 50
  }
}
```

---

### strikeSelection Methods

Every leg requires exactly one `strikeSelection` method plus its associated parameter(s).

#### 1. `delta`
Select a strike by its absolute delta value (1–100).

```json
{ "strikeSelection": "delta", "delta": 16 }
```
> Selects the strike closest to 16 delta. Use for standard premium-selling strategies.

#### 2. `percentageOTM`
Select a strike by percentage out-of-the-money.

```json
{ "strikeSelection": "percentageOTM", "percentageOTM": 0.05 }
```
> 0.05 = 5% OTM. Always positive; the backtester infers put vs. call from the `side` field.

#### 3. `percentageOTMRelative`
Select a strike by percentage OTM relative to another leg's strike.

```json
{
  "strikeSelection": "percentageOTMRelative",
  "percentageOTMRelative": 0.02,
  "strikeRelativeLeg": 0
}
```
> Useful for wings of a spread: set the short leg as leg 0, then define the long leg 2% further OTM relative to it.

#### 4. `currentPriceOffset`
Select a strike by a fixed dollar offset from the current underlying price.

```json
{ "strikeSelection": "currentPriceOffset", "currentPriceOffset": -20 }
```
> Negative value = below current price (put side). Positive = above (call side).

#### 5. `currentPriceOffsetRelative`
Select a strike by dollar offset relative to another leg.

```json
{
  "strikeSelection": "currentPriceOffsetRelative",
  "currentPriceOffsetRelative": -10,
  "strikeRelativeLeg": 0
}
```
> E.g., place the long put $10 below the short put (leg 0).

#### 6. `currentPriceExactOffsetRelative`
Select a strike at an exact price offset from another leg. Use 0 to match the same strike (useful for calendars).

```json
{
  "strikeSelection": "currentPriceExactOffsetRelative",
  "currentPriceExactOffsetRelative": 0,
  "strikeRelativeLeg": 0
}
```

#### 7. `premium`
Select the strike that yields a target credit in dollars.

```json
{ "strikeSelection": "premium", "premium": 1.50 }
```
> Selects the strike whose option premium is closest to $1.50.

---

### entryConditions Field Guide

| Field | Type | Description |
|-------|------|-------------|
| `frequency` | string (required) | `"every day"`, `"on specific days of the week"`, `"on exact days to expiration match"` |
| `specificDays` | number[] | For `"on specific days of the week"`: day indices (0=Sun … 6=Sat). For `"on exact days to expiration match"`: specific DTE values. |
| `maximumActiveTrials` | number | Max concurrent open positions (e.g., 1 = no overlapping trades) |
| `maximumActiveTrialsBehavior` | string | `"don't enter"` (skip new entry) or `"close oldest"` (close oldest trial first) |
| `minimumVIX` | number | Only enter if VIX is at or above this level |
| `maximumVIX` | number | Only enter if VIX is at or below this level |

**Example — enter only on high-VIX days (Mondays only, VIX > 18):**
```json
{
  "frequency": "on specific days of the week",
  "specificDays": [1],
  "maximumActiveTrials": 1,
  "maximumActiveTrialsBehavior": "don't enter",
  "minimumVIX": 18
}
```

---

### exitConditions Field Guide

| Field | Type | Description |
|-------|------|-------------|
| `takeProfitPercentage` | number | Close when P&L reaches this % of max profit (e.g., 50 = 50% profit target) |
| `stopLossPercentage` | number | Close when loss reaches this % of max loss (e.g., 200 = 2× the credit received) |
| `atDaysToExpiration` | number | Close when DTE reaches this value (e.g., 21 = close at 21 DTE) |
| `afterDaysInTrade` | number | Close after this many calendar days regardless of DTE |
| `minimumVIX` | number | Close when VIX drops below this level |

**Example — 50% profit target, 200% stop, close at 21 DTE:**
```json
{
  "takeProfitPercentage": 50,
  "stopLossPercentage": 200,
  "atDaysToExpiration": 21
}
```

---

### Earnings-Aware Backtesting

Compare performance of trades entered near earnings vs. baseline.

**Step 1 — Run a standard backtest** (see VRP Strangle Backtest above). Save the `backtestId`.

**Step 2 — Analyze near-earnings trials:**
```json
{
  "symbol": "AAPL",
  "backtestId": "abc-123",
  "daysBeforeMin": 7,
  "daysBeforeMax": 21,
  "earningsLimit": 20
}
```

**Interpreting output:**
- `filteredStats.winRate` — win rate for trials opened near earnings
- `baselineStats.winRate` — win rate for all trials
- Compare `avgPnL` to assess earnings premium drag/boost
- Low trial count in `filteredStats` means limited sample — treat cautiously

---

### Supply & Demand Zone Backtesting

Test whether a trade at a historical support/resistance zone has edge.

```json
{
  "symbol": "SPY",
  "zonePrice": 480.00,
  "zoneTolerance": 0.005,
  "direction": "long",
  "legs": [
    { "symbol": "SPY   250117C00480000" }
  ],
  "lookbackDays": 504,
  "holdingPeriodDays": 5
}
```

**Interpreting output:**
- `touchCount` — how many times price entered the zone
- `winRate` — fraction of touches that produced positive P&L
- `avgPnL` — average dollar result per touch
- `expectancy` = `winRate × avgWin − (1 − winRate) × avgLoss`
- A positive expectancy with ≥ 10 touches suggests a real edge. Below 10 touches: insufficient data.

---

### simulate_trade (One-Shot Lookup)

Get historical prices for specific OCC option symbols at a specific time.

```json
{
  "underlying": "SPY",
  "startTime": "2024-01-15T09:30:00Z",
  "endTime": "2024-01-15T16:00:00Z",
  "legs": [
    { "symbol": "SPY   240119P00470000" }
  ]
}
```

**Returns array of:**
```json
{
  "dateTime": "2024-01-15T09:30:00Z",
  "price": 2.35,
  "effect": "credit",
  "underlyingPrice": 474.21,
  "delta": -0.22
}
```

Use this for one-off historical research without running a full backtest.

---

### Reading Backtest Output

A completed `get_backtest_results` response has this shape:

```json
{
  "status": "completed",
  "statistics": {
    "totalTrades": 245,
    "winRate": 0.72,
    "averageProfitLoss": 143.50,
    "totalProfitLoss": 35157.50,
    "maxDrawdown": -4200.00,
    "sharpeRatio": 1.42
  },
  "trials": [
    { "openDateTime": "2019-01-07T14:30:00Z", "closeDateTime": "2019-02-28T21:00:00Z", "profitLoss": 310.00 },
    ...
  ],
  "snapshots": [
    { "dateTime": "2019-01-07T14:30:00Z", "cumulativeProfitLoss": 310.00, "underlyingPrice": 258.34 },
    ...
  ]
}
```

**Key statistics:**

| Field | Meaning | Good Values |
|-------|---------|-------------|
| `winRate` | % of trades closed profitably | 65–80% for premium selling |
| `sharpeRatio` | Risk-adjusted return (annual) | > 1.0 acceptable, > 1.5 good |
| `maxDrawdown` | Largest peak-to-trough equity loss | ≤ 15% of starting capital |
| `averageProfitLoss` | Mean P&L per trade | Positive; compare vs. BP used |
| `totalProfitLoss` | Cumulative P&L over the period | Overall profitability check |

**`trials[]`** — one entry per trade. Use to spot outliers, worst losses, clustered losses.

**`snapshots[]`** — equity curve. Use `format: "html"` to render a visual chart.

---

### Interpreting Results Before Going Live

**Minimum trial count:** Require at least 30 completed trials before drawing conclusions. Fewer trials produce statistically unreliable win rates (confidence interval too wide).

**Edge detection checklist:**
- [ ] `winRate` is consistent across different sub-periods (not just driven by one lucky year)
- [ ] `sharpeRatio > 1.0` annualized
- [ ] `maxDrawdown` is acceptable given account size
- [ ] Win rate holds across different VIX regimes (use `minimumVIX`/`maximumVIX` entry conditions to test sub-samples)
- [ ] `averageProfitLoss` is positive after realistic slippage (~$5–$15 per contract)

**Avoiding over-fit parameters:**
- Don't cherry-pick `delta`, `daysUntilExpiration`, or `takeProfitPercentage` after looking at the results
- Run the backtest with your intended parameters first, then evaluate — not the other way around
- Validate on a holdout period (e.g., test 2019–2022, evaluate on 2023–2024)
- Small changes in parameters (e.g., 45 DTE → 42 DTE) should not dramatically change results; fragility suggests over-fit

**Sizing from backtest:** Use `maxDrawdown` to size positions. If backtest `maxDrawdown` = −$4,200 on 1 contract, and you want to risk ≤ 5% of net liq ($50,000 account = $2,500 risk), start with ~0.5 contracts and scale up as live performance confirms the edge.

---

## Risk Management

**Before entering any position:**

1. `get_margin_requirements` — check current BP usage
2. `estimate_margin_requirements` — estimate new position's BP cost
3. `get_net_liq_value` — confirm current account size
4. Ensure new position's BP ≤ 5% of net liq (see Account Growth Guidelines)

**Position monitoring:**
- `get_positions` with `underlyingSymbol` filter — check specific underlying exposure
- `get_net_liq_history` with `format: "html"` — visual equity curve for trend check
- `get_market_metrics` — check if IV rank has changed significantly (high IV rank = sell, low = avoid selling)

**Stop-loss rules:**
- Undefined-risk positions (strangles, naked puts): close at 2× credit received
- Defined-risk spreads: close at 2× credit received or at 50% of max loss

**Greeks monitoring:**
- Delta exposure > 0.30 on short puts: consider rolling or hedging
- Theta decay target: daily theta should be ~0.1% of net liq at minimum

---

## Account Growth Guidelines

### Target Premium Collection
- Sell enough premium so daily theta is ≈ 0.1–0.3% of net liq
- Example: $50,000 account → target $50–$150/day in theta decay

### Buying Power Efficiency (BPE)
- BPE = premium collected ÷ BP used
- Target BPE ≥ 10–15% annualized
- Allocate no more than 50% of available BP at any time
- Individual positions: ≤ 5% of net liq in BP usage each

### Take Profits
- **Standard rule:** close at 50% of max profit (cuts time in trade, frees capital, reduces gamma risk near expiry)
- **Aggressive rule:** close at 25% profit (lower per-trade returns but higher win rate and shorter hold time)
- Never let short options expire; close or roll at 5–7 DTE at the latest

### Take Losses
- **Defined risk:** close at 50% of max loss (e.g., spread max loss = $500, close at −$250)
- **Undefined risk:** close at 2× credit received
- **Roll rule:** if tested leg is ≥ 0.50 delta, roll out in time to collect additional credit

### Using Backtests to Size Positions
1. Run backtest → note `maxDrawdown` per contract
2. Divide acceptable risk (e.g., 5% of net liq) by per-contract max drawdown
3. That gives initial position size in contracts
4. Start at 50% of that size for the first 30 live trades; scale up if live results match backtest

---

## HTML Artifact Guide

Several tools return visual HTML artifacts when `format: "html"` is specified. These render as interactive dashboards in the chat UI.

### Tools That Accept `format: "html"`

| Tool | Artifact Type | Description |
|------|---------------|-------------|
| `get_positions` | Positions table | Color-coded P&L table with unrealized gain/loss highlighting |
| `get_market_metrics` | IV gauge cards | One card per symbol with IV rank gauge, IV percentile, and trend indicators |
| `get_options_greeks` | Greeks card | Delta, gamma, theta, vega, rho with visual delta indicator |
| `get_net_liq_history` | Equity SVG chart | SVG line chart with area fill and min/max annotations |
| `get_backtest_results` | Backtest dashboard | Stats bar + equity curve + scrollable trial table |

### When to Request HTML vs. JSON

**Use `format: "html"` when:**
- Presenting data to the user for review before acting
- The user asks to "show" or "visualize" data
- Multiple symbols need side-by-side comparison (IV metrics, Greeks)
- Reviewing backtest results for go/no-go decision

**Use JSON (default) when:**
- Extracting specific values for a follow-up tool call
- Programmatically comparing data across multiple calls
- The data will be used in a calculation

### Backtest HTML Dashboard Contents
When `get_backtest_results` is called with `format: "html"`, the artifact includes:
- **Stats bar:** total trades, win rate, avg P&L, total P&L, max drawdown, Sharpe ratio
- **Equity curve:** SVG line chart of cumulative P&L over time
- **Trial table:** scrollable table with open date, close date, P&L, and win/loss indicator for every trade
