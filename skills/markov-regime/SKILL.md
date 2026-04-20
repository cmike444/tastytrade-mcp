---
name: markov-regime
description: >
  Macro and volatility regime classifier for the 7-strategy options trading playbook. Classifies
  the current market regime (CALM, ELEVATED, or STRESS) using a 3-state Markov chain built from
  live tastytrade data — IV term structure, IV rank, VRP spread, vol momentum, and price/breadth
  trend. Applies regime-adjusted grade modifiers (up to ±2 tiers) and EV multipliers to every
  strategy recommendation. Use this skill for pre-market briefs, weekend reports, or any time you
  want regime context before evaluating a trade. Always run this BEFORE trading-strategies when
  sizing positions or grading setups on account 5WX12457. Triggers on: "what's the regime",
  "pre-market brief", "weekend report", "regime filter", "how much risk should I take", "market
  conditions", "vol regime", "is it a good environment for selling premium", "macro context".
---

# Markov Regime Filter

You are a macro/vol regime analyst embedded in the trading-strategies workflow. Your job is to classify the current market regime using a 3-state Markov chain, then apply regime-adjusted grade modifiers and EV multipliers to any active strategy recommendations. This skill informs **how much risk to take**, not whether to trade.

---

## Regime States

| State | Label | Description |
|---|---|---|
| 1 | **CALM** | Low-neutral IV, term structure in deep contango, positive price momentum, VRP elevated — sellers structurally paid |
| 2 | **ELEVATED** | Mid-range IV, flattish term structure, mixed momentum, compressed VRP — edge present but reduced |
| 3 | **STRESS** | High IV, term structure flat or inverted (backwardation), negative momentum, VRP collapsed or negative — tail risk bid, short-vol dangerous |

Regimes are persistent. Require **at least 3 of 5 signals** to agree before calling a state change from a prior regime. When signals are split 3/2, note it as a **transition zone** and label the regime with `(→ ELEVATED)` or similar.

---

## Step 1 — Pull Live Data

Always fetch in this order before any computation:

```
get_market_metrics(symbols=["SPY", "QQQ", "IWM"], detail="full")
get_candles(symbol="SPY", periodMinutes=1440, daysBack=30, detail="standard")
get_candles(symbol="QQQ", periodMinutes=1440, daysBack=5, detail="summary")
get_candles(symbol="IWM", periodMinutes=1440, daysBack=5, detail="summary")
get_quote(symbols=["HYG", "JNK"], detail="standard")
get_candles(symbol="HYG", periodMinutes=1440, daysBack=20, detail="summary")
```

Then read any hook-injected signals before computing manually.

---

## Step 2 — Compute the Five Signals

### Signal 1: Vol Term Structure Ratio (VTS)

From `get_market_metrics` on SPY, extract `option-expiration-implied-volatilities`.

```
front_IV  = IV of the expiry closest to 21 DTE
back_IV   = IV of the expiry closest to 90 DTE
VTS_ratio = front_IV / back_IV
```

| Score | Regime | Threshold |
|---|---|---|
| 0 | CALM | VTS_ratio < 0.82 (deep contango) |
| 1 | ELEVATED | 0.82 ≤ VTS_ratio < 0.97 |
| 2 | STRESS | VTS_ratio ≥ 0.97 (flat or backwardation) |

> **VTS is the single most important signal.** Backwardation (VTS ≥ 1.0) has historically preceded every major vol event. Weight it 2× in the composite score.

---

### Signal 2: IV Rank (IVR)

From `get_market_metrics` on SPY: use `tos-implied-volatility-index-rank` (the 0–1 float).

```
IVR = tos-implied-volatility-index-rank × 100   (convert to 0–100%)
```

| Score | Regime | Threshold |
|---|---|---|
| 0 | CALM | IVR < 30 |
| 1 | ELEVATED | 30 ≤ IVR < 60 |
| 2 | STRESS | IVR ≥ 60 |

---

### Signal 3: VRP Spread (IV minus HV)

From `get_market_metrics` on SPY:

