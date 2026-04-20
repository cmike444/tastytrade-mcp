# Visualizations Reference

All scripts live in `scripts/`. They use matplotlib with a dark trading theme, accept JSON input via file path, and save charts to `/tmp/tt_chart_<name>.png`.

---

## When to Generate Each Chart

| User situation | Chart to generate |
|---|---|
| "Show me the vol skew for SPY" | `iv_curve.py` |
| "What does this trade look like at expiration?" | `payoff_diagram.py` |
| "Show my P&L over time" | `equity_curve.py` |
| "How have I been doing by day/month?" | `pnl_analytics.py` |
| "Compare SPY vs QQQ vol" | `compare_underlyings.py` |
| "What does the term structure look like?" | `term_structure.py` |
| "Show all my positions' payoff" | `payoff_diagram.py --mode portfolio` |

Generate charts proactively when they clarify the narrative — don't wait to be asked.

---

## iv_curve.py — IV Smile / Skew Curve

**What it shows:** IV plotted against strike (or delta) for a single expiration. Reveals skew (put/call imbalance), smile shape, and richness/cheapness by strike.

**Input:** Option chain JSON (from `get_compact_option_chain` or `filter_chain.py` output)

```bash
python3 scripts/iv_curve.py \
  --input /tmp/tt_chain_SPY.json \
  --expiry 2024-01-19 \
  --output /tmp/tt_chart_iv_curve_SPY.png
```

**Optional flags:**
- `--x-axis delta` — plot IV vs delta instead of strike (default: strike)
- `--mark-strikes 445 450 455` — highlight specific strikes with vertical lines
- `--compare-expiry 2024-02-16` — overlay second expiry for term structure view

**Reads from JSON:** `expirations[].strikes[].{strike-price, put-implied-volatility, call-implied-volatility, delta}`

---

## payoff_diagram.py — Payoff at Expiration

**What it shows:** Profit/loss at expiration across a range of underlying prices. Essential for visualizing risk/reward of any strategy.

**Input:** Trade legs as JSON or command-line args

```bash
# Single trade
python3 scripts/payoff_diagram.py \
  --legs '[{"type":"short_put","strike":445,"premium":2.50,"qty":1},{"type":"long_put","strike":440,"premium":1.00,"qty":1}]' \
  --spot 450 \
  --output /tmp/tt_chart_payoff_SPY.png

# From positions file (account-wide payoff)
python3 scripts/payoff_diagram.py \
  --mode portfolio \
  --positions /tmp/tt_positions.json \
  --output /tmp/tt_chart_payoff_portfolio.png
```

**Leg types:**
- `long_call`, `short_call`, `long_put`, `short_put`
- `long_stock`, `short_stock`
- `long_future`, `short_future` (specify multiplier)

**Chart features:**
- Shaded profit (green) and loss (red) regions
- Break-even points marked with dashed lines
- Max profit and max loss annotated
- Current spot price marked with vertical line
- For futures/index options: accounts for contract multiplier

**Portfolio mode:** Aggregates all option positions from `get_positions` output, plots combined payoff profile.

---

## equity_curve.py — Net Liq History

**What it shows:** Account value over time. Reveals drawdowns, growth trajectory, and consistency.

**Input:** Net liq history from `get_net_liq_history` or `get_balance_snapshots`

```bash
python3 scripts/equity_curve.py \
  --input /tmp/tt_netliq_history.json \
  --output /tmp/tt_chart_equity_curve.png
```

**Optional flags:**
- `--benchmark SPY` — overlay SPY price normalized to starting value (requires candle data at `/tmp/tt_candles_SPY.json`)
- `--drawdown` — add subplot showing rolling drawdown percentage
- `--period 90d` — limit to last N days

**Chart features:**
- Equity curve line with fill
- Drawdown shading (red zones below previous peak)
- Annotated max drawdown percentage and date
- Rolling Sharpe ratio in subtitle

---

## pnl_analytics.py — P&L by Period

**What it shows:** Profit and loss broken down by time period — reveals patterns (best day of week, best month, etc.) and consistency.

**Input:** Transactions JSON from `get_transactions`

```bash
python3 scripts/pnl_analytics.py \
  --input /tmp/tt_transactions.json \
  --output /tmp/tt_chart_pnl_analytics.png
```

