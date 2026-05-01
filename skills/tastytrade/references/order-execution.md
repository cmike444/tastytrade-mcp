# Order Execution Reference

## Core Rules

- **Price sign**: negative = debit (you pay to open), positive = credit (you receive to open)
- **JSON keys use dashes**: `instrument-type`, `time-in-force`, `order-type` (not underscores)
- **ALWAYS run a dry run first** — use `order_dry_run` for single-leg simple orders; use `complex_order_dry_run` for multi-leg orders (spreads, condors, straddles, calendars) and Net Debit / Net Credit types
- **Never skip the startup sequence** — account balances + positions + live orders before every order

---

## Short-Premium Entries Require OTOCO

Every trade that opens a **net short premium position** must be placed as an OTOCO order. The entry trigger and both bracket legs (profit target + stop loss) must be live simultaneously the moment the position opens. Placing the entry alone and adding brackets manually after fill is not acceptable.

**Covered by this rule** (all placed as OTOCO):
- VRP: short strangle, short straddle, iron condor
- Earnings Crush: short straddle, iron butterfly
- Supply and Demand Zones: credit call spread, credit put spread at zones
- 0DTE VRP: iron condor (MECH and EMA setups)

**Bracket levels differ by structure:**

| Structure | Profit target | Stop loss | Detection |
|---|---|---|---|
| Short strangle | 50% of credit | 2× credit | STO call and put at different strikes |
| Iron condor | 50% of credit | 2× credit | STO at different strikes + BTO wings |
| Short straddle | 25–35% of credit | 1.5× credit | STO call and put at the same strike |
| Iron butterfly | 25–35% of credit | 1.5× credit | STO at same strike + BTO wings |
| 0DTE iron condor | OTOCO required | Time-based close (~2 h after entry) | Expiry = today |

Close prices are **negative** in the order JSON (you pay a debit to buy back a short). Example: sold strangle for $5.50 credit → profit target LIMIT price = −$2.75 (50%); stop LIMIT price = −$11.00 (2×).

**Exempted from this rule** (debit structures — no bracket required):
- Forward Factor: long calendar spread (debit; no OTOCO — hold to front-expiry day instead)
- Pre-Earnings Expansion: long ATM straddle (debit with 50%-of-debit stop managed as a GTC limit)
- Momentum Skew: asymmetric vertical spread (debit; max loss = debit paid)
- Earnings Crush: long calendar (debit; GTC close on front-expiry day)
- Supply and Demand Zones: debit spread into momentum; single long option inside zone

---

## Action Values

| Action | When to use |
|---|---|
| `Buy to Open` | Opening a new long position (equities, options) |
| `Sell to Open` | Opening a new short position (equities, options) |
| `Buy to Close` | Closing a short position |
| `Sell to Close` | Closing a long position |
| `Buy` | Futures and cryptocurrencies only |
| `Sell` | Futures and cryptocurrencies only |

---

## Order Type Values

| order-type | Description |
|---|---|
| `Limit` | Execute at specified price or better |
| `Market` | Execute at best available price (use with caution on options) |
| `Marketable Limit` | Limit that executes immediately at market |
| `Stop` | Trigger market order when price crosses stop-trigger |
| `Stop Limit` | Trigger limit order when price crosses stop-trigger |
| `Notional Market` | Market order by dollar value (use `value` field instead of `price`) |

---

## Time-in-Force Values

| Value | Description |
|---|---|
| `Day` | Expires at end of trading session |
| `GTC` | Good-Till-Cancelled |
| `GTD` | Good-Till-Date (add `gtc-date: "YYYY-MM-DD"`) |
| `Ext` | Extended hours session |
| `GTC Ext` | GTC with extended hours |
| `IOC` | Immediate-or-Cancel (crypto only) |

---

## Single-Leg Order Templates

