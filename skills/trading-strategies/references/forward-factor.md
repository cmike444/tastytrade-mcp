# Forward Factor Strategy

## The Core Idea
The term structure's implied view of *future* volatility systematically mismeasures what short-dated vol will actually be. Harvest this with calendar spreads (sell near, buy far = long forward volatility).

**Academic basis**: "Term Structure Forecast of Volatility and Options Portfolio Returns"

## Forward Volatility Math

Variance (not vol) is additive over non-overlapping periods. Always work in variance space.

**Formula:**
```
σ_fwd² = (σ₂² × T₂ − σ₁² × T₁) / (T₂ − T₁)
σ_fwd = √(σ_fwd²)
```
Where T₁, T₂ are in years (e.g., 30/365).

**Example:** 30-day IV = 45%, 60-day IV = 35%
→ Forward variance = (0.35² × 60/365 − 0.45² × 30/365) / (30/365) = 0.0425
→ Forward vol = **20.6%**

## The Forward Factor

```
FF = (Front IV − Forward IV) / Forward IV
```

**Always compute FF using ex-earn IVs** — strip earnings premium so both expiries are on equal footing.

| FF | Signal |
|---|---|
| ≥ 0.30 (ex-earn) | Tradable — go long calendar |
| 0.20–0.29 | Bare minimum; only with exceptional liquidity and conviction |
| > 0 | Front in backwardation — favorable |
| < 0 | Contango — long calendar edge is weaker |

Higher FF = stronger signal. Compare current FF to the ticker's own historical FF where data is available — elevated vs. history strengthens the setup.

**Liquidity filter**: avg daily options volume ≥ 10k (20-day avg).

## CRITICAL: Two-Stage FF Workflow — Term-Structure Signal vs. Strike Entry

**The hook-injected FF from `get_market_metrics` is a scanner signal only. It does not tell you which strike to trade.**

Term-structure FF is computed from aggregate/ATM IVs across expiries. At any individual strike, the IV relationship may be completely different — including flipping to contango at ATM while backwardation exists in OTM strikes.

**The edge in calendar spreads typically lives in OTM strikes** where the front-month fear premium is most concentrated.

### Stage 1 — Scanner (hook output)
- `get_market_metrics(detail="full")` → hook injects FF per expiry pair
- FF ≥ 0.30 with `← CALENDAR SIGNAL` label → proceed to Stage 2
- FF < 0.30 → skip this name

### Stage 2 — Strike-level FF scan (actual trade decision)
1. Call `get_options_greeks` for **both expiries** across a range of strikes: ATM, ATM+0.5, ATM+1.0, ATM+1.5 (calls); ATM-0.5, ATM-1.0 (puts)
2. For each strike compute: `FF_strike = (IV_front_strike − IV_back_strike) / IV_back_strike`
3. **Enter at the strike with the largest positive FF_strike** — not necessarily ATM
4. If FF_strike ≤ 0 at all strikes scanned → term-structure signal was aggregate noise; **do not enter**

**Real example (UNG May15/May29):**
- Term-structure FF: 38.8% → strong scanner signal
- ATM $11 strike FF: **-1.4%** → contango at ATM, edge is gone here
- Correct action: scan $11.5C, $12C, $12.5C to find the OTM strike where IV_front > IV_back by the most

**IV smoothing note:** Different platforms (tastytrade, OQuants) use different IV smoothing models. The same term-structure FF may read 38.8% on raw `market_metrics` and 22.6% on a smoother model — neither is wrong. Strike-level scan using actual option IVs from `get_options_greeks` is ground truth for entry.

## Trade Structures

**Long OTM Call Calendar** (primary): sell near-dated call at the strike with the highest positive FF_strike, buy far-dated call at the same strike. **Run the Stage 2 scan — do not default to ATM without confirming strike-level FF.**

**Long ATM Call Calendar** (acceptable only when confirmed): use ATM only if the strike-level scan shows ATM has the strongest IV_front > IV_back differential.

**Long 35-Delta Double Calendar** (advanced): two calendars (call + put sides at ±35Δ). Wider profit tent, higher win rate, but more legs/cost. The edge is in FF, not the structure — use the ATM calendar.

## DTE Pairs

| Pair | Notes |
|---|---|
| 30–60 | More signals |
| 30–90 | Balanced |
| **60–90** | **Best CAGR and Sharpe historically** |

Allow ±5 DTE buffer.

## Entry / Exit
1. **Screen**: Scan your watchlist or instruments for tickers with ex-earn FF ≥ 0.30 and options volume ≥ 10k/day
2. **Choose expiries**: Back leg typically < 100 DTE; rank candidates by FF magnitude and fill the highest first
3. **Confirm ex-earn FF** on the chosen expiry pair before entering
4. **Strike selection**: run Stage 2 FF_strike scan; enter at the highest positive FF_strike — often OTM, not ATM
5. **Price the calendar** (selected strike): `get_options_greeks` `price` is **theoretical mid, not a fillable price** — always call `get_quote` during market hours for real bid/ask. Natural (immediately fillable) ≈ mid + ~1 full spread width per leg. Start limit order near bid, improve 1–2 ticks. Spread orders preferred over legging. Third-party "fair value" targets (OQuants etc.) reflect their IV model — may require working the order
6. **Debit discipline**: Calculate the fair-value max debit implied by FF ≥ 0.30 using the forward vol math above. **Do not pay above this.** Very cheap debits are excellent — you're buying forward vol at a bargain
7. **Size**: 1–4% of account per position (tilt toward 4% for best FF + highest liquidity names). Size assuming entire debit can be lost on drift

