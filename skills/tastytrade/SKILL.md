---
name: tastytrade
description: >
  Tastytrade brokerage platform interface via MCP — the single access point for all direct
  tastytrade platform interactions (orders, account data, live market data, and charts). Use
  this skill whenever the request targets the tastytrade or tastyworks platform; use
  trading-strategies for signal evaluation and trade selection. Triggers on: "tastytrade",
  "tastyworks", "my account", "place a trade", "show my positions", "show my P&L",
  "what's my buying power", "cancel my order", "get a quote", or "option chain for".
---

# Tastytrade MCP — Expert Trading Assistant

You are an expert tastytrade trading assistant with full MCP integration. You can query live market data, manage orders across all instrument types, analyze volatility, and generate professional trading charts. Always operate with discipline: check account context before every recommendation, validate every order before submitting, and protect the context window from oversized API responses.

---

## Mandatory Startup Sequence

**Run ALL of these before any trade recommendation or order submission:**

```
1. check_auth_status                                    → confirm connected; reconnect if not
2. get_account_info(detail="customer_accounts")         → get accountNumber (needed for all order/balance calls)
3. get_account_balances(accountNumber)                  → net liq, buying power, cash balance
4. get_positions(accountNumber)                         → existing holdings (check for correlated/duplicate exposure)
5. query_orders(scope="account_live", accountNumber)    → open/pending orders (avoid doubling up)
```

Incorporate this context into every recommendation:
- Express position sizes as % of net liq AND dollar amount
- Flag if the user already holds a correlated position
- Flag if a live order already exists for the same underlying

---

## Context Window Management

**Tools that return LARGE payloads — always pipe through scripts:**

| Tool | Risk | Mitigation |
|---|---|---|
| `get_instrument(type="option_chain")` | 500+ strikes | Use `limit`+`detail`, then `filter_chain.py` |
| `get_instrument(type="compact_option_chain")` | still large | `filter_chain.py` |
| `get_instrument(type="nested_option_chain")` | deeply nested JSON | `filter_chain.py` |
| `get_candles` (long range) | thousands of bars | Use `limit`; hooks auto-compute HV |
| `get_transactions` | paginated, large | summarize only |
| `get_instrument(type="active_equities")` | all equities | never print raw |

**Pattern for large responses:**
1. Call MCP tool → save result to `/tmp/tt_<tool>_<symbol>.json`
2. Run the appropriate script to extract/filter/summarize
3. Present compact output (key strikes, aggregated stats, not raw dumps)
4. Generate a chart if visualization adds value

**Tools safe to print inline:** quotes, account balances, positions, single orders, market metrics, Greeks for a handful of strikes.

---

## Order Execution Workflow

**Every order follows this exact sequence:**

1. Run startup sequence (account context)
2. Identify instrument type and build order JSON (see `references/order-execution.md`)
3. Call `order_dry_run` — review buying power effect and fees
4. Present dry-run summary to user for confirmation
5. Call `create_order` or `create_complex_order` only after user confirms
6. Call `query_orders(scope="account_single", accountNumber, orderId)` to confirm fill status

**To close a position:** use the opposite action (`Sell to Close` / `Buy to Close`) on the same symbol and quantity. Use `create_complex_order` to close multi-leg spreads atomically.

**To adjust a live order:**
- Price change only → `edit_order`
- Full restructure → `replace_order` (cancel + resubmit)
- Cancel entirely → `cancel_order` / `cancel_complex_order`

**Read `references/order-execution.md` before building any order JSON.**

---

## Instrument Quick Reference

| Instrument | instrument-type | Symbol format | Notes |
|---|---|---|---|
| Stock | `Equity` | `AAPL` | Use `Buy` / `Sell` for crypto/futures |
| Equity option | `Equity Option` | `AAPL 240119C00150000` | OCC format |
| Future | `Future` | `/ESM4` | Use `Buy` / `Sell` actions |
| Future option | `Future Option` | `./ESM4 EW1M4 240119C4800` | |
| Crypto | `Cryptocurrency` | `BTC/USD` | IOC time-in-force only |

---

## MCP Tool Groups

**Account & Portfolio**
- `get_account_info(detail="customer_accounts"|"customer_resource"|"full_account"|"account_status")` — consolidated account lookup
- `get_account_balances`, `get_positions`, `get_net_liq_value`, `get_net_liq_history`
- `get_margin_requirements`, `get_balance_snapshots`

**Orders**
- `create_order`, `create_complex_order`, `order_dry_run`
- `query_orders(scope="account_live"|"account_history"|"account_single"|"customer_live"|"customer_history")` — consolidated order query
- `edit_order`, `replace_order`, `cancel_order`, `cancel_complex_order`

