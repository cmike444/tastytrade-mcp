# 0DTE VRP — Systematic Premium Capture

## Core Philosophy: "Math Makes Money"
- **Probability over prediction** — decisions are based on backtested statistical edges, not directional conviction
- **High frequency** — target up to 30,000 trades/year to let the law of large numbers play out
- **Target capture** — retain **25% of total premium sold** across all trades

---

## Asset Universe
Any underlying with daily options liquidity:

| Type | Symbols |
|---|---|
| Indices | SPX, NDX |
| Futures Options | /ES, /MES, /NQ, /MNQ |
| ETFs | SPY, QQQ, IWM |

---

## Infrastructure & Integration
- **Pre-session / pre-trade:** Query MCP tools for current **Net Liq** and available buying power before every session and trade entry
- **Backtesting:** Use Tastytrade Backtesting software; export trade logs for AI analysis to verify positive EV
- **Execution:** Automated bracket orders (OCO/OTO) — removes human emotion from execution

---

## Risk Management — Circuit Breakers

### Portfolio Stops
| Horizon | Loss Threshold | Action |
|---|---|---|
| Daily | $250 realized/unrealized | Halt all 0DTE trading for the day |
| Weekly | $1,500 cumulative | Halt all 0DTE trading for the remainder of the week |

**No exceptions.** If the daily stop is hit, do not enter new 0DTE trades regardless of signal quality.

### Capital Efficiency
- **Spread width:** 50–150 points to maximize BPR efficiency
- **Long leg ("first nickel"):** Buy the $0.05 long leg on every spread — defines max risk and minimizes premium drag

---

## Economic Event Blackout

**No 0DTE VRP trades on days with scheduled high-impact economic reports.** The statistical edge of systematic premium capture assumes normal intraday volatility distribution. High-impact events create outsized, directional vol spikes that invalidate the MECH and EMA setups and frequently blow through stop levels.

### Blackout Events (Hard Skip — No Exceptions)
| Category | Examples |
|---|---|
| Federal Reserve | FOMC Rate Decision, FOMC Minutes, Fed Chair press conference |
| Inflation | CPI, Core CPI, PPI, Core PPI, PCE, Core PCE |
| Employment | NFP (Non-Farm Payrolls), ADP Employment, Jobless Claims (when elevated) |
| GDP | Advance GDP, GDP revision |
| Other high-impact | ISM Manufacturing/Services (when near 50 inflection), Retail Sales |

### Pre-Session Check (Required)
Before every 0DTE session, check the economic calendar for same-day high-impact releases:
- If **any** blackout event is scheduled for that trading day → **skip all 0DTE VRP trades for the entire day**
- This applies regardless of signal quality, IV rank, or current P&L
- Sources: Federal Reserve calendar (federalreserve.gov), BLS release calendar, CME economic calendar

### Rationale
- FOMC/CPI days historically show 2–4× normal realized volatility for SPX/NDX
- Premium sold prior to the event is frequently overwhelmed by the move
- The short-leg-only stop-market order does not protect against gap-through moves at the open of the announcement window

---

## Trade Setups

### Setup 1: MECH (Multiple Entry Iron Condor)
- **Structure:** Simultaneously sell a Put Credit Spread + Call Credit Spread
- **Entry:** Specific "high-probability" minutes identified by backtesting
- **Pricing:** Target a fixed premium on the **short leg only** (e.g., $1.00 or $2.00)

### Setup 2: EMA (Trend-Following Spread)
- **Indicators:** 20-min EMA and 40-min EMA
- **Logic:**

| Condition | Action |
|---|---|
| 20-EMA > 40-EMA | Sell Put Credit Spread (bullish bias) |
| 20-EMA < 40-EMA | Sell Call Credit Spread (bearish bias) |

---

## Execution & Exit Protocols

### Short-Leg-Only Stop
Stop-loss is a **single-leg stop-market order on the short leg only**, resting on the exchange book (minimizes slippage):

```
Stop Price = (Stop-Loss % × Premium Received) + Premium Received
```

*Example:* Short leg sold for $2.00, 100% stop → stop-market triggers at $4.00

### Bracket Orders (OCO)
Every entry uses a bracket:
1. **Profit target** — AI-optimized level (e.g., 50% of premium received)
2. **Stop loss** — calculated via short-leg formula above

### Time-Based Hard Exit
Close or expire all 0DTE positions **15–30 minutes before market close**. Avoids:
- Strike pinning risk
- After-hours assignment / volatility
- Liquidity gaps in the final minutes

---

## AI Optimization Loop (ATM Engine)
AI analyzes Tastytrade trade logs to continuously refine the strategy:

| Signal | Description |
|---|---|
| Sequential Risk | Is a specific entry time/setup improving or deteriorating over the last 125 trading days? |
| Momentum of Change | Rate at which win rates and profit factors are shifting |
| Drawdown Filter | Prioritize trade sets that keep total portfolio drawdown below 10% |

---

## Intraday Management Rules

**One Side Tested (IC)**
- If one side of the iron condor is breached intraday, close only the tested spread — do not close the untested side
- Let the untested spread continue to run toward its profit target or expire

**EMA Crossover Mid-Trade**
- If the 20/40 EMA flips mid-trade while a spread is on, hold the position and let it play out — do not exit based on the EMA flip alone
- The spread has defined risk; the EMA signal applies to new entries, not active positions

**Circuit Breaker Reset**
- The weekly $1,500 limit resets on Sunday, allowing a fresh start on Monday for the new week
- Daily $250 limit resets each morning at market open

**Partial Fills**
- If one leg of a spread fills and the other does not, adjust the order price within reason to complete the spread
- If unable to complete at a reasonable price, a single-leg spread with defined risk is acceptable — do not close the filled leg prematurely due to execution issues
- Never hold a naked short leg — if the spread cannot be completed and the filled leg creates naked short exposure, close it

## Implementation Notes for AI Agents
1. **Always query MCP** for Net Liq before calculating contract size
2. **Tag all trades as "0DTE"** so $250/$1,500 circuit breakers are correctly applied
3. **Adjust for multipliers** — /ES, /MES, /NQ, /MNQ contract counts must account for respective tick values and notional sizes
4. **No exceptions** — daily stop hit means no new 0DTE trades, regardless of signal
5. **Check economic calendar** — before recommending or entering any 0DTE trade, verify no high-impact economic event (FOMC, CPI, NFP, PCE, PPI, GDP) is scheduled for that day; if one is, decline the trade entirely