### Equity (stock)
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": -185.50,
  "legs": [
    {
      "instrument-type": "Equity",
      "symbol": "AAPL",
      "action": "Buy to Open",
      "quantity": 10
    }
  ]
}
```

### Equity Option (OCC symbol format)
OCC format: `SYMBOL YYMMDD[C/P]STRIKE` with strike zero-padded to 8 digits × 1000
Example: AAPL Jan 19 2024 $150 call → `AAPL 240119C00150000`
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 3.50,
  "legs": [
    {
      "instrument-type": "Equity Option",
      "symbol": "AAPL 240119C00150000",
      "action": "Sell to Open",
      "quantity": 1
    }
  ]
}
```

### Future
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": -4850.00,
  "legs": [
    {
      "instrument-type": "Future",
      "symbol": "/ESM4",
      "action": "Buy",
      "quantity": 1
    }
  ]
}
```

### Future Option
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 25.00,
  "legs": [
    {
      "instrument-type": "Future Option",
      "symbol": "./ESM4 EW1M4 240119C4800",
      "action": "Sell to Open",
      "quantity": 1
    }
  ]
}
```

### Cryptocurrency
```json
{
  "time-in-force": "IOC",
  "order-type": "Limit",
  "price": -65000.00,
  "legs": [
    {
      "instrument-type": "Cryptocurrency",
      "symbol": "BTC/USD",
      "action": "Buy",
      "quantity": 0.1
    }
  ]
}
```

---

## Multi-Leg Complex Order Templates

Use `create_complex_order` for all multi-leg strategies. Always run `complex_order_dry_run` first (not `order_dry_run`) — multi-leg and Net Debit / Net Credit orders are rejected by the simple order dry-run endpoint. The `legs` array drives simultaneous execution.

### Vertical Spread (credit put spread example)
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 1.50,
  "legs": [
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY 240119P00450000",
      "action": "Sell to Open",
      "quantity": 1
    },
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY 240119P00445000",
      "action": "Buy to Open",
      "quantity": 1
    }
  ]
}
```

### Short Straddle
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 8.00,
  "legs": [
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY 240119C00455000",
      "action": "Sell to Open",
      "quantity": 1
    },
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY 240119P00455000",
      "action": "Sell to Open",
      "quantity": 1
    }
  ]
}
```

### Short Strangle
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 5.50,
  "legs": [
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY 240119C00460000",
      "action": "Sell to Open",
      "quantity": 1
    },
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY 240119P00445000",
      "action": "Sell to Open",
      "quantity": 1
    }
  ]
}
```

### Iron Condor
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": 2.50,
  "legs": [
    {"instrument-type": "Equity Option", "symbol": "SPY 240119C00465000", "action": "Buy to Open", "quantity": 1},
    {"instrument-type": "Equity Option", "symbol": "SPY 240119C00460000", "action": "Sell to Open", "quantity": 1},
    {"instrument-type": "Equity Option", "symbol": "SPY 240119P00445000", "action": "Sell to Open", "quantity": 1},
    {"instrument-type": "Equity Option", "symbol": "SPY 240119P00440000", "action": "Buy to Open", "quantity": 1}
  ]
}
```

### Calendar Spread (long back month, short front month)
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": -1.20,
  "legs": [
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY 240216C00455000",
      "action": "Buy to Open",
      "quantity": 1
    },
    {
      "instrument-type": "Equity Option",
      "symbol": "SPY 240119C00455000",
      "action": "Sell to Open",
      "quantity": 1
    }
  ]
}
```

### Closing a Spread (reverse legs)
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": -0.50,
  "legs": [
    {"instrument-type": "Equity Option", "symbol": "SPY 240119P00450000", "action": "Buy to Close", "quantity": 1},
    {"instrument-type": "Equity Option", "symbol": "SPY 240119P00445000", "action": "Sell to Close", "quantity": 1}
  ]
}
```

---

## OCO / OTOCO (Bracket) Orders

Use `create_complex_order` with a type wrapper.