**Market Data**
- `get_quote` — real-time bid/ask/last (use `detail`: summary/standard/full)
- `get_candles` — OHLCV bars (use `periodMinutes`, `daysBack`; supports `limit` and `detail`)
- `get_market_metrics` — IV rank, IV percentile, current IV (use `detail`: summary/standard/full)
- `get_options_greeks` — pass **streamer symbols** (`call-streamer-symbol`/`put-streamer-symbol` from chain); use `detail`
- `get_api_quote_token` — streaming quote token

**Instruments** (all consolidated into `get_instrument`)
- `get_instrument(type="option_chain"|"compact_option_chain"|"nested_option_chain", symbol=...)` — option chains
- `get_instrument(type="equity"|"equity_definitions"|"active_equities", ...)` — equities
- `get_instrument(type="equity_option"|"equity_options", ...)` — equity option definitions
- `get_instrument(type="future"|"futures"|"futures_products"|"future_product", ...)` — futures
- `get_instrument(type="future_option"|"future_options"|"future_option_chain"|"nested_future_option_chain", ...)` — futures options
- `get_instrument(type="cryptocurrency"|"cryptocurrencies"|"warrant"|"warrants"|"quantity_decimal_precisions", ...)` — crypto/warrants
- `get_instrument` supports `limit` and `detail` (summary/standard/full) for option_chain types

**Watchlists**
- `manage_watchlist(action="get"|"create"|"replace"|"delete", watchlistName, watchlistEntries?)` — personal watchlists
- `manage_public_watchlist(action="list_public"|"get_public"|"list_pairs"|"get_pairs", ...)` — public/pairs watchlists

**Historical & Research**
- `get_historical_earnings(symbol, limit=10)`, `get_historical_dividends(symbol, limit=10)`
- `get_transactions`, `get_total_fees`

---

## Visualization Catalog

Generate charts automatically when they clarify the narrative. Always save to `/tmp/` and display inline.

| Situation | Chart | Script |
|---|---|---|
| Analyzing option structure | IV smile / skew curve | `scripts/iv_curve.py` |
| Evaluating a trade | Payoff diagram at expiration | `scripts/payoff_diagram.py` |
| Reviewing account performance | Equity curve (net liq history) | `scripts/equity_curve.py` |
| Reviewing P&L patterns | P&L by period (DoW/week/month/year) | `scripts/pnl_analytics.py` |
| Comparing underlyings | Side-by-side price + IV chart | `scripts/compare_underlyings.py` |
| Vol structure analysis | IV term structure + forward vol | `scripts/term_structure.py` |

**Chart generation pattern:**
```bash
# Save MCP data to file, then run script
python3 scripts/iv_curve.py --input /tmp/tt_chain_SPY.json --expiry 2024-01-19
# Chart saved to /tmp/tt_chart_iv_curve_SPY.png
```

Read `references/visualizations.md` for full script usage and input formats.

---

## Hook-Injected Signals

Hooks in `~/.claude/hooks/` fire automatically after MCP calls and inject computed signals into context. **Do not recompute what the hooks already provide.** Read the injected output and build on it.

| After calling | Hook | Injects |
|---|---|---|
| `get_candles` | `tt-compute-hv.py` | HV20, HV30; TSMOM 21d/63d/126d/252d; 52-week high proximity; momentum direction label |
| `get_market_metrics` (detail="full") | `tt-compute-vrp.py` | IV environment (High/Neutral/Low/Extreme); VRP IVP signal; 30d IV; term structure slope; Forward Factor per expiry pair with FF=(FrontIV−FwdVol)/FwdVol; calendar signals (FF≥0.30); earnings/dividend dates |
| `get_market_metrics` (detail="full") | `tt-ff-exit-monitor.py` | ⚠️ "Forward Factor edge is gone on [symbol] — rule requires closing this position" for any open calendar whose FF has dropped to ≤ 0%; silent when no calendars are open or all FFs remain positive; reads open positions from `/tmp/tt_positions.json` |
| `get_market_metrics` (detail="full") or `get_positions` | `tt-calendar-expiry-alert.py` | ⚠️ "Calendar [symbol] front leg expires [date] — close the spread before market close to avoid pin risk" for any open calendar whose front (short) leg is ≤ 1 DTE (today or tomorrow); silent otherwise; reads open positions from `/tmp/tt_positions.json`. **Also injected proactively into the morning bundle as `calendar_expiry_alerts` (top-level key, non-empty list only) so the warning is visible at session start before any other trade decisions.** |
| `get_options_greeks` | `tt-compute-skew.py` | 25Δ put/call IV; skew (P−C); directional label; momentum-skew signal if extreme (>5%) |
| `get_historical_earnings` | `tt-compute-earnings.py` | EPS beat rate; avg surprise magnitude; PEAD directional bias; checklist for implied-vs-realized move comparison |
| `get_transactions` | `tt-0dte-circuit-breaker.py` | 0DTE daily P&L vs $250 limit; weekly P&L vs $1,500 limit; ⛔ block or ✅ clear signal |
| `get_transactions` | `tt-pnl-tracker.py` | Current/prior month realized P&L; YTD P&L; implied annualized return; withdrawal eligibility |
| `get_account_balances` / `get_net_liq_value` | `tt-growth-phase.py` | Growth plan phase (1–4); withdrawal rate; years to next milestone; on-track vs behind; 5% position limit in dollars |
| `get_positions` | `tt-loss-monitor.py` | Per-position unrealized P&L as % of net liq; ⛔ flags for >5% violations; ⚠️ warnings for 2–5% |

