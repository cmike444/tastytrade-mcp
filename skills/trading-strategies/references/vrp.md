# Variance Risk Premium (VRP)

## Why the Edge Exists

IV systematically overstates future realized vol. Option sellers take on convexity risk and the market pays them a premium for it — you're collecting more than the risk actually costs on average.

**Critical**: VRP magnitude varies significantly by asset. ETFs and indices tend to have the most consistent, well-documented VRP. Individual stocks, index options, and futures can also carry meaningful VRP — but always verify the historical IV/RV relationship for the specific instrument before trading it. Some assets have negative VRP and should be avoided.

## Why Overpricing Persists

- **Sellers demand compensation** for tail/jump risk — limited upside, unlimited downside
- **Buyers overpay for protection** — institutions buy OTM puts as portfolio insurance; peace of mind has a premium
- **Speculation demand** — OTM calls bought as "lottery tickets" bid up call-side IV
- **Structural supply/demand imbalance** — net demand from hedgers/speculators exceeds supply from sophisticated sellers who require risk premium

## Hard Rules

These rules are non-negotiable. No exceptions regardless of signal quality, account size, or conviction.

1. **OTOCO at entry — always.** Every short-premium VRP entry (short strangle, short straddle, iron condor) must be placed as an OTOCO order with simultaneous GTC brackets: profit target at **50% of credit collected**, stop loss at **2× credit collected**. Manual bracket placement after fill is not acceptable — the brackets must be live the moment the position opens.

2. **Mechanical 21-DTE time stop.** Close (or roll) any VRP position by 21 DTE regardless of P&L. Do not hold into gamma territory hoping for a better exit. The 21-DTE close is unconditional — it is not a guideline or a default, it is the rule. Rolling is only permitted if VRP signals re-qualify the new expiry at entry.

3. **25%-of-net-liq single-name concentration cap.** No single underlying may represent more than 25% of net liquidating value in VRP exposure (measured by margin at risk, not premium received). This applies per ticker across all VRP structures combined. Diversify across at least 3–5 uncorrelated names.

## Signals (in order of importance)

**1. IV/RV Ratio (log-transformed)**
- `log(30-day IV / 30-day RV)` — higher = more overpriced IV
- Use log transform to normalize; strong positive relationship with returns

**2. 1-Year IV Percentile (counterintuitive)**
- **LOW percentile performs BETTER for selling** — not high
- Top 2 deciles (80th+) favor long vol — stress regimes where realized catches up
- 35th percentile = green light, not a warning
- IVP < 80% is favorable; avoid selling into extreme IVP (>80%) environments

**3. Flat Forward Volatility Ratio**
- ~1% R-squared (impressive for finance); strong predictive power
- Higher ratio = stronger short vol signal

**4. Term Structure**
- Contango (longer-dated IV > shorter-dated) = calm, favorable for selling
- Steep backwardation = warning sign; near-term spike risk is high
- Mild backwardation after a vol spike may still offer opportunity as market normalizes

**Combined model**: linear regression of all three. Only trade when predicted return > 8%.

## Asset Selection

VRP is tradable across multiple asset classes — apply the same signal framework, but validate the IV/RV relationship for each instrument before committing capital.

**ETFs and broad indices (most reliable)**
- Reduced idiosyncratic risk; more consistent VRP historically
- Liquid options markets with tight spreads
- Examples: SPY, QQQ, IWM, GLD, EFA, EEM — select 3–5 with low price and volatility correlation to each other

**Individual equities**
- VRP exists on many stocks but is less consistent than indices — earnings, news, and company-specific events can overwhelm it
- Verify historical IV > RV for that stock before trading (check backtest of short straddle over multiple cycles)
- Systematic harvesting works better across a diversified basket of stocks than concentrated in one name

**Index options (SPX, NDX, RUT)**
- Strong, well-documented VRP; cash-settled, no assignment risk on exercise
- Higher notional size requires careful contract sizing
- European-style exercise removes early assignment risk on short legs

**Futures options (/ES, /NQ, /CL, /GC, etc.)**
- Meaningful VRP on liquid futures; especially on equity index futures (/ES, /MES, /NQ)
- Margin dynamics differ — know your account's futures margin requirements before sizing
- Commodity futures options may have seasonal or supply-driven IV patterns that can compress or invert VRP

**Avoid clustering**: select names with low correlation to each other across the entire VRP book. All short-vol positions correlate in a spike — diversification by name, sector, and asset class reduces this.

## Trade Structures