### OCO — Two closing orders, one cancels the other
Use to set a profit target AND a stop on an existing position simultaneously.
```json
{
  "type": "OCO",
  "orders": [
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": 8.00,
      "legs": [{"instrument-type": "Equity Option", "symbol": "SPY 240119P00450000", "action": "Buy to Close", "quantity": 1},
               {"instrument-type": "Equity Option", "symbol": "SPY 240119P00445000", "action": "Sell to Close", "quantity": 1}]
    },
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -2.50,
      "legs": [{"instrument-type": "Equity Option", "symbol": "SPY 240119P00450000", "action": "Buy to Close", "quantity": 1},
               {"instrument-type": "Equity Option", "symbol": "SPY 240119P00445000", "action": "Sell to Close", "quantity": 1}]
    }
  ]
}
```

### OTOCO — Entry order triggers a bracket (profit target + stop loss)
```json
{
  "type": "OTOCO",
  "trigger-order": {
    "time-in-force": "Day",
    "order-type": "Limit",
    "price": -185.00,
    "legs": [{"instrument-type": "Equity", "symbol": "AAPL", "action": "Buy to Open", "quantity": 100}]
  },
  "orders": [
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": 200.00,
      "legs": [{"instrument-type": "Equity", "symbol": "AAPL", "action": "Sell to Close", "quantity": 100}]
    },
    {
      "time-in-force": "GTC",
      "order-type": "Stop",
      "stop-trigger": 175.00,
      "legs": [{"instrument-type": "Equity", "symbol": "AAPL", "action": "Sell to Close", "quantity": 100}]
    }
  ]
}
```

---

## Order Management

### Edit a live order (price change only)
```
edit_order(accountNumber, orderId, editJson)
editJson: {"price": 1.75, "time-in-force": "Day"}
```

### Replace a live order (full cancel + resubmit)
```
replace_order(accountNumber, orderId, replacementOrderJson)
replacementOrderJson: <complete new order JSON>
```

### Cancel
```
cancel_order(accountNumber, orderId)               # single-leg
cancel_complex_order(accountNumber, orderId)       # multi-leg / OCO / OTOCO
```

### Verify fill status
```
get_order(accountNumber, orderId)
```
Check `status` field: `Received` → `Routed` → `Filled` / `Cancelled`

---

## Strategy-Specific Order Templates

Use these templates as the starting point for each strategy's typical entry order. Substitute actual symbols, strikes, expiries, and prices. Always run `complex_order_dry_run` before submitting multi-leg orders; use `order_dry_run` only for single-leg simple orders.

---

### VRP — Short Strangle OTOCO (50% profit / 2× credit stop)
```json
{
  "type": "OTOCO",
  "trigger-order": {
    "time-in-force": "Day",
    "order-type": "Limit",
    "price": 5.50,
    "legs": [
      {"instrument-type": "Equity Option", "symbol": "SPY 240119C00460000", "action": "Sell to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "SPY 240119P00445000", "action": "Sell to Open", "quantity": 1}
    ]
  },
  "orders": [
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -2.75,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00460000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119P00445000", "action": "Buy to Close", "quantity": 1}
      ]
    },
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -11.00,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00460000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119P00445000", "action": "Buy to Close", "quantity": 1}
      ]
    }
  ]
}
```
*Profit target = 50% of credit (price: −credit × 0.50). Stop = 2× credit (price: −credit × 2.0). Both prices are negative because closing a short position requires paying to buy back.*

---

### VRP — Short Straddle OTOCO (30% profit / 1.5× credit stop)
```json
{
  "type": "OTOCO",
  "trigger-order": {
    "time-in-force": "Day",
    "order-type": "Limit",
    "price": 8.00,
    "legs": [
      {"instrument-type": "Equity Option", "symbol": "SPY 240119C00455000", "action": "Sell to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "SPY 240119P00455000", "action": "Sell to Open", "quantity": 1}
    ]
  },
  "orders": [
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -5.60,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00455000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119P00455000", "action": "Buy to Close", "quantity": 1}
      ]
    },
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -12.00,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00455000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119P00455000", "action": "Buy to Close", "quantity": 1}
      ]
    }
  ]
}
```
*Straddles and iron butterflies: profit target = 25–35% of credit (example uses 30%: price = −credit × 0.70 to retain 30%). Stop = 1.5× credit (price = −credit × 1.50). ATM structures move faster than strangles — the tighter target locks in edge before mean reversion reverses.*

