# Tastytrade MCP Tool Reference

Complete reference for all available tastytrade MCP tools with key parameters and usage notes.

---

## Authentication

### `check_auth_status`
Check if client is authenticated; auto-reconnects if session expired.
- **Call first** at the start of every session and before any order
- Returns: auth status, session info

### `disconnect`
Cleanly disconnect the MCP session. Call when done to release resources.

---

## Account & Customer

### `get_account_info(detail, accountNumber?)`
Consolidated account and customer lookup. The `detail` enum selects the operation:
- `detail="customer_accounts"` — list all accounts; returns `account-number`, `account-type`, `nickname`. **Use this first to get `accountNumber`.**
- `detail="customer_resource"` — full customer profile (name, email, customer number). No `accountNumber` needed.
- `detail="full_account"` + `accountNumber` — full account details: trading level, margin type, agreements.
- `detail="account_status"` + `accountNumber` — trading status and permissions; check for PDT flag or restrictions.

---

## Balances & Portfolio

### `get_account_balances(accountNumber)`
**Key fields:**
- `net-liquidating-value` — total portfolio value
- `equity-buying-power` — available for equity trades
- `derivative-buying-power` — available for options
- `cash-balance`
- `maintenance-requirement` — current margin usage

### `get_balance_snapshots(accountNumber, startDate?, endDate?)`
Historical balance snapshots. Use for equity curve analysis.
- Feed into `scripts/equity_curve.py`

### `get_net_liq_value(accountNumber)`
Current net liquidating value snapshot.

### `get_net_liq_history(accountNumber, startDate?, endDate?)`
Historical net liq. Ideal input for `scripts/equity_curve.py`.

### `get_margin_requirements(accountNumber)`
Full margin report — all positions and their margin usage.

### `get_effective_margin_requirements(accountNumber, underlying)`
Margin requirements specifically for a given underlying symbol.

---

## Positions

### `get_positions(accountNumber, symbol?)`
All open positions. Filter by `symbol` to narrow.
- **Key fields per position**: `symbol`, `instrument-type`, `quantity`, `quantity-direction` (Long/Short), `average-open-price`, `close-price`, `unrealized-day-gain-effect`
- Always check before recommending a new trade

### `get_position_limit(accountNumber)`
Maximum position size limits for the account.

---

## Orders

### `create_order(accountNumber, orderJson)`
Submit a single-leg order. See `order-execution.md` for JSON templates.
- Always run `order_dry_run` first

### `create_complex_order(accountNumber, orderJson)`
Submit multi-leg orders: spreads, straddles, condors, OCO, OTOCO.
- Use for any order with 2+ legs or conditional triggers

### `order_dry_run(accountNumber, orderJson)`
**Validate without placing.** Returns:
- `buying-power-effect`
- `fee-calculation`
- Warnings, errors, or margin calls
- **MANDATORY before every real order**

### `query_orders(scope, accountNumber?, orderId?, customerId?, status?, perPage?, pageOffset?)`
Consolidated order query. The `scope` enum selects the operation:
- `scope="account_live"` + `accountNumber` — all currently active/pending orders for the account. **Check before entering any new position.**
- `scope="account_history"` + `accountNumber` — paginated order history. Filter with `status` (`"Filled"`, `"Cancelled"`, `"Live"`, `"Received"`, `"Rejected"`).
- `scope="account_single"` + `accountNumber` + `orderId` — single order by ID. Use to confirm fill status after submitting. Status flow: `Received` → `Routed` → `Filled` / `Cancelled` / `Expired`.
- `scope="customer_live"` + `customerId` — live orders across ALL accounts (cross-account view).
- `scope="customer_history"` + `customerId` — paginated order history across all accounts.

### `edit_order(accountNumber, orderId, editJson)`
Change price or time-in-force on a live order (non-destructive).
- editJson: `{"price": 1.75}` or `{"time-in-force": "GTC"}`

