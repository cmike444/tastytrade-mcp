# Earnings Volatility Crush

## The Trade
Sell vol INTO earnings. Enter 15 min before close the day before. Exit 15 min after open the next morning. Profit from IV crush and stock moving less than implied.

## Why It Works
- Institutional hedgers buy puts regardless of price (price-insensitive demand)
- Retail speculators buy OTM calls hoping for big moves (lottery-ticket demand)
- Market makers bias premiums higher to compensate for gap risk they can't hedge dynamically
- Combined effect: options are systematically overpriced into earnings — the edge is statistical, not about predicting direction

The edge requires **diversification across many earnings events**. Any single trade can result in a stock moving far beyond the implied move. The law of large numbers works in your favor only at scale.

## Candidate Screening

**Step 1: Find tonight's announcements**
Use an earnings calendar on any platform or broker to identify stocks announcing **after today's close / before tomorrow's open** — this captures peak pre-earnings IV with clean overnight exposure.

**Step 2: Liquidity filters (non-negotiable)**
- Average daily option volume ≥ 10k (or presence of weekly contracts as a proxy)
- Acceptable bid-ask spread on the ATM options you're considering — excessive spread erodes edge

**Step 3: Stock price filter**
- For most retail traders: stocks under $100–$150
- Higher-priced stocks have proportionally larger margin requirements and dollar risk per contract

## Two Structures

**Short Straddle**: sell ATM call + put, same expiry. Higher returns, lower commissions. Fat left tail risk (1% of trades: 130%+ losses). Use only if you can absorb tail risk.

**Long Calendar (preferred)**: sell front-month ATM, buy back-month ATM (~30-day gap). Max loss = debit paid. 28% std dev vs 48% for straddle. Preferred for sustainability.

## Three Signals (all must pass for "Recommended")

| Signal | Direction | Why |
|---|---|---|
| Term structure slope (front − 45-day) | MORE NEGATIVE = better | Backwardation = near-term IV priced rich for the event |
| 30-day avg options volume | HIGHER = better | More price-insensitive flow inflating premium |
| IV30 / RV30 ratio | HIGHER = better | IV more overpriced vs recent realized |

- All 3 pass → **Recommended** — take the trade
- 2 pass (including slope) → **Consider**
- Slope fails → **Void** — skip regardless

**Historical context check:**
- Compare current implied move to: (a) avg realized move over past 8–12 quarters, (b) avg implied move over past earnings
- Best setup: current implied move is *significantly higher* than average historical realized move
- Check **VDR (Volatility Deviation Ratio)** across past earnings: `avg(actual vol on earnings day + day after) ÷ (implied vol before × implied vol after)`. VDR consistently < 1 means options have historically overpriced this stock's earnings — a strong green light for selling
- Confirm: short straddle backtest for this stock over past earnings shows consistently positive average P&L (options have historically been overpriced into earnings)

**Exception — when to go long:**
If current implied move is very low relative to the stock's historical realized moves, a long straddle/strangle may be warranted. Less common but valid when IV seems genuinely underpriced.

## Entry / Exit

| | Rule |
|---|---|
| Entry | 15 min before close, day BEFORE earnings |
| Exit | 15 min after open, day AFTER earnings |
| Do NOT hold to close next day | PEAD (post-earnings drift) risk |

## Exit & Post-Earnings Management

**Primary Rule: Close the Morning After**
Close your entire position the morning after earnings are announced. Do not hold longer hoping for a better price — the primary edge (IV crush) happens very quickly. The only exception is a specific, separate directional thesis unrelated to the vol trade.

**Navigating the Open — Exit Fills**
- Expect wide spreads right at the open — market makers are reacting to news, order books are thin
- **Do NOT panic-close at the open** — you will give back a large chunk of profit (or worsen a loss)
- Wait 15–20 minutes after the open; spreads typically tighten significantly as volume comes in and algorithms adjust

**Closing the Position**
- *Ideal*: close the entire spread as a single multi-leg order (buy back short straddle + sell long wings together)
- *Legging out (if necessary)*: if long wings are worth only $0.01–$0.02 and the full spread has poor liquidity, close the short straddle first, then close or let the long wings expire
  - While legging, you have brief unhedged exposure — be aware
  - If the cost to close long wings (commission + spread) exceeds their value, letting them expire worthless is acceptable
  - Exception: if the stock has gapped significantly and could reach the long wing strikes, keep them — they could still pay off, and auto-exercise risk applies if the stock settles near those strikes

**Scenario 1: Stock Near Short Strikes, IV Still Elevated**
- The stock moved less than expected and IV hasn't fully crushed yet
- Consider holding into the first 1–2 hours of the session (not the full day)
- Reason: significant Vega remains near ATM; residual IV bleed + continued theta work in your favor

**Scenario 1b: Stock Gapped Hard but Spreads Are Wide at Open**
- Still wait the 15–20 minutes for spreads to tighten — even on a large gap
- If the stock continues to run hard after the open and is still moving strongly, close the trade — don't hold hoping for a reversal
- The rule is patience for liquidity, not patience through continued adverse movement

**Short Straddle — Tail Risk Stop**
- Stop loss at **2× credit received** — close the position if losses reach this level regardless of the situation

**Calendar — Front Month Expires Worthless**
- If the front month expires worthless and the stock has not moved, close the entire trade — do not attempt to sell a new front month to recreate the calendar
- The original earnings vol thesis has played out (or failed); the back-month long is now a naked long option with no structural thesis to support carrying it

**Scenario 2: Stock Gapped Hard (Far from Short Strikes)**
- Short straddle is deep ITM on one side, far OTM on the other; Gamma and Vega are now negligible
- The vol play is over — P&L is now driven by intrinsic delta
- **Prioritize closing the full position promptly**
- PEAD risk: stocks with large earnings surprises often continue drifting in the same direction — a large residual delta position caught in that drift can quickly erode profits or magnify losses
- Action: neutralize delta and close the full position before PEAD takes hold

**Risk Acknowledgment**
- This is a high-risk strategy — individual stock moves can be extreme and unpredictable
- Expect losing trades and losing streaks; drawdowns are part of the plan
- The edge plays out over many trades at scale — position sizing and psychological fortitude to hold the plan through bad runs are prerequisites

## Sizing
- Calendar: 10% Kelly = ~6% per trade
- Straddle: 30% Kelly = ~2% per trade
- Monte Carlo (calendar, 10% Kelly, 10yr): mean $6M from $10k, 90% CAGR, 3.5 Sharpe

## Real Example: Amazon
All 3 signals met → Feb 7/Mar 7 call calendar, $3.33 debit → stock moved 2.5% (below implied) → $9,300 profit on 100 contracts
