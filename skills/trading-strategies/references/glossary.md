# Key Terms & Concepts

Definitions used consistently across all strategies in this playbook.

---

## Ex-Earn (Ex-Earnings)

Implied or realized volatilities with the earnings effect removed.

- **For RV**: exclude the trading day of the earnings announcement *and* the day after (these days have outsized moves that would otherwise inflate realized vol estimates)
- **For IV**: estimate the implied earnings move embedded in the term structure and strip it out using root-time scaling across all expirations

Always use ex-earn IV and RV when computing signals for Forward Factor and VRP on stocks with upcoming or recent earnings. Comparing raw IV to raw RV near an earnings date will produce misleading signals.

---

## Implied Volatility (IV)

The market's forward-looking expectation of volatility, extracted from option prices. IV is annualized and expressed as a percentage. It is not a forecast of direction — only of expected magnitude of moves.

Key variants:
- **ATM IV**: implied vol at the at-the-money strike
- **IV by delta**: implied vol at a specific delta (e.g., 25-delta IV, 5-delta IV) — used for skew analysis
- **Interpolated IV (e.g., 30d IV)**: vol interpolated to a fixed tenor (e.g., 30 calendar days), regardless of which expiry is closest

---

## Realized Volatility (RV)

Historical volatility of the underlying, calculated from actual price moves. Two common methods:
- **Intraday RV**: calculated from intraday price changes (higher frequency, more responsive)
- **Close-to-close RV**: calculated from daily closing prices (simpler, less noisy)

The standard comparison for VRP is **30-day IV vs. 20-day RV** (the 20-day RV approximates the realized vol over the life of a 30-day option).

---

## VRP (Variance Risk Premium)

The difference between implied and realized volatility: `VRP = IV − RV` (or in variance space: `IV² − RV²`).

- **Positive VRP**: IV > RV — options are overpriced relative to what actually happened; favors sellers
- **Negative VRP**: IV < RV — market underestimated realized moves; favors buyers

---

## Skew / Skew Slope

The variation in implied volatility across strikes. "Slope" refers to the slope of the volatility skew — specifically, **the change in IV for every 10-delta increase in call delta** for 30-day options (unless otherwise specified).

- More negative slope = steeper put-side skew = OTM puts are proportionally more expensive
- More positive slope = steeper call-side skew = OTM calls are proportionally more expensive
- Skew z-score: how many standard deviations the current slope is from its 1-year mean

---

## Contango / Backwardation

The shape of the volatility term structure:
- **Contango**: longer-dated IV > shorter-dated IV (normal state; uncertainty grows over time)
- **Backwardation**: shorter-dated IV > longer-dated IV (near-term fear or event risk is elevated)
- **Term slope**: the short-term slope of ATM implied volatilities across expirations (negative values = backwardation)

---

## Forward Volatility

The implied volatility for the *interval between* two expirations — i.e., the market's expectation of vol for the period after the front option expires.

**Formula (always work in variance space):**
```
σ_fwd² = (σ₂² × T₂ − σ₁² × T₁) / (T₂ − T₁)
σ_fwd  = √(σ_fwd²)
```
Where T₁, T₂ are in years (e.g., 30/365 and 60/365).

**Ex-earn forward vol**: same formula, applied to ex-earn IVs. Required for the Forward Factor strategy.

**Flat forward vol**: a variant that removes the term structure slope effect, leaving only the level. Used in the VRP flat forward volatility ratio signal.

---

## Forward Factor (FF)

```
FF = (Front IV − Forward IV) / Forward IV
```

Measures whether near-term options are priced rich or cheap relative to the forward vol implied between two expirations.

- FF > 0: front is "hot" vs. forward → backwardation → favorable for long calendar
- FF ≥ 0.30 (ex-earn): tradable threshold for the Forward Factor strategy
- Always compute using ex-earn IVs

---

## IV Percentile (IVP)

Ranks current IV against its own history over a lookback window (typically 1 year). A 1-year IVP of 70% means current IV is higher than 70% of readings over the past year.

**Counterintuitive for VRP**: low IVP (not high) often has better short-vol performance. High IVP (>80%) indicates stress regimes where realized vol can catch up to implied — a risk for vol sellers.

---

## VDR (Volatility Deviation Ratio)

A metric for measuring how much actual earnings volatility exceeded (or fell short of) what was implied:

```
VDR = avg(actual vol on earnings day, actual vol on day after)
      ÷ (implied vol day before earnings × implied vol day after earnings)
```

- VDR > 1: realized exceeded implied — options underpriced the event
- VDR < 1: realized fell short of implied — options overpriced the event (favors sellers)

Useful for evaluating historical earnings setups: a stock with consistently low VDR across past earnings is a good candidate for the Earnings Crush strategy.

---

## PEAD (Post-Earnings Announcement Drift)

The tendency for stocks to continue drifting in the direction of their earnings surprise for days or weeks after the announcement. This is why the Earnings Crush strategy exits 15 minutes after open the day after — to capture the IV crush while avoiding PEAD-driven drift risk that could move the stock against a delta-neutral position.

---

## Turnover

`Turnover = Trading Volume / Shares Outstanding`

A momentum-confirming signal. High turnover indicates institutional positioning, retail interest, or news-driven activity — all of which tend to carry forward in the short term. Used as an additional momentum filter in the Momentum Skew strategy.

---

## Relative Value (IV vs. Sector ETF)

For individual stocks, comparing a stock's IV and VRP to its sector ETF provides context:
- **IV/ETF ratio**: stock's 30-day IV divided by its sector ETF's 30-day IV — normalized for market-wide vol level
- **IV/RV vs. ETF IV/RV**: compares the stock's VRP to the ETF's VRP — isolates idiosyncratic vol premium from broad market effects

A stock with an elevated IV/ETF ratio *and* elevated IV/RV vs. ETF IV/RV has both absolute and relative mispricing — a stronger VRP signal than either alone.