---

### VRP — Iron Condor OTOCO (50% profit / 2× credit stop)
```json
{
  "type": "OTOCO",
  "trigger-order": {
    "time-in-force": "Day",
    "order-type": "Limit",
    "price": 2.50,
    "legs": [
      {"instrument-type": "Equity Option", "symbol": "SPY 240119C00465000", "action": "Buy to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "SPY 240119C00460000", "action": "Sell to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "SPY 240119P00445000", "action": "Sell to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "SPY 240119P00440000", "action": "Buy to Open", "quantity": 1}
    ]
  },
  "orders": [
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -1.25,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00465000", "action": "Sell to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00460000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119P00445000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119P00440000", "action": "Sell to Close", "quantity": 1}
      ]
    },
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -5.00,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00465000", "action": "Sell to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00460000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119P00445000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119P00440000", "action": "Sell to Close", "quantity": 1}
      ]
    }
  ]
}
```

---

### Pre-Earnings Expansion — Long ATM Straddle with 50%-of-debit stop
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": -6.00,
  "legs": [
    {"instrument-type": "Equity Option", "symbol": "AAPL 240216C00185000", "action": "Buy to Open", "quantity": 1},
    {"instrument-type": "Equity Option", "symbol": "AAPL 240216P00185000", "action": "Buy to Open", "quantity": 1}
  ]
}
```
*After fill, place a GTC limit close order at 50% of debit paid (e.g., if debit = $6.00, close at $3.00). Pre-earnings straddles are debit structures — no OTOCO required, but the stop limit order must be placed immediately after fill.*

---

### Earnings Crush — Short Straddle OTOCO (25–35% profit / 1.5× credit stop)

Same structure as VRP Short Straddle OTOCO above. Use next-day expiry for earnings plays. Profit target = 25–35% of credit (e.g., sell $8 straddle → profit LIMIT at −$5.60 to retain 30%); stop = 1.5× credit (e.g., −$12.00).

---

### Earnings Crush — Iron Butterfly OTOCO (25–35% profit / 1.5× credit stop)
```json
{
  "type": "OTOCO",
  "trigger-order": {
    "time-in-force": "Day",
    "order-type": "Limit",
    "price": 6.00,
    "legs": [
      {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00195000", "action": "Buy to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00185000", "action": "Sell to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "AAPL 240119P00185000", "action": "Sell to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "AAPL 240119P00175000", "action": "Buy to Open", "quantity": 1}
    ]
  },
  "orders": [
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -4.20,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00195000", "action": "Sell to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00185000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "AAPL 240119P00185000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "AAPL 240119P00175000", "action": "Sell to Close", "quantity": 1}
      ]
    },
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -9.00,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00195000", "action": "Sell to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00185000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "AAPL 240119P00185000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "AAPL 240119P00175000", "action": "Sell to Close", "quantity": 1}
      ]
    }
  ]
}
```
*Iron butterfly (ATM structure): profit target at 30% of $6.00 credit = −$4.20 (retain $1.80). Stop at 1.5× credit = −$9.00. Iron butterflies and straddles use tighter targets than strangles/condors because ATM structures move faster.*

---

### Earnings Crush — Long Calendar (debit, GTC close on front-expiry day)
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": -3.33,
  "legs": [
    {"instrument-type": "Equity Option", "symbol": "AAPL 240216C00185000", "action": "Buy to Open", "quantity": 1},
    {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00185000", "action": "Sell to Open", "quantity": 1}
  ]
}
```
*After fill, set a GTC close order (sell the spread) on the front-expiry date. Close as a spread before close on expiry day to avoid pin risk.*