**Wide Iron Condor (recommended for defined risk):**
- Sell 25–30 delta put + 25–30 delta call (the "body")
- Buy 1–5 delta wings (disaster insurance only — not for comfort on normal losses)
- All same expiration, ~30–45 DTE
- Capital at risk = margin requirement, not just premium collected

**Long Butterfly (preferred for smoothest equity curve):**
- Buy lower + upper strikes, sell 2 ATM
- Defined risk; historically smoother P&L curve than straddle

**Short Straddle:**
- Sell ATM call + put, ~30 DTE
- Higher raw returns, open-ended risk
- Use only if you can absorb fat left tail

**Short Straddle/Strangle with Delta Hedging (advanced):**
- No premium lost to wings; captures the full VRP
- Requires active management and higher margin
- Hedge when position delta exceeds ±5–10 per contract; check once or twice daily
- Every hedge costs money (commissions + spread) — balance cost vs. risk reduction

**Strike placement tips:**
- Spot-vol correlation: equity IV rises when price falls. Centering ATM structures slightly above current price can add a small vega edge if market drifts up.
- For strangles with steep put skew, equal-delta strikes are not symmetric in dollar terms (25-delta put is closer to ATM than 25-delta call). Can bias slightly toward puts (e.g., 30/20 delta split) to lean into falling IV on rallies.

## Entry / Exit

**Entry checklist:**
- IV Percentile < 80%
- Current IV > recent RV (IV/RV > 1)
- Historical VRP positive on this asset (verify via IV vs. RV comparison over multiple periods)
- For individual stocks: compare stock's IV/RV to its sector ETF's IV/RV — a stock with elevated VRP *relative to its ETF* has idiosyncratic mispricing on top of broad market VRP; stronger signal than either alone
- Term structure flat or in contango
- No earnings/FOMC/event risk in the trade window

**Exit triggers:**
- IV Percentile spikes above 90–95% → consider exiting even at a loss (thesis broken)
- Term structure sharply inverts to backwardation → reduce or exit
- ~7 DTE: close or roll to next cycle (extreme gamma risk near expiry)
- Day-zero test: "Would I put this on today?" — if no, exit regardless of P&L
- **Take profit at 50% of credit collected**
- **Time-based exit: close at ~½ of entry DTE** (e.g., entered at 45 DTE → exit at 21 DTE)
- **Stop loss at 2× credit collected**
- Condition-based exits (IV spike, term structure inversion) override profit/stop targets

**RV vs. IV Monitoring**
- RV occasionally spikes above IV briefly — that alone is not an exit signal; the position may still be valid depending on strikes and underlying price
- If RV exceeds IV by >25% and holds or continues rising for several days, the short-vol thesis is breaking down — consider closing

**Butterfly Defense (if price reaches long strikes)**
- If price has moved to the long strike of the butterfly, sell a second butterfly centered at the new ATM — this effectively converts the position into an iron condor, adding a profit zone at the new price level while maintaining defined risk

**Short Straddle Defense**
- As long as price remains between the breakeven points, keep the trade on
- If price exceeds a breakeven point: either roll out in time and re-center (sell a new straddle at the new ATM, further DTE), or close the trade
- Stop loss: 2× credit received — close if the position reaches this loss level

**Rolling:**
- At ~7 DTE, roll to a similar DTE in the next monthly cycle if VRP signals are still favorable for the new expiration — re-run all three signals before rolling
- If one side is tested, roll the untested (profitable) side closer to the current price to collect additional credit and re-center — only if VRP signals remain favorable at the new strikes

**Legging out**: If closing a multi-leg spread is hard to fill, close the short legs first (removes the main risk). Long wings will likely expire worthless — acceptable outcome.

## Sizing

| Kelly | Per-trade | Notes |
|---|---|---|
| 10% (recommended) | ~1–2% of portfolio | Best Sharpe |
| 30% | ~2% | Workable |
| Full | Too aggressive | 35%+ drawdowns |

- Position at risk = margin requirement (not just premium received)
- Example: $5 credit on a condor with $15 max loss → size using $15
- Total VRP allocation across all positions: keep to 40–60% of account (all correlate in a vol spike)

## Stress Testing

Before placing any VRP trade, ask: *"What happens to my entire book if the market drops 20% and IV spikes overnight?"*
Ensure the combined drawdown from all short-vol positions would not force a margin call at the worst possible time. This defines your true capacity for the strategy.

## Real Example: QEB
- IV 68% vs RV 52%, IV/SPY ratio at 75th+, forward factor ~80%
- Short straddle May 16 (34 DTE)
- IV dropped 68% → 50% in 4 days — closed profitably
