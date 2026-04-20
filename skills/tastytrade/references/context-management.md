# Context Window Management

## The Problem

Several tastytrade MCP tools return extremely large payloads that, if printed directly, will consume the entire context window and degrade response quality:

| Tool | Typical Response Size | Risk |
|---|---|---|
| `get_option_chain` | 100–500+ strikes × fields | Very high |
| `get_nested_option_chain` | All expiries × all strikes | Extreme |
| `get_compact_option_chain` | Compact but still large for liquid symbols | High |
| `get_candles` (1y daily) | 252 bars × 6 fields | Moderate |
| `get_transactions` | Paginated, can be 1000s of rows | High |
| `get_active_equities` | All active symbols | Always use pagination |
| `get_future_option_chain` | Similar to equity options | High |

---

## The Pattern: Save → Filter → Summarize → Visualize

**Step 1: Save raw response to file**
```python
import json

data = mcp_get_option_chain(...)   # raw MCP result
with open("/tmp/tt_chain_SPY.json", "w") as f:
    json.dump(data, f)
```

**Step 2: Filter using a script**
```bash
python3 scripts/filter_chain.py \
  --input /tmp/tt_chain_SPY.json \
  --expiry 2024-01-19 \
  --delta-range 0.10 0.40 \
  --mode strikes
```

**Step 3: Present only the compact result**
Show a table of 5–10 key strikes, not the full chain.

**Step 4: Generate a chart if it adds value**
```bash
python3 scripts/iv_curve.py --input /tmp/tt_chain_SPY.json --expiry 2024-01-19
```

---

## Option Chain Filtering Strategy

When analyzing an option chain, only extract what is needed:

| Task | Extract |
|---|---|
| Strike selection (selling) | 15–30 delta strikes ± ATM |
| Strike selection (buying) | 30–50 delta strikes |
| IV skew analysis | All strikes, ATM ± 2 SDs |
| Calendar spread | ATM strike across 2–3 expiries |
| IV term structure | ATM IV for each expiry only |
| Iron condor setup | 15δ call, 15δ put, and wings |

**Never print:** raw nested option chain JSON, all strikes for all expiries, full candle arrays of 250+ bars.

---

## Pagination Rules

For `get_transactions`, `get_orders`, `get_customer_orders`:
- Always specify a date range — don't fetch all history
- For P&L analytics, fetch last 12 months max per call
- Process in `scripts/pnl_analytics.py` which aggregates before returning summary

---

## Candle Data Guidelines

`get_candles` uses `periodMinutes` (e.g. 5, 60, 1440 for daily) and `daysBack` — NOT `width`/`startDate`. The `limit` param caps the number of candles returned (default 100). Use `detail="summary"` for OHLC-only or `detail="standard"` (default) for OHLCV+vwap.

| Lookback | periodMinutes | Approx bars | Guidance |
|---|---|---|---|
| 1 year daily | 1440 | ~252 | Use `limit=252`, compute in script, never print raw |
| 90 days daily | 1440 | ~63 | OK inline with `detail="standard"` |
| 30 days hourly | 60 | ~120 | Use `limit=100`, pipe to script |
| Intraday | 5 or 15 | varies | Always pipe to script |

When using `get_candles` for realized volatility computation, run the HV formula in a script and return only the HV value, not all the bars.

---

## Summary Output Format

When returning filtered chain data inline, use compact tables:

```
SPY Jan 19 2024 — Key Strikes (IV / Delta / Theta)
──────────────────────────────────────────────────
460C  | IV 18.2% | Δ 0.30 | Θ -0.08 | $3.45
455C  | IV 19.1% | Δ 0.38 | Θ -0.10 | $5.20
450 (ATM) | IV 20.5% | Δ 0.50 | Θ -0.12 | $7.80
445P  | IV 22.3% | Δ -0.38| Θ -0.10 | $5.60
440P  | IV 24.1% | Δ -0.30| Θ -0.08 | $3.90
```

Limit inline strike tables to 8–10 rows maximum.

---

## Transactions and P&L History

For historical P&L analysis:
1. Call `get_transactions` with a specific date range (e.g., past 90 days)
2. Write the response to `/tmp/tt_transactions_<account>.json`
3. Run `scripts/pnl_analytics.py` which reads the file and returns:
   - Total P&L for the period
   - P&L by underlying
   - P&L by strategy (options, equities, futures)
   - P&L breakdown chart by period
4. Never print raw transaction records — there can be thousands

---

## Multi-Symbol Lookups

When comparing multiple underlyings (e.g., SPY vs QQQ vs /MES):
- Call `get_market_metrics` for all symbols simultaneously
- Call `get_quote` for all symbols simultaneously
- MCP tools support batch symbol arrays — use them
- Run `scripts/compare_underlyings.py` for visual comparison
- Never print raw multi-symbol chain data

---

## Emergency Context Recovery

If context is getting large from a prior large response:
1. Summarize what was learned in 3–5 bullet points
2. Discard the raw data reference
3. Store any ongoing analysis state in `/tmp/tt_state_<session>.json`
4. Continue from the summary
