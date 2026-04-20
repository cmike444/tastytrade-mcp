# Momentum Skew (Skewed Vertical Spreads)

## The Core Idea
Buy fairly-priced ATM option, sell overpriced OTM option in the direction of momentum. This is a **relative value trade** — the edge comes from skew mispricing, not direction. Momentum alignment improves win rate on top.

## Why Skew Gets Mispriced
- Institutional hedgers persistently buy OTM puts (protection) → put skew premium
- Retail speculators buy OTM calls in momentum names (lottery tickets) → call skew premium
- Sellers demand compensation → structurally elevated OTM IV

## Screening

Scan your watchlist or available instruments for stocks exhibiting both strong momentum and elevated OTM skew. Key filters:
- Put or call skew z-score ≤ −1.5 (more negative = steeper skew relative to that name's history)
- Momentum in the direction of the overextended skew (see momentum signal thresholds below)
- Options volume ≥ 5,000 contracts/day minimum; prefer ≥ 20,000 for easy execution

## Three Things That Must Align

**1. Skew z-score ≤ −1.5 (from screener) / −2.0 (for high confidence)**
Track `(ATM IV − OTM IV) / ATM IV` over time. When 2+ std devs below mean, the wing is historically extreme and likely overpriced.

**2. IV vs. RV check**
- Short leg (OTM): IV >> realized vol → overpriced ✓
- Long leg (ATM): IV ≈ realized vol → fairly priced ✓

**Fair value check**: price spread at constant vol = recent realized vol. If fair value > market price → positive edge on the spread.

**3. Momentum alignment (multi-factor confluence)**
- Time-series momentum (TSMOM): negative for put skew trades, positive for call skew trades
- Cross-sectional momentum: ≤ 3 for put skew, ≥ 8 for call skew (decile rank vs. all stocks)
- Relative momentum vs. S&P 500: < 1 for put skew, > 1 for call skew
- **Turnover** (volume / shares outstanding): high turnover confirms institutional/retail interest is driving the move and tends to carry forward — use as additional corroboration
- **Proximity to 52-week high**: stocks near their 52-week high have shown stronger forward momentum; stocks well below it are better candidates for put skew trades
- Strongest setups appear at top of multiple momentum metrics — confirms broad, persistent strength, not a one-day pop

## Trade Structure

### Primary: Asymmetric Vertical Spread

| Component | Target |
|---|---|
| Long leg | 45–60 delta (ATM or slightly OTM) |
| Short leg | 10–25 delta (OTM wing — the skew-harvesting leg) |
| Duration | 10–20 calendar days |
| Exit before earnings | Always — unless you have a specific directional earnings thesis |

**Bullish setup** (call skew elevated + positive momentum): buy call 45–60Δ, sell call 10–25Δ
**Bearish setup** (put skew elevated + negative momentum): buy put −45 to −60Δ, sell put −10 to −25Δ

Reward-to-risk: 5:1 to 10:1 in steep skew. Win rate ~30–35% is normal and correct — judge by expected value, not win rate.

### Alternative: 1-3-2 Ratio Fly

A higher-conviction, higher-payout structure. Aggressively harvests skew by being net short one extra unit of OTM vol.

**Structure:**
- Buy 1 ATM option (~50Δ)
- Sell 3 OTM options (20–30Δ strike)
- Buy 2 further OTM options (protective wing)

**Critical:** Strike spacing — distance from strike 1 to strike 2 should be **2× the distance from strike 2 to strike 3** to balance the position.

*Example bullish 1-3-2 (stock at $99):*
- Buy 1 $100 call
- Sell 3 $110 calls ($10 gap from first strike)
- Buy 2 $115 calls ($5 gap from second strike)

**When to use:** Moderate momentum conviction — cross-sectional momentum 7–8 for calls (3–4 for puts). Best for steady, controlled moves toward a target rather than explosive runaway trends. Can be used alongside standard verticals as a "lotto ticket" add-on for a specific pin scenario.

**Payout potential:** Max profit if underlying pins the short strike at expiry — can be 20–30x in ideal conditions.

**Risk:** The "Goldilocks" problem — too little move = OTM, too big a move = loss beyond the long wing. You can be right about direction and still lose.

## Post-Trade Management

**Base Case: Let the Trade Run**
- The position is defined risk (max loss = debit) — the debit paid is the built-in stop loss; no additional stop needed
- Allow theta and skew mean-reversion to work; hold to expiration if the spread goes OTM
- Close at **90%+ of max profit** to lock in the gain rather than holding for the last few percent
- If the spread is out-of-the-money near expiration, let it expire worthless — no need to pay commissions to close a near-zero position; do not roll to the next cycle

**Momentum Reversal Exit**
- If the momentum signal that justified the trade flips and the stock continues running in the opposite direction, close the position for a scratch or small loss
- A single day of reversal is not sufficient — wait for the signal to flip and continue before exiting

**Earnings — The Critical Exception**
- This strategy is NOT designed to hold through earnings — gap risk is fundamentally different from the statistical skew mispricing being harvested
- **Rule:** If an earnings announcement is scheduled during the life of the spread and you do not have a specific directional thesis on the event, close the position before the report
- Holding through earnings without a directional thesis invalidates the trade

## Real Trade Examples

| Ticker | Structure | Debit | Max Profit | Return |
|---|---|---|---|---|
| QUBT | Jun $14.50/$20 call spread | $90 | $460 | 380% |
| SBET | Jul $24/$32 call spread | $140 | $660 | 280% |
| MP | Jul $49/$55 call spread | $120 | $480 | 400% |
| QS | Jul $11.50/$16 call spread | $80 | $370 | 160% |

## Sizing

**Vertical spreads:** 0.5–2% of strategy capital per trade (max loss = debit)
- Example: $25k allocated to strategy → each spread costs $125–$500 max
- At 4% of total portfolio default: keep each trade debit small relative to account

**1-3-2 Fly:** Same sizing discipline — the higher payout potential means you can use even smaller position sizes and still have meaningful upside

Expect losing streaks. Consistent small sizing is what keeps you in the game long enough for positive EV to emerge. A ~32% win rate with proper sizing can be highly profitable.
