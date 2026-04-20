# Pre-Earnings Volatility Expansion

## The Trade
Buy ATM straddle ~14 days before earnings. Exit BEFORE the announcement. Never hold through the event.

## The IV Ramp Is NOT the Edge
IV rising into earnings is mechanical math — ambient days drop out, annualized IV rises to pack the same event variance into fewer days. But total future variance you can monetize is shrinking. The straddle bleeds.

**Real edge**: betting the *implied move* (event vol component) gets repriced higher. Not the ramp — the market reassessing how big this specific gap might be.

## Four Signals (negative relationship — smaller = better)

| Signal | Formula | Weight |
|---|---|---|
| Implied vs. last implied ratio | current implied move ÷ prior earnings implied move | High |
| Implied vs. last realized gap | current implied move − last realized move | Medium |
| Implied vs. avg past implied ratio | current implied move ÷ avg historical implied move | High |
| Implied vs. avg past realized gap | current implied move − avg historical realized move | Medium |

**Dropped**: raw current implied move (unstable), skew slope (noisy/parabolic).

The two ratio signals carry more weight than the gap signals.

## Decision Rules

| Score | Action |
|---|---|
| 4 GREEN | YES — normal size (2–4%) |
| 3 GREEN, 1 YELLOW | YES — slightly reduced size (2–3%) |
| 2 GREEN, 2 YELLOW | YES if both *ratio* signals green — small size (1–2%) |
| 1 or fewer GREEN | NO — skip |

**Always give a definitive YES or NO.** Weigh the signals, commit.

## Entry / Exit
- Universe: ≥20k avg daily options volume
- Entry: ~14 days before earnings (±4 day tolerance)
- Structure: ATM straddle, nearest monthly expiry AFTER earnings
- **Exit: BEFORE the earnings announcement** (same day or day before)

## Trade Management

**Early Profit Exit**
If the implied move reprices to your target in fewer days than expected (e.g., 3 days instead of 14), take the profit and close early. Don't wait — the edge has been realized.

**Earnings Date Shift**
Companies sometimes pre-announce or move their earnings date. If the date shifts:
- New earnings date is still ≥ 18 days away → keep the trade on, the entry window is intact
- New earnings date is < 18 days away → close the position; the 14-day entry window is now violated and the trade thesis no longer applies

**Stop Loss (Theta + IV Collapse)**
The straddle bleeds theta by design, but if IV is also collapsing rather than expanding:
- Stop loss at **50% of debit paid** — exit immediately if the position loses half its value
- If IV is behaving normally (flat or rising) and only theta is decaying, hold until right before the earnings announcement as planned

## Sizing
- 2–6% Kelly fraction per trade
- Spread across multiple names
- Expect many small losses, occasional large winners — 42% win rate after filtering

## Backtest
21,500+ trades (2009–present). Filtered model: mean return 0.3% → 3.3%, win rate 37% → 42%.