### `replace_order(accountNumber, orderId, replacementOrderJson)`
Cancel existing order and submit a new one atomically.

### `replacement_order_dry_run(accountNumber, orderId, replacementOrderJson)`
Dry run for a replacement order — validates before committing.

### `cancel_order(accountNumber, orderId)`
Cancel a single-leg live order.

### `cancel_complex_order(accountNumber, orderId)`
Cancel a multi-leg or OCO/OTOCO order.

### `reconfirm_order(accountNumber, orderId)`
Reconfirm an order that requires acknowledgment (e.g., after a margin warning).

### `estimate_margin_requirements(accountNumber, orderJson)`
Estimate margin impact of a prospective order (alternative to dry_run for margin focus).

---

## Market Data

### `get_quote(symbols[], timeoutMs=5000, detail="standard")`
Real-time quotes for one or more symbols via DXLink.
- **Returns**: bid, ask, last, and more depending on `detail` tier
- `detail`: `"summary"` (bid, ask, last, symbol), `"standard"` (common fields, default), `"full"` (raw DXLink event)
- Supports equities, options, futures, crypto

### `get_candles(symbol, periodMinutes=5, daysBack=1, timeoutMs=8000, limit=100, detail="standard")`
OHLCV candlestick data via DXLink.
- `periodMinutes`: candle period (e.g. 1, 5, 15, 30, 60, 1440 for daily) — **NOT a `width` string**
- `daysBack`: how many calendar days of history to fetch
- `limit`: max candles to return (default 100, most-recent kept; 0 = no limit)
- `detail`: `"summary"` (6 OHLC fields), `"standard"` (OHLCV+vwap, default), `"full"` (raw payload)

### `get_market_metrics(symbols[], detail="standard")`
**Essential for strategy selection.** Returns per symbol:
- `detail="summary"`: symbol, IV rank, IV percentile only
- `detail="standard"` (default): IV index, IVR, IV percentile, 30/60/90d IV, liquidity-rank, lendability
- `detail="full"`: complete API payload including `dividend-next-date`, `earnings-next-date`, `option-expiration-implied-volatilities`
- Use `detail="full"` when you need earnings dates or term structure data

### `get_options_greeks(optionSymbols[], timeoutMs=5000, detail="standard")`
Greeks for specific option symbols via DXLink.
- **Pass streamer symbols** (`call-streamer-symbol` / `put-streamer-symbol` from chain endpoints) — NOT OCC symbols
- `detail`: `"summary"` (symbol + delta/gamma/theta/vega/rho), `"standard"` (Greeks + IV + underlying price, default), `"full"` (raw DXLink event)
- More targeted than pulling a full chain — use when you know the specific strikes

### `get_api_quote_token()`
Get DXLink authentication token for real-time streaming quotes.

---

## Instruments (all via `get_instrument`)

All instrument lookups are consolidated into a single `get_instrument(type, ...)` tool. The `type` enum selects the operation; other params apply conditionally.

### Option Chains

#### `get_instrument(type="option_chain", symbol, limit=50, detail="standard")`
Full option chain — all strikes and expiries. **LARGE — use `limit` and `detail` to reduce payload, then pipe to filter_chain.py for further filtering.**
- `detail`: `"summary"` (5 fields), `"standard"` (common trading fields, default), `"full"` (raw payload)
- `limit`: max option records to return (default 50, set to 0 for no limit)

#### `get_instrument(type="compact_option_chain", symbol)`
**WARNING: Does NOT return option objects with strike/delta/bid/ask fields.**
Returns a list of expiration-type groups (Weekly, Monthly, LEAPS), each containing:
- `symbols` — array of raw OCC symbol strings (e.g., `"AAPL  240119C00150000"`)
- `streamer-symbols` — array of DXLink symbols (e.g., `".AAPL240119C150"`)
- No bid/ask/delta/IV data is included.