**Optional flags:**
- `--period dow` — P&L by day of week (Mon–Fri bars)
- `--period weekly` — P&L by week
- `--period monthly` — P&L by calendar month (default)
- `--period quarterly` — P&L by quarter
- `--by-underlying` — top 10 underlyings by contribution
- `--by-strategy` — breakdown by instrument type (options, equities, futures)

**Chart layout (default: 2×2 grid):**
1. Monthly P&L bar chart
2. Day-of-week P&L bar chart
3. Cumulative P&L line
4. P&L distribution histogram

**Computed stats shown in title:**
- Total P&L
- Win rate %
- Average win / average loss
- Profit factor

---

## compare_underlyings.py — Multi-Symbol Comparison

**What it shows:** Side-by-side comparison of price performance, IV, and other metrics for 2–4 symbols. Useful for relative value, correlation, and hedging decisions.

**Input:** Candle data + market metrics JSON

```bash
python3 scripts/compare_underlyings.py \
  --symbols SPY QQQ IWM \
  --candles /tmp/tt_candles_SPY.json /tmp/tt_candles_QQQ.json /tmp/tt_candles_IWM.json \
  --metrics /tmp/tt_metrics.json \
  --output /tmp/tt_chart_compare.png
```

**Optional flags:**
- `--normalize` — index all prices to 100 at start (default: on)
- `--period 90d` — lookback window
- `--show-iv` — add IV panel comparing current IV and IVR for each symbol
- `--show-corr` — add rolling 30d correlation heatmap

**Chart layout:**
1. Normalized price performance (top panel)
2. IV comparison bar chart (if `--show-iv`)
3. Rolling correlation matrix (if `--show-corr`)

**Supported comparison pairs with notes:**
- `SPY vs QQQ` — beta/relative growth of S&P vs Nasdaq
- `SPY vs /MES` — spot ETF vs micro futures (basis, roll cost)
- `/MES vs SPX` — micro futures vs index options (liquidity, multiplier diff)
- `QQQ vs TQQQ` — ETF vs leveraged ETF (decay analysis)

---

## term_structure.py — IV Term Structure + Forward Vol

**What it shows:** ATM IV plotted across all expiration dates. Reveals contango/backwardation and highlights calendar spread opportunities.

**Input:** Option chain with multiple expiries (from `get_nested_option_chain` via `filter_chain.py --mode term`)

```bash
python3 scripts/term_structure.py \
  --input /tmp/tt_term_SPY.json \
  --output /tmp/tt_chart_term_structure_SPY.png
```

**Optional flags:**
- `--show-forward-vol` — overlay computed forward volatilities between adjacent expiries
- `--highlight-ff 1.2` — mark where Forward Factor exceeds threshold (calendar signal)
- `--mode surface` — render full 3D IV surface (all strikes × expiries)

**Chart features (standard mode):**
- IV vs DTE (days to expiry) line chart
- Contango/backwardation regions shaded
- Forward vol computed between each adjacent expiry pair
- Forward Factor values annotated at each gap
- Calendar spread opportunity zones highlighted when FF ≥ threshold

**Forward Factor formula displayed:**
```
FF(t1→t2) = sqrt((IV₂² × t2 − IV₁² × t1) / (t2 − t1)) / IV₂
```

---

## filter_chain.py — Option Chain Compressor (Utility)

Not a visualization — a data preprocessing utility to prevent context overflow.

```bash
# Extract key strikes for a specific expiry
python3 scripts/filter_chain.py \
  --input /tmp/tt_chain_SPY.json \
  --expiry 2024-01-19 \
  --delta-range 0.10 0.50 \
  --mode strikes \
  --output /tmp/tt_filtered_SPY_0119.json

# Extract ATM IV per expiry (term structure)
python3 scripts/filter_chain.py \
  --input /tmp/tt_chain_SPY.json \
  --mode term \
  --output /tmp/tt_term_SPY.json

# Extract IV surface matrix
python3 scripts/filter_chain.py \
  --input /tmp/tt_chain_SPY.json \
  --mode surface \
  --output /tmp/tt_surface_SPY.json

# Find nearest strikes to target delta
python3 scripts/filter_chain.py \
  --input /tmp/tt_chain_SPY.json \
  --expiry 2024-01-19 \
  --target-deltas 0.30 0.16 \
  --output /tmp/tt_targets_SPY.json
```

**Modes:**
- `strikes` — filter to delta range for one expiry, output compact table
- `term` — extract ATM IV per expiry date
- `surface` — extract strike/expiry/IV matrix for all expirations
- `targets` — find closest strikes to specified delta targets