---

### Momentum Skew — Asymmetric Vertical Spread (debit, stop at 50% of debit)
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": -0.90,
  "legs": [
    {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00185000", "action": "Buy to Open", "quantity": 1},
    {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00195000", "action": "Sell to Open", "quantity": 1}
  ]
}
```
*Debit structure — max loss is the debit paid. After fill, place a GTC close at 50% of debit as the stop (e.g., debit = $0.90 → close if spread value drops to $0.45). No OTOCO required.*

---

### Momentum Skew — 1-3-2 Ratio Fly
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": -0.50,
  "legs": [
    {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00185000", "action": "Buy to Open", "quantity": 1},
    {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00195000", "action": "Sell to Open", "quantity": 3},
    {"instrument-type": "Equity Option", "symbol": "AAPL 240119C00200000", "action": "Buy to Open", "quantity": 2}
  ]
}
```
*Strike spacing: distance from leg 1 to leg 2 = 2× distance from leg 2 to leg 3. Debit structure. Max loss = debit paid; let expire if OTM.*

---

### Forward Factor — Calendar Spread (debit, limit only — no OTOCO)
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": -1.20,
  "legs": [
    {"instrument-type": "Equity Option", "symbol": "UNG 240316C00012000", "action": "Buy to Open", "quantity": 1},
    {"instrument-type": "Equity Option", "symbol": "UNG 240119C00012000", "action": "Sell to Open", "quantity": 1}
  ]
}
```
*Limit orders only — never market. Work the order up 1–2 ticks at a time. Do not pay above the max debit calculated from the FF math. Hold to front-expiry day; no OTOCO bracket.*

---

### Supply and Demand Zones — Bracket/Limit Order for Directional Equity Play
```json
{
  "time-in-force": "GTC",
  "order-type": "Limit",
  "price": -185.00,
  "legs": [
    {"instrument-type": "Equity", "symbol": "AAPL", "action": "Buy to Open", "quantity": 100}
  ]
}
```
*Set simultaneously: (1) profit limit at target price (proximal of nearest opposing zone), (2) stop just beyond the distal line. Use an OTOCO for equity bracket entries at zones.*

---

### Supply and Demand Zones — Credit Call/Put Spread at Zone
```json
{
  "type": "OTOCO",
  "trigger-order": {
    "time-in-force": "Day",
    "order-type": "Limit",
    "price": 1.50,
    "legs": [
      {"instrument-type": "Equity Option", "symbol": "SPY 240119C00460000", "action": "Sell to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "SPY 240119C00465000", "action": "Buy to Open", "quantity": 1}
    ]
  },
  "orders": [
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -0.75,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00460000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00465000", "action": "Sell to Close", "quantity": 1}
      ]
    },
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -3.00,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00460000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00465000", "action": "Sell to Close", "quantity": 1}
      ]
    }
  ]
}
```
*Short strike anchored at or just above the supply proximal line. 50% profit / 2× credit stop. Put spreads at demand zones: invert the call/put side.*

---

### Supply and Demand Zones — Debit Spread into Momentum
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": -1.20,
  "legs": [
    {"instrument-type": "Equity Option", "symbol": "SPY 240119C00455000", "action": "Buy to Open", "quantity": 1},
    {"instrument-type": "Equity Option", "symbol": "SPY 240119C00462000", "action": "Sell to Open", "quantity": 1}
  ]
}
```
*Debit structure. ATM long leg, OTM short leg in the departure direction. Max loss = debit paid.*

---

### Supply and Demand Zones — Single Long Option Inside Zone
```json
{
  "time-in-force": "Day",
  "order-type": "Limit",
  "price": -1.80,
  "legs": [
    {"instrument-type": "Equity Option", "symbol": "SPY 240119C00455000", "action": "Buy to Open", "quantity": 1}
  ]
}
```
*ATM or near-ATM option. Zone width guides expiration selection. Max loss = debit. Close if price closes through the distal line.*