**To use:** parse expiry and strike from OCC format, then call `get_options_greeks` (passing streamer symbols) for Greeks/IV/prices:
```python
import re, json
chain = json.loads(response[0]['text'])
all_symbols = []
for group in chain:
    all_symbols.extend(group.get('symbols', []))

def parse_occ(sym):
    m = re.match(r'^(\S+)\s+(\d{6})([CP])(\d{8})$', sym.strip())
    if not m: return None
    ticker, date, opt_type, strike_raw = m.groups()
    return {'symbol': sym.strip(), 'expiry': f"20{date[:2]}-{date[2:4]}-{date[4:]}",
            'type': opt_type, 'strike': int(strike_raw) / 1000}

parsed = [p for sym in all_symbols if (p := parse_occ(sym))]
# Then: get_options_greeks(optionSymbols=[p['symbol'] for p in target_parsed])
```

#### `get_instrument(type="nested_option_chain", symbol)`
Chain nested by expiry → strike. Best for term structure work. **Very large — always save to file first.**

### Equity Instruments

#### `get_instrument(type="equity", symbol)`
Single equity definition.

#### `get_instrument(type="equity_definitions", symbols[]?, lendability?)`
Equity definitions with optional filtering by symbols or lendability (`"Easy To Borrow"`, `"Locate Required"`, `"Preborrow"`).

#### `get_instrument(type="active_equities", perPage?, pageOffset?)`
All active equities — paginated. **Never print raw — very large.**

#### `get_instrument(type="equity_option", symbol)`
Single equity option instrument definition. Use to validate OCC symbol format.

#### `get_instrument(type="equity_options", symbols[], active=true, withExpired=false)`
Option instrument definitions for given symbols (not live prices).

### Futures

#### `get_instrument(type="futures", symbols[]?, productCode?)`
Futures instrument definitions (not live prices — use `get_quote` for prices).

#### `get_instrument(type="future", symbol)`
Single futures contract by symbol (e.g., `/ESM4`).

#### `get_instrument(type="futures_products")`
All supported futures products with metadata (tick size, multiplier, trading hours).

#### `get_instrument(type="future_product", exchange, code)`
Specific futures product details.

### Futures Options

#### `get_instrument(type="future_option_chain", symbol)`
Futures option chain. Large — pipe to filter_chain.py.

#### `get_instrument(type="nested_future_option_chain", symbol)`
Nested futures option chain by expiry. Very large — save to file.

#### `get_instrument(type="future_options", symbols[]?)`
Futures option instrument definitions.

#### `get_instrument(type="future_option", symbol)`
Single futures option definition.

#### `get_instrument(type="future_option_products")`
All futures options products.

#### `get_instrument(type="future_option_product", exchange, rootSymbol)`
Specific futures option product.

### Crypto, Warrants, Other

#### `get_instrument(type="cryptocurrencies", symbols[]?)`
Crypto instrument definitions (BTC/USD, ETH/USD, etc.).

#### `get_instrument(type="cryptocurrency", symbol)`
Single crypto instrument. Note: Crypto orders use `IOC` time-in-force only.

#### `get_instrument(type="warrants", symbols[]?)` / `get_instrument(type="warrant", symbol)`
Warrant instrument definitions.

#### `get_instrument(type="quantity_decimal_precisions")`
Decimal precision rules for all instrument types (important for fractional shares / crypto).

### Symbol Search

#### `search_symbols(query)`
Search for tradeable symbols by name or keyword. *(This remains a standalone tool.)*

---

## Watchlists

### `manage_watchlist(action, watchlistName?, watchlistEntries?)`
Manage personal watchlists.
- `action="get"` — get a specific watchlist by name (requires `watchlistName`)
- `action="create"` — create new watchlist (requires `watchlistName` + `watchlistEntries`)
- `action="replace"` — replace all entries (requires `watchlistName` + `watchlistEntries`)
- `action="delete"` — delete watchlist (requires `watchlistName`)
- `watchlistEntries`: array of `{symbol, "instrument-type"}` objects
- To list all personal watchlists, use the `mcp://watchlists` resource instead of this tool.