**Exit when either condition is met:**
- **(a) Front expiry day** — close as a spread before close; avoids pin risk and assignment shenanigans
- **(b) FF has mean-reverted** (FF < 0 now) AND you're showing considerable profit — sanity-check exit price against current FF, DTEs, and prevailing IVs before closing

## Earnings Case Handling

Always compute FF with ex-earn IVs. Three cases:

| Case | Setup | Action |
|---|---|---|
| A: Front expires **before** earnings, back **after** | OK if ex-earn FF ≥ 0.30. Close on front expiry (before earnings). No earnings risk. | Trade it |
| B: Both expiries **after** earnings | Two trades in one (FF + short earnings vol). Only proceed if ex-earn FF ≥ 0.30 AND you'd be comfortable being short earnings vol under your earnings strategy criteria. | Proceed if both criteria met; otherwise skip |
| C: Zero earnings thinking desired | Skip and find a clean window, or enter after earnings morning to capture any residual event premium | Skip / wait |

## Mid-Trade Management

**Base Plan: Hold to Front Expiry**
Hold to the day the front expires and close as a spread before the close. This avoids assignment shenanigans and expiry microstructure while preserving the forward-vol bet.

**Mark-to-market "losses" are often not real:**
- Wide back-month spreads skew broker marks near the bid on longs and the ask on the short
- As front approaches expiry, spreads tighten and marks become realistic
- Hold to front expiry unless FF has collapsed and you have strong profit — don't panic-close on a mid-trade mark

**Early Exit (Rule-Based):**
Close early only if both are true:
- FF has mean-reverted (FF < 0 now), and
- You're showing a considerable profit

Always use the calculator at exit to sanity-check whether the price offered aligns with current FF, DTEs, and prevailing IVs.

**Price Rips Through the Short Strike**
- Do nothing — stick with the trade and expect price to revert back
- The calendar's long back-month leg provides a natural hedge; the forward vol thesis remains intact as long as FF is still present

**FF Reaches Zero Mid-Trade**
- When FF hits 0, the forward vol edge is gone — the trade is now pure theta decay
- Check whether the remaining theta justifies holding to front expiry; if the time value remaining is meaningful relative to the debit paid, it may still be worth holding
- If theta remaining is negligible, close early

**Delta Hedging Threshold**
- Whether to delta hedge depends on the cost of hedging relative to the size of the position
- Apply best-practice judgment: if the delta drift is creating P&L risk that is material relative to the position size and the hedge cost is reasonable, hedge; if the hedge cost consumes a significant portion of the expected edge, don't
- Prioritize hedging when the book has compounding delta in the same direction from other positions

**Re-centering if price drifts:**
- If underlying drifts significantly but FF signal remains elevated, open an additional ATM calendar at the new spot price to re-center the tent
- Respect per-name/sector position caps; don't pyramid blindly
- Only re-center if FF is still elevated and total sizing stays within plan

**Assignment risk:**
- If short call/put approaches 0.95+ delta, early exercise risk rises (especially calls near ex-div dates)
- Close the spread early (as a spread) if assignment risk is material
- If assigned, immediately close the stock position and unwind the remaining option leg — do not carry unintended delta overnight

**Execution tactics to reduce friction:**
- Limit orders only — never market orders
- Work the order up 1–2 ticks at a time; let orders sit on the book
- If liquidity is patchy, use partial fills rather than one large order
- Set a max debit threshold before entry (from the calculator) and do not pay above it

## Pre-Trade Checklist

1. **Liquidity**: options volume ≥ 10k/day (20-day avg)
2. **Pair selection**: choose best DTE pair from FF screener; 60–90 is historically strongest
3. **FF (ex-earn)**: ≥ 0.30 preferred; 0.20–0.29 bare minimum with exceptional liquidity
4. **Earnings window**: identify which case (A/B/C); if Case B, confirm willingness to be short earnings vol
5. **Debit cap**: use calculator's Max Debit; do not pay above it — cheap debits are excellent

## Practical Pitfalls
- Don't "average up" to get filled — price discipline preserves edge
- Let limit orders sit; don't pay above your calculated max debit
- Avoid extremely thin names even with high FF — slippage erases expectancy
- Respect per-name/sector caps — avoid clustering
- Watch dividends on short calls (early exercise risk)
- Don't confuse broker marks with reality — judge exits against current FF and prevailing IVs, not just P&L



## Backtest Performance (300k+ trades, 2007–present, with commissions)

| DTE Pair | CAGR | Sharpe |
|---|---|---|
| 30–60 | 16.9% | 2.37 |
| 30–90 | 20.0% | 2.64 |
| **60–90** | **26.7%** | **2.40** |

## Sizing
- 4% per position default (2–8% range)
- Quarter Kelly or less
- Prioritize highest FF; diversify across names

## Why the Edge Persists
Very few traders explicitly trade forward vol. Near-term hedging/speculation crowds the front period while the back stays calm. Mid-liquidity names too small for large funds to arb away. Edge is robust across all DTE pairs and structures.