---

### 0DTE VRP — Iron Condor with OCO Brackets (25% profit / spread-width stop)
```json
{
  "type": "OTOCO",
  "trigger-order": {
    "time-in-force": "Day",
    "order-type": "Limit",
    "price": 2.00,
    "legs": [
      {"instrument-type": "Equity Option", "symbol": "SPX 240119C04600000", "action": "Buy to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "SPX 240119C04550000", "action": "Sell to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "SPX 240119P04400000", "action": "Sell to Open", "quantity": 1},
      {"instrument-type": "Equity Option", "symbol": "SPX 240119P04350000", "action": "Buy to Open", "quantity": 1}
    ]
  },
  "orders": [
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -0.50,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPX 240119C04600000", "action": "Sell to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPX 240119C04550000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPX 240119P04400000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPX 240119P04350000", "action": "Sell to Close", "quantity": 1}
      ]
    },
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -50.00,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPX 240119C04600000", "action": "Sell to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPX 240119C04550000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPX 240119P04400000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPX 240119P04350000", "action": "Sell to Close", "quantity": 1}
      ]
    }
  ]
}
```
*Profit target: 25% of total credit collected. Stop: spread width (e.g., $50-wide spread → stop at $50 debit to close). Adjust for /ES, /MES, /NQ, /MNQ using Future Option instrument type and proper multipliers.*

---

## Dry Run — Always Run First

**Single-leg simple orders** (Limit, Market, Stop, Stop Limit, Notional Market):
```
order_dry_run(accountNumber, orderJson)
```

**Multi-leg complex orders** (spreads, straddles, strangles, condors, calendars — including Net Debit / Net Credit):
```
complex_order_dry_run(accountNumber, orderJson)
```

> Do NOT use `order_dry_run` for multi-leg or Net Debit / Net Credit orders — the API returns a 400 error. Always route multi-leg preflight through `complex_order_dry_run`.

Review the response for:
- `buying-power-effect` — impact on available capital
- `fee-calculation` — commissions and exchange fees
- Warnings or validation errors

Present this summary to the user before asking for confirmation to place the order.

---

## Bracket Enforcement — Detecting and Fixing Missing Brackets

Use these two tools when reviewing sessions for Tier 1 violations or when manual orders were placed without OTOCO brackets.

### Step 1 — Detect violations

```
check_bracket_violations(accountNumber)
```

Scans all short Equity Option positions. A violation is any position with no live GTC `Buy to Close` order covering its symbol. Returns:
- `symbol`, `underlying-symbol`, `quantity`
- `average-open-price` — the credit received per contract
- `suggested-profit-target` — 50% of credit, rounded to $0.05
- `suggested-stop-loss` — 2× credit, rounded to $0.05

### Step 2 — Submit an OCO bracket

```
submit_oco_bracket(accountNumber, legs, credit, dryRun)
```

Constructs a GTC OCO order with:
- **Profit leg** — `Buy to Close` all legs at `credit × 0.50` (Limit, GTC)
- **Stop leg** — `Buy to Close` all legs at `credit × 2.00` (Limit, GTC)

The two closing orders are linked as OCO: the first to fill cancels the other.

Pass `dryRun: true` to preview the OCO JSON without submitting. Set `dryRun: false` (or omit) to place the order.

**For multi-leg strategies** (strangle, straddle, iron condor), include **all legs** in the `legs` array — both OCO orders will mirror the same leg set. The `credit` should be the **total net credit received** for the combined position.

Example — bracket a short strangle on SPY (credit: $5.50, 2 contracts each):
```json
{
  "accountNumber": "5WX12345",
  "legs": [
    {"symbol": "SPY   250620C00580000", "instrument-type": "Equity Option", "quantity": 2},
    {"symbol": "SPY   250620P00520000", "instrument-type": "Equity Option", "quantity": 2}
  ],
  "credit": 5.50,
  "dryRun": true
}
```