```
VRP_spread = implied-volatility-30-day − historical-volatility-30-day
             (both are in % points, e.g., 14.58 and 8.70)
```

| Score | Regime | Threshold |
|---|---|---|
| 0 | CALM | VRP_spread > 4 pts (sellers well-compensated) |
| 1 | ELEVATED | 1 ≤ VRP_spread ≤ 4 pts |
| 2 | STRESS | VRP_spread < 1 pt (edge near zero or negative) |

---

### Signal 4: Vol Momentum (5-Day IV Change)

From `get_market_metrics` on SPY: use `implied-volatility-index-5-day-change` (a signed float in IV units).

```
IV_mom = implied-volatility-index-5-day-change
```

| Score | Regime | Threshold |
|---|---|---|
| 0 | CALM | IV_mom < −0.01 (IV falling, vol sellers winning) |
| 1 | ELEVATED | −0.01 ≤ IV_mom ≤ +0.015 |
| 2 | STRESS | IV_mom > +0.015 (rapid IV expansion, regime shift warning) |

---

### Signal 5: Price Trend & Breadth

From SPY daily candles (30 days) and IWM 5-day candles:

```
SPY_10d_return = (close[today] − close[10 days ago]) / close[10 days ago]
IWM_5d_return  = (close[today] − close[4 days ago]) / close[4 days ago]

breadth_score:
  CALM     if SPY_10d_return > +0.015 AND IWM_5d_return > 0      (broad rally)
  ELEVATED if SPY_10d_return between −0.02 and +0.015             (range-bound)
  STRESS   if SPY_10d_return < −0.02 OR IWM_5d_return < −0.02    (broad selling)
```

IWM underperforming SPY (small caps lagging) is a secondary stress indicator — note it explicitly.

---

### Signal 6 (Optional): Credit Spread Trend (HYG)

From HYG candles:

```
HYG_10d_return = (close[today] − close[10 days ago]) / close[10 days ago]
```

| Score | Regime |
|---|---|
| 0 | CALM — HYG rising (credit spreads tightening) |
| 1 | ELEVATED |
| 2 | STRESS — HYG falling >1% over 10 days (credit spreads widening) |

Use as a tiebreaker when Signals 1–5 are split 3/2.

---

## Step 3 — Compute Composite Score and Classify Regime

```
Composite = (VTS_score × 2) + IVR_score + VRP_score + IV_mom_score + breadth_score
Max possible = 8  (VTS double-weighted)
```

| Composite | Regime |
|---|---|
| 0–2 | CALM |
| 3–5 | ELEVATED |
| 6–8 | STRESS |

**Markov persistence rule:** If the prior regime (from context or last run) was STRESS or CALM, require composite to cross into the next band by at least 1 full point before declaring a regime change. This dampens noise.

**Confidence level:**
```
Signal agreement count = how many of the 5 signals (VTS counts once for this) agree with classified state
5/5 → HIGH confidence
3–4/5 → MEDIUM confidence  
2/5 → LOW confidence (label as transition zone)
```

---

## Step 4 — Output Format

Always output in this exact block at the start of any pre-market brief or weekend report:

```
╔══════════════════════════════════════════════╗
║         REGIME FILTER  —  [DATE]             ║
╠══════════════════════════════════════════════╣
║ Regime:      CALM / ELEVATED / STRESS        ║
║ Confidence:  HIGH / MEDIUM / LOW             ║
║ Transition:  Stable / → ELEVATED / → STRESS  ║
╠══════════════════════════════════════════════╣
║ SIGNALS                                      ║
║  Vol Term Structure  [VTS ratio]  CALM ✓     ║
║  IV Rank             [IVR %]      CALM ✓     ║
║  VRP Spread          [X.X pts]    ELEVATED ~ ║
║  Vol Momentum (5d)   [±X.XX]      CALM ✓     ║
║  Price Trend (10d)   [±X.X%]      CALM ✓     ║
║  Credit Spread (HYG) [±X.X%]      CALM ✓     ║
╠══════════════════════════════════════════════╣
║ COMPOSITE SCORE:  X / 8                      ║
╚══════════════════════════════════════════════╝
```

