# Computable Signals & Visualizations

When live option chain and price data are available (e.g., via Tastytrade MCP tools), Claude can compute and visualize these signals on demand. Pull `get_market_metrics`, `get_compact_option_chain`, and `get_candles` as the data sources, then apply the formulas below.

---

## Signal Formulas

### Realized Volatility (RV)

**Close-to-close (simplest):**
```
daily_return[i] = ln(close[i] / close[i-1])
RV(Nd) = sqrt(252) × std(daily_return, window=N)
```

**Intraday (higher frequency, more responsive):**
```
intraday_return[i] = ln(high[i] / low[i])   # Parkinson estimator
RV(Nd) = sqrt(252 / (4 × ln(2))) × mean(intraday_return², window=N)
```

Standard comparison for VRP: **30d IV vs. 20d RV** (20d RV approximates realized vol over a 30d option's life).

For ex-earn RV: exclude the earnings day and the following day from the return series before computing.

---

### VRP (Variance Risk Premium)

```
VRP = IV(30d) − RV(20d)          # vol space
VRP_variance = IV(30d)² − RV(20d)²   # variance space (more additive)
```

**Normalized VRP (more stable signal):**
```
IV/RV ratio = IV(30d) / RV(20d, ex-earn)
IV/RV vs 1y avg = (IV/RV) / mean(IV/RV, window=252d)
```
Values > 1 mean current VRP is above its own historical norm — stronger short-vol signal.

---

### IV Percentile & Z-Score

```
IV_pctl(1y) = percentile_rank(IV(30d, ex-earn), window=252d)
IV_zscore   = (IV(30d, ex-earn) − mean(IV(30d, ex-earn), 252d)) / std(IV(30d, ex-earn), 252d)
```

Use ex-earn IV for both. IV percentile < 80% is preferred for VRP entry. IV z-score > +2 signals a stress regime — exercise caution with short vol.

---

### Skew Slope

**Definition:** Best-fit regression line through 30d option strike IVs, adjusted to the tangent slope at the 50-delta strike. Units: change in IV per 10-delta increase in call delta.

**Practical approximation from liquid strikes:**
```
skew_slope ≈ (IV(50Δ call) − IV(25Δ put)) / (50 − 25) × 10
           = (ATM_IV − OTM_put_IV) / 2.5
```

More negative = steeper put skew. More positive = steeper call skew.

**Skew slope curvature (derivative):**
```
curvature ≈ (IV(25Δ call) + IV(25Δ put) − 2 × IV(50Δ)) / (25²)
```
Positive curvature = vol surface is concave up (wings more expensive relative to ATM) — favors buying the wing in a 1-3-2 fly. Negative curvature = wings relatively cheap.

---

### Skew Z-Score (Momentum-Skew entry signal)

```
skew_zscore(1y) = (skew_slope − mean(skew_slope, 252d)) / std(skew_slope, 252d)
```

Entry threshold: skew z-score ≤ −1.5 (put skew extended) or ≤ −1.5 on call side for call skew plays. Below −2.0 is high confidence.

**Skew slope vs. sector ETF (isolates idiosyncratic skew premium):**
```
skew_ratio = skew_slope(stock) / skew_slope(ETF)
skew_ratio_zscore = (skew_ratio − mean(skew_ratio, 252d)) / std(skew_ratio, 252d)
```
A stock whose skew is extended vs. its ETF has idiosyncratic premium beyond market-wide hedging demand — a stronger signal.

---

### Forward Volatility & Forward Factor

```
# Always work in variance space
T1, T2 = DTE_front / 365, DTE_back / 365
fwd_variance = (IV2² × T2 − IV1² × T1) / (T2 − T1)
fwd_vol      = sqrt(max(fwd_variance, 0))   # clamp at 0 to avoid NaN

FF = (IV1 − fwd_vol) / fwd_vol
```

Always use ex-earn IV1 and IV2. Entry threshold: FF ≥ 0.30.

**Flat forward vol** (term-structure-slope-adjusted):
```
flat_fwd_ratio = flat_fwd_vol / fwd_vol
```
When flat_fwd_ratio > 1, the forward vol is elevated even after removing the slope effect — stronger signal.

---

### Earnings Implied Move

```
implied_move ≈ straddle_price / stock_price   # ATM call + ATM put, front expiry capturing earnings
```

More precisely, the market-implied one-standard-deviation move around earnings. Compare to:
- Avg historical realized move (past 8–12 quarters)
- Avg historical implied move
- Current quarter seasonal norms

**VDR (Volatility Deviation Ratio):**
```
VDR = mean(RV_earnings_day, RV_day_after) / (IV_day_before × IV_day_after)
```
VDR < 1 historically = options consistently overpriced this stock's earnings → favors selling.

---

### Put/Call Ratio

```
PC_OI_ratio = total_put_OI / total_call_OI
```

- Ratio > 1: elevated put demand, bearish/hedging sentiment
- Ratio < 1: elevated call interest, bullish/speculative positioning
- Extreme readings (>1.5 or <0.5) can be contrarian signals

---

### Term Structure Slope

```
term_slope = IV(front_expiry, ex-earn) − IV(45d, ex-earn)
```

More negative = steeper backwardation = near-term fear priced in. This is the primary signal for Earnings Crush strategy — must be negative (backwardated) for the trade to be "Recommended."

---

### Momentum Signals

**Time-series momentum (TSMOM):**
```
TSMOM(Nd) = (price_today − price_N_days_ago) / price_N_days_ago
```
Periods used: 21d (1m), 63d (3m), 126d (6m), 252d (1y). Positive = bullish TSMOM.

**Relative momentum vs. SPY:**
```
rel_momentum = return(stock, Nd) / return(SPY, Nd)
```
> 1 = outperforming the market.

**Cross-sectional momentum (approximation without full universe):**
Compare stock's 1-month, 3-month, and 6-month returns against sector ETF. If stock is in top 20% of recent returnss → CS momentum ≥ 8 (approximate). Bottom 30% → CS momentum ≤ 3.

**Turnover:**
```
turnover = daily_volume / shares_outstanding
```
High relative to its own history = institutional/retail interest confirming the momentum move.

**52-week high proximity:**
```
proximity = (price_today − price_52w_low) / (price_52w_high − price_52w_low)
```
Values near 1.0 = near 52w high = strongest forward momentum historically.

---

## Visualizations Claude Can Build On Demand

When the user asks to analyze a specific ticker, Claude can produce these charts using data from MCP tools or uploaded price/IV history.

### 1. Volatility Cone
Shows whether current IV is historically high or low across tenors.

**Inputs:** Historical RV at multiple windows (10d, 20d, 30d, 60d, 90d, 252d)
**Chart:** For each window, plot min/25th/median/75th/max of historical RV + current IV. Current IV plotted as a dot. If IV is above the 75th percentile cone → elevated; below 25th → cheap.

### 2. VRP Timeseries
Shows when VRP was persistently positive (short-vol-favorable) vs. negative (dangerous).

**Inputs:** Rolling 30d IV and 20d RV over 1-2 years of daily data
**Chart:** Line chart of `VRP = IV(30d) − RV(20d)` over time, with zero line. Shade positive periods green, negative red. Add a horizontal mean line.

### 3. Term Structure Snapshot
Shows shape of the vol curve right now.

**Inputs:** IV at each standard expiry (front monthly through 4th monthly, or 10d/20d/30d/60d/90d interpolated)
**Chart:** Line chart with DTE on x-axis, IV on y-axis. Plot the curve. Slope = contango or backwardation immediately visible.

### 4. Skew Surface (Multi-Expiry)
Shows how OTM options are priced across strikes and expirations.

**Inputs:** IV at 5Δ, 25Δ, 50Δ, 75Δ, 95Δ for each expiry
**Chart:** Multiple lines (one per expiry) on a delta x-axis (5→95), IV on y-axis. Steeper downward slope on put side = put skew. Crossing lines = skew term structure divergence.

### 5. Forward Factor Bar Chart
Shows FF across all tradeable expiry pairs for a given ticker.

**Inputs:** IV at M1, M2, M3, M4 expirations (or interpolated 20d/30d/60d/90d)
**Chart:** Bar chart with expiry pair labels (e.g., "30d→60d", "60d→90d") on x-axis, FF value on y-axis. Horizontal line at 0.30 threshold. Bars above the line = tradeable.

### 6. Skew Timeseries
Shows whether current skew is extended vs. its own history.

**Inputs:** Daily skew slope over ~252 days
**Chart:** Line chart of skew slope over time + rolling mean ± 1 and 2 standard deviation bands. Current value plotted as a point. Below −2σ = z-score ≤ −2.0 = high-conviction entry for Momentum Skew.

### 7. Earnings Implied vs. Realized Move History
Shows whether this stock's earnings have historically been overpriced.

**Inputs:** Per-earnings-event: implied move (straddle price / stock price before earnings), realized move (abs % move after earnings), over past 8–12 quarters
**Chart:** Grouped bar chart (implied vs. realized per quarter) + a line for the avg implied and avg realized. If implied bars consistently taller = earnings crush is in play.

### 8. Spot-Vol Correlation Scatter
Shows how IV responds to price moves — informs strike placement for delta-neutral structures.

**Inputs:** Daily price returns + daily IV changes over ~60d
**Chart:** Scatter plot, x = daily price return, y = daily IV change, with regression line. Negative slope (typical equities) = IV rises when price falls = put skew dynamic. Use slope to bias strike placement: in a negatively correlated asset, center structures slightly above ATM.

---

## When to Offer These Visualizations

- User asks "should I take this trade?" on a specific ticker → compute relevant signals and offer the most decision-relevant chart (e.g., FF bar chart for Forward Factor, skew timeseries for Momentum Skew)
- User asks "how does the vol surface look?" → Term structure + skew surface
- User asks "is VRP favorable?" → VRP timeseries + volatility cone
- User asks "how has this stock's earnings looked?" → Earnings implied vs. realized history
- Any strategy analysis where the direction of the signal is ambiguous → build the chart to make it visually clear