### `manage_public_watchlist(action, watchlistName?, countsOnly?)`
Access tastytrade-curated public and pairs watchlists.
- `action="list_public"` — all public watchlists (optional `countsOnly=true` for counts only)
- `action="get_public"` — specific public watchlist by name (requires `watchlistName`)
- `action="list_pairs"` — all pairs watchlists
- `action="get_pairs"` — specific pairs watchlist by name (requires `watchlistName`)

---

## Historical Data

### `get_historical_earnings(symbol, startDate?, limit=10)`
Past earnings dates and expected/actual moves.
- `limit`: max records to return (default 10; set to 0 for no limit)
- Check before entering any position — verify no earnings within the trade's lifespan

### `get_historical_dividends(symbol, limit=10)`
Dividend history and dates.
- `limit`: max records to return (default 10; set to 0 for no limit)

### `get_transactions(accountNumber, startDate?, endDate?, type?, pageOffset?)`
Account transaction history (fills, fees, dividends, expirations).
- Pipe to `scripts/pnl_analytics.py` for analysis — never print raw

### `get_transaction(accountNumber, transactionId)`
Single transaction detail.

### `get_total_fees(accountNumber)`
Total fees charged today.

---

## Instruments

See the **Instruments (all via `get_instrument`)** section above. All instrument lookups use the consolidated `get_instrument(type, ...)` tool.

### `search_symbols(query)`
Search for tradeable symbols by name or keyword. *(Standalone tool — not part of `get_instrument`.)*

---

## Common Pitfalls

1. **Forgetting accountNumber**: Most order and balance calls need it — always `get_customer_accounts` first
2. **Wrong price sign**: Debit = negative, credit = positive for the `price` field
3. **Wrong action for futures**: Futures use `"Buy"` / `"Sell"`, NOT `"Buy to Open"` / `"Sell to Close"`
4. **Option chain without filtering**: Always use `limit` and `detail` params, then pipe to `filter_chain.py` — raw output will overflow context
5. **Skipping dry run**: `order_dry_run` is mandatory — catches bad order JSON before it costs real money
6. **Missing earnings check**: Always check `earnings-next-date` from `get_market_metrics` (use `detail="full"`) before entering
7. **Crypto time-in-force**: Crypto must use `IOC` — other values will be rejected
8. **Compact chain has no Greeks/prices**: `get_instrument(type="compact_option_chain")` only returns OCC symbol strings. Use `get_options_greeks(optionSymbols=[...])` to get delta/IV/bid/ask for specific strikes. Never try to access `o['delta']` or `o['strike-price']` on items from the compact chain response.
9. **Wrong symbols for `get_options_greeks`**: Pass **streamer symbols** (e.g. `".AAPL240119C150"` from `call-streamer-symbol`/`put-streamer-symbol`), not OCC symbols. Mixing these up returns no data.
10. **Wrong candle params**: `get_candles` uses `periodMinutes` (integer minutes) and `daysBack` — there is no `width` string or `startDate`/`endDate`. Use `periodMinutes=1440` for daily bars.
11. **Individual instrument/watchlist tools no longer exist**: All instrument lookups use `get_instrument(type=...)`. Watchlist management uses `manage_watchlist` and `manage_public_watchlist`.
12. **Individual account/order query tools no longer exist**: `get_customer_accounts` → `get_account_info(detail="customer_accounts")`; `get_live_orders` → `query_orders(scope="account_live")`; `get_order` → `query_orders(scope="account_single")`; `get_customer_live_orders` → `query_orders(scope="customer_live")`.
13. **`get_market_metrics` needs `detail="full"` for Forward Factor**: The hook that computes Forward Factor and earnings dates requires the full payload. Using `detail="summary"` or `detail="standard"` will suppress term structure data and hook output will be empty.
