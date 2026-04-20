# Volatility Analysis Reference

## Key Metrics and Where to Get Them

| Metric | MCP Tool | Field |
|---|---|---|
| IV Rank (IVR) | `get_market_metrics` | `implied-volatility-index-rank` |
| IV Percentile | `get_market_metrics` | `implied-volatility-percentile` |
| Current IV (30d) | `get_market_metrics` | `implied-volatility-index` |
| Historical Vol (HV) | Compute from `get_candles` | See formula below |
| Option IV by strike | `get_options_greeks` | `implied-volatility` |
| Greeks | `get_options_greeks` | delta, gamma, theta, vega, rho |

---

## Implied Volatility Rank vs Percentile

**IV Rank (IVR)**: Where current IV sits between the 52-week low and high.
```
IVR = (Current IV − 52w Low IV) / (52w High IV − 52w Low IV) × 100
```
- IVR > 50 → elevated vol, consider selling
- IVR < 30 → depressed vol, consider buying

**IV Percentile**: Percentage of days in the past year where IV was lower than today.
- More robust than IVR when vol has had brief spikes
- IVP > 50 → more selling candidates

**Interpretation:**
- IVR ≥ 50 AND IVP ≥ 50 → strong sell vol signal
- IVR ≤ 25 AND IVP ≤ 25 → consider buying vol or calendars
- Divergence between IVR and IVP → investigate recent IV spike/crush

---

## Historical Volatility Calculation

From daily OHLCV candles (`get_candles`):
```python
import numpy as np, pandas as pd

def historical_vol(closes, window=21):
    log_returns = np.log(pd.Series(closes)).diff().dropna()
    hv = log_returns.rolling(window).std() * np.sqrt(252) * 100
    return hv.iloc[-1]
```

**VRP signal**: If IV − HV > 5 points → vol risk premium exists → selling edge.

---

## IV Skew Analysis

**Skew** = difference in IV between OTM puts and OTM calls at same delta distance.
- Negative skew (puts more expensive than calls) is normal in equity markets
- Extreme negative skew → market pricing crash risk → consider put spreads over naked puts
- Flat or positive skew → unusual, could signal short squeeze potential

**To analyze skew:**
1. `get_compact_option_chain` for target symbol and nearest monthly expiry
2. Pipe through `scripts/filter_chain.py --mode skew` → extracts IV by strike
3. Run `scripts/iv_curve.py` → plots the IV smile

**Key strikes to focus on:**
- 16 delta put (1 SD OTM)
- 30 delta put
- 50 delta (ATM)
- 30 delta call
- 16 delta call (1 SD OTM)

---

## Term Structure Analysis

IV varies across expiration dates. The relationship forms the **term structure**.

**Normal (contango)**: Front IV < Back IV
- Back months price in more uncertainty over time
- Calendars are typically low-cost in contango

**Inverted (backwardation)**: Front IV > Back IV
- Elevated near-term fear or event vol
- Calendar spreads are expensive (debit heavy)
- Short front-month options are richly priced

**Forward Volatility (Forward Factor):**
```
Forward IV (t1 → t2) = sqrt((IV₂² × t2 − IV₁² × t1) / (t2 − t1))
```
- Forward Factor (FF) = Forward IV / Back-month IV
- FF ≥ 1.2 → front month is pricing implied move well above forward expectation → calendar opportunity
- FF < 0.8 → back month is cheap relative to front → diagonal or ratio spread

**To analyze term structure:**
1. `get_nested_option_chain` for the symbol (saves full expiry tree)
2. Pipe through `scripts/filter_chain.py --mode term` → ATM IV per expiry
3. Run `scripts/term_structure.py` → plots IV curve + computed forward vols

---

## Volatility Surface

The full IV surface is a 3D grid of strike × expiry × IV.

**Use cases:**
- Identify rich/cheap strikes across the surface
- Spot calendar spreads where near-term IV >> back-term IV for same strike
- Identify skew vs. smile shapes that suggest directional bias

**Surface data pipeline:**
1. `get_nested_option_chain` → full chain
2. `scripts/filter_chain.py --mode surface` → outputs strike/expiry/IV matrix
3. `scripts/term_structure.py --mode surface` → 3D surface plot

---

## Volatility Regime Classification

| IVR | HV | Regime | Best Strategy |
|---|---|---|---|
| > 50 | < IV | Rich vol | Sell straddles / strangles / iron condors |
| > 50 | > IV | Event fear | Sell spreads (defined risk only) |
| 25–50 | ≈ IV | Neutral | Vertical spreads, calendars |
| < 25 | < IV | Cheap vol | Buy calendars, long straddles before events |
| < 25 | > IV | Trending | Directional spreads, avoid short gamma |

---

## Greeks Reference

| Greek | Meaning | Typical concern |
|---|---|---|
| Delta | Directional exposure ($change per $1 move) | Keep portfolio delta near-neutral for vol strategies |
| Gamma | Rate of delta change (accelerates near expiry) | High gamma = risk on short options near expiry |
| Theta | Daily time decay (positive for sellers) | Target 0.1–0.5% of net liq per day |
| Vega | Sensitivity to IV change ($change per 1% IV move) | Short vega = profits when IV falls |
| Rho | Sensitivity to interest rate change | Small for short-dated options |

**Portfolio Greeks check:**
- `get_positions` → pull all option positions
- Compute net portfolio delta, theta, vega
- Rebalance if portfolio delta > ±0.1 × net liq equivalent

---

## Directionality and Momentum

Check before entering any position:
1. `get_candles` (daily, 90 days) → compute 20d and 50d SMA
2. `get_market_metrics` → IV rank and current IV
3. Assess: is the underlying trending, mean-reverting, or range-bound?

**Framework:**
- Strong trend + high IV → consider OTM credit spread in trend direction (capture premium + directional edge)
- Strong trend + low IV → consider debit spread or long vertical in trend direction
- Range-bound + high IV → iron condor / short strangle
- Range-bound + low IV → long straddle (wait for breakout)
