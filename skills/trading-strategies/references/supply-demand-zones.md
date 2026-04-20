# Supply and Demand Zones

## The Core Idea

Price moves because institutions leave footprints — large orders that couldn't be fully filled at a price level. When price revisits that level, the unfilled orders absorb supply or demand and cause a reaction. Supply and demand zones are those footprints. The edge is structural: you're trading where institutional order flow is concentrated, not predicting direction.

Zones are identified by four patterns — each a three-leg formation of a departure leg, a base (consolidation), and the leg that created the zone:
- **Rally-Base-Drop (RBD)** — supply zone
- **Drop-Base-Drop (DBD)** — supply zone
- **Drop-Base-Rally (DBR)** — demand zone
- **Rally-Base-Rally (RBR)** — demand zone

Zone strength is scored (0–1) across seven factors: departure quality (candle count, range vs. ATR, volume ratio, time at level), price position, freshness, timeframe, and risk/reward. Higher confidence = more institutional conviction left at that level.

## Why Zones Work

- Institutions can't fill massive orders in one candle. The base is where they layered in; unfilled interest remains when price leaves explosively.
- Price returning to a zone encounters the same order flow that created it. Absorption at the proximal line is the trade.
- Freshness matters — a zone never retested is more potent than one that has already absorbed a visit. Each touch weakens the zone.
- Higher-timeframe zones carry more weight. A weekly demand zone trumps a 5-minute one.

## Zone Anatomy

- **Proximal line** — the near edge of the zone (derived from candle bodies). This is the level price approaches first and where entries are anchored.
- **Distal line** — the far edge (full wicks). This is the invalidation boundary; price closing through it means the zone is consumed.
- **Zone width** — proximal to distal. Stop distance is this width plus a buffer.

## Trade Construction Philosophy

Zones are a *location framework*, not a rigid system. The zone tells you where price is likely to react; your instrument and market context determine how you express it.

### Directional Plays — Bracket / Limit Orders

The cleanest expression of a zone trade, especially on a fresh zone when price hasn't yet returned:

- **Entry**: limit order 1–2 ticks in front of (above, for demand; below, for supply) the proximal line. You want to be filled on the first touch, not chasing into the zone.
- **Stop**: just beyond the distal line. A close through the distal invalidates the zone; the stop reflects that.
- **Target**: the proximal line of the nearest opposing zone is the natural target — this is the `targetPrice` on the zone object. Use it as your profit objective.
- **Bracket the trade**: set entry limit, stop, and target simultaneously. The best fills come from zones in strong trending markets where price is approaching rapidly.

Works across equities, crypto, and futures. The mechanics are the same; only tick size and margin differ.

### Options — Spreads at the Zone

When IV conditions favor premium selling, zones give spreads a structural anchor:

- **Credit spreads at supply** — sell a call spread with the short strike at or just above the supply proximal line. The zone provides a structural ceiling; the VRP edge provides the vol mispricing edge. Both tailwinds align.
- **Credit spreads at demand** — sell a put spread with the short strike at or just below the demand proximal line. Same logic inverted.
- **Debit spreads into momentum** — when price is departing a fresh zone with strong momentum, momentum skew signals apply. Buy the ATM, sell the OTM wing in the departure direction. Zone freshness replaces some of the skew-signal burden.
- Zone boundaries define strike placement naturally: proximal = short strike anchor, distal = a reference for how wide to go.
- Duration: 7–21 DTE aligns well with most zone trades; longer if the zone is on a higher timeframe.

### Options — Long Options Inside the Zone

When price enters a zone, uncertainty is high — the zone either holds or fails. Defined-risk long options are appropriate:

- Buy an ATM or near-ATM call (demand zone) or put (supply zone) as price enters the proximal line.
- The zone provides a clear stop level: if price closes through the distal, the thesis is wrong.
- Use the zone width as a guide for selecting expiration — a narrow zone on a fast-moving asset resolves quickly; a wide higher-timeframe zone may need more time.
- Avoid buying far-OTM options here; you need delta to monetize the zone reaction, not lottery exposure.

## Signal Evaluation Checklist

Before committing to a zone trade, assess:

| Factor | What to check |
|---|---|
| **Confidence score** | ≥ 0.65 preferred. Below 0.50 requires supporting context. |
| **Freshness** | First test of a zone is the strongest. Multiple touches degrade reliability. |
| **Timeframe** | Higher timeframe = more weight. A daily zone can override an intraday setup. |
| **Zone alignment** | Is the zone in context? Demand zones work best in uptrends; supply zones in downtrends or at structural highs. |
| **Departure quality** | Strong explosive/decisive candles leaving the zone = more unfilled interest. |
| **R:R score (rrScore)** | ≥ 0.6 preferred (roughly 3:1). Use `targetPrice` (nearest opposing zone proximal) to validate. |
| **Proximity** | Price approaching from outside, not already inside. Fresh approach > zone re-entry. |
| **Opposing zone** | Is there a supply zone nearby above (for demand)? Tight opposing zones compress the trade. |

## Sizing

- Same fractional Kelly framework as other strategies: 2–8% of portfolio, 4% default.
- For bracket trades with a defined stop: size to risk 1–2% of net liq on the stop distance.
- For spreads at zones: max loss = debit or width minus credit; size accordingly.
- Reduce size on lower-confidence zones or when already holding a correlated position.

## Trade Management

**Bracket Orders — Zone Wick vs. Close**
- If price wicks through the proximal line but does not close through it, the bracket order is expected to fill on that touch — the zone is not invalidated by a wick
- The zone is only invalidated when price closes through the distal line; only then cancel or reassess

**Credit Spreads at Zones — Management**
- If price closes through the distal line, close the spread immediately — the zone thesis is invalidated
- Otherwise, manage using the same rules as VRP: take profit at 50% of credit, stop loss at 2× credit, roll the untested side if one side is tested and conditions remain favorable

**Long Options Inside the Zone — Slow Resolution**
- Size the position and stop such that the debit paid is the built-in stop loss
- If the zone has not resolved after several days and theta is burning, hold to expiration — do not exit early based on time alone
- Exit only if price closes through the distal line (zone invalidated) or the option expires worthless

## What Invalidates a Zone

- Price closes through the distal line on significant volume — zone is consumed.
- Zone has been tested 3+ times — absorption is likely complete.
- A higher-timeframe zone in the opposite direction sits directly overhead (for demand) or below (for supply).
- Fundamental catalyst changes the supply/demand balance at that price level.

## Integration with Other Strategies

Supply and demand zones are a location filter, not a standalone system. They layer naturally onto the other strategies in this playbook:

- **VRP at zones**: sell premium where structural support or resistance coincides with elevated IV. The zone anchors strike selection; VRP provides the vol edge.
- **Momentum Skew at zones**: when a fresh zone produces a strong departure leg, skew conditions often follow (momentum + elevated OTM IV on the departure side). Zone + skew alignment is a high-conviction setup.
- **Earnings plays near zones**: a demand zone beneath a stock heading into earnings can inform strike selection for bull put spreads or directional straddles. Note the zone; let it inform structure.