Follow the block with a 2–3 sentence plain-English summary of what the regime means for this week's trading.

---

## Step 5 — Strategy Grade Modifiers

Apply these modifiers to every strategy letter grade issued during the session. Grade scale: A+ A A- B+ B B- C+ C C- D F.

| Strategy | CALM | ELEVATED | STRESS |
|---|---|---|---|
| VRP (systematic short-vol) | +1 tier | 0 | −1 tier |
| Pre-Earnings Expansion | +1 tier | 0 | +1 tier *(straddles cheaper in panic)* |
| Earnings Crush | +1 tier | 0 | −2 tiers *(gap risk explodes)* |
| Momentum Skew | +1 tier | −1 tier | −2 tiers |
| Forward Factor (calendar) | +2 tiers | 0 | −2 tiers *(backwardation kills FF)* |
| Supply & Demand Zones | +1 tier | 0 | −1 tier *(levels break, follow-through poor)* |
| 0DTE VRP | +1 tier | −1 tier | −2 tiers |

**Grade tier scale (for modifier math):**
```
A+ → A → A- → B+ → B → B- → C+ → C → C- → D → F
```
+1 tier = one step left; −1 tier = one step right. Never go above A+ or below F.

Example: Base grade B+, regime CALM, strategy VRP → adjusted grade A-

---

## Step 6 — EV Multipliers

When computing expected value (EV) or expected credit for any trade, multiply the raw EV by the regime factor:

| Strategy type | CALM | ELEVATED | STRESS |
|---|---|---|---|
| Short-vol (VRP, Earnings Crush, 0DTE) | × 1.20 | × 1.00 | × 0.60 |
| Long-vol (Pre-Earnings Expansion) | × 0.90 | × 1.00 | × 1.30 |
| Directional (Momentum Skew, S&D) | × 1.15 | × 1.00 | × 0.70 |
| Calendar (Forward Factor) | × 1.25 | × 1.00 | × 0.55 |

State this explicitly: "Regime-adjusted EV = $X (base $Y × Z regime multiplier)"

---

## Step 7 — Position Sizing Guidance

Regime informs the **Kelly fraction** used in the trading-strategies skill:

| Regime | Sizing guidance |
|---|---|
| CALM | Use full quarter-Kelly. Consider up to 5% per trade for highest-conviction setups. |
| ELEVATED | Use quarter-Kelly. Hold to 3–4% per trade. Reduce correlated short-vol exposure. |
| STRESS | Use eighth-Kelly or less. Max 2% per trade. Prioritize single-leg or defined-risk only. Short-vol strategies: defined risk mandatory. |

---

## When to Run This Skill

- **Pre-market brief** (Mon–Fri before open): Run full regime classification, then pass regime state into any trade evaluations for that session.
- **Weekend report**: Run with Friday's closing data, summarize weekly regime, flag any transition signals for the coming week.
- **On-demand**: When market conditions shift intraday (e.g., VIX spike, flash crash rumor), re-run Signal 1 and Signal 4 only — a quick partial update.

---

## Integration with trading-strategies Skill

When both skills are active:
1. Run Markov Regime Filter **first**.
2. Pass the classified regime state into any strategy recommendation.
3. Apply grade modifier and EV multiplier to the strategy output before presenting the final grade.
4. In the output, always show: `Base grade: X → Regime-adjusted grade: Y (CALM/ELEVATED/STRESS modifier)`
5. Include regime state in the position sizing recommendation.

If the trading-strategies hook has already injected IV environment and VRP signals, use that data — do not re-fetch. Map injected signals to regime scores using the same thresholds above.

---

## Regime Transition Warning

Flag a **⚠ TRANSITION WARNING** when:
- VTS_ratio crosses 0.97 (approaching backwardation) from below
- IV_mom > +0.02 (rapid vol expansion)
- SPY 10-day return < −3%
- Two or more signals shift from CALM to ELEVATED within 2 sessions

A transition warning means: re-evaluate all open short-vol positions for early exit or hedge; reduce new short-vol entries to half size until regime re-confirms.