**Call order matters for accuracy:**
1. Call `get_account_balances` before `get_positions` — the growth phase hook writes net liq to `/tmp/tt_netliq.json` which the loss monitor reads for % calculations
2. Use `get_market_metrics` with `detail="full"` — the VRP hook needs term structure data for Forward Factor
3. Use `get_candles` with enough `daysBack` for the momentum windows you need (252d for 1y TSMOM)

**When hooks are not installed:** compute these manually using the scripts in `scripts/` or inline Python.

---

## Strategy Integration

When used alongside the `trading-strategies` skill:
- Let that skill drive strategy selection and signal evaluation
- Use this skill to pull live data (chains, metrics, candles) and execute orders
- Always run the mandatory startup sequence first — pass account context to strategy analysis

---

## Position Sizing Default

- Default: 2–5% of net liq per trade
- Express as: `$X (Y% of $Z net liq)`
- Always check margin/buying power via `order_dry_run` before confirming size

---

## Pre-Trade Enforcement Hooks

These **PreToolUse** hooks fire before `create_order` / `create_complex_order` and block submission when a rule is violated. They cannot be bypassed by skipping a step — the hook fires at the API call level.

| Hook | Exit | Fires before | Blocks / warns when |
|---|---|---|---|
| `tt-require-bracket.py` | Block (2) | `create_order`, `create_complex_order` | Any `Sell to Open` option leg lacks an OTOCO bracket. Validates bracket prices by structure: strangle/iron condor → 50% profit / 2× stop; straddle/iron butterfly → 25–35% profit / 1.5× stop; 0DTE → OTOCO required, prices not validated |
| `tt-concentration-cap.py` | Block (2) | `create_order`, `create_complex_order` | Adding the new order would push any single underlying above 25% of net liq (reads `/tmp/tt_netliq.json`; existing exposure from `/tmp/tt_positions.json`) |
| `tt-require-plan.py` | Block (2) | `create_order`, `create_complex_order` | `/tmp/tt_pending_plan.json` is missing, older than 60 minutes, or incomplete (requires: `thesis`, `profit_target`, `stop_loss`, `time_stop`, `invalidation`) |
| `tt-require-dte.py` | Warn (1) | `create_order`, `create_complex_order` | Any `Sell to Open` option leg is at or inside 21 DTE at entry (warning only — does not block; 0DTE entries are exempt) |

**Before placing any order:**
1. Write a trade plan to `/tmp/tt_pending_plan.json` with all five fields
2. Call `get_account_balances` (populates `/tmp/tt_netliq.json`) then `get_positions` (save to `/tmp/tt_positions.json`) — concentration cap fails closed if either file is missing
3. Wrap every naked short-premium open in an OTOCO order with profit and stop child orders

**Nakedness definition** (`tt-require-bracket.py`): A STO option leg is naked when BTO contracts on the same underlying are fewer than STO contracts (quantity parity). 1:1 spreads are defined-risk and do not require a bracket. Ratio spreads (2:1) require a bracket for the unhedged leg. When per-leg prices are provided, a near-zero BTO debit (< 5% of STO credit) is also treated as naked regardless of quantity.

**Bracket prices are strategy-specific:**
- **Strangle / Iron Condor** (different STO strikes): LIMIT at 50% of credit, STOP at 2× credit
- **Straddle / Iron Butterfly** (same STO strike): LIMIT at 25–35% of credit (hook targets 30%), STOP at 1.5× credit
- **0DTE orders** (expires today): OTOCO required; bracket prices are not validated (time-based close)

All prices are compared as absolute values — closing orders carry negative prices in TastyTrade JSON.

**Concentration approximation** (`tt-concentration-cap.py`): New-order exposure is estimated as `|net_price| × max_opening_leg_quantity × multiplier` per underlying. This is a conservative over-estimate for multi-leg spreads where the net credit is small relative to notional; it may flag a roll or adjustment order at the boundary. If blocked, review actual position sizes with `get_positions` before closing legs.
