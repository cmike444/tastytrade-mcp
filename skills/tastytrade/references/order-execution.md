# Order Execution Reference

## Core Rules

- **Price sign**: negative = debit (you pay to open), positive = credit (you receive to open)
- **JSON keys use dashes**: `instrument-type`, `time-in-force`, `order-type` (not underscores)
- **ALWAYS run `order_dry_run` first** — confirm buying power effect and fee estimate before submitting
- **Never skip the startup sequence** — account balances + positions + live orders before every order

---

## Short-Premium Entries Require OTOCO

Every trade that opens a **net short premium position** must be placed as an OTOCO order. The entry trigger and both bracket legs (profit target + stop loss) must be live simultaneously the moment the position opens. Placing the entry alone and adding brackets manually after fill is not acceptable.

**Covered by this rule** (all placed as OTOCO):
- VRP: short strangle, short straddle, iron condor
- Earnings Crush: short straddle, iron butterfly
- Supply and Demand Zones: credit call spread, credit put spread at zones
- 0DTE VRP: iron condor (MECH and EMA setups)

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

Use `create_complex_order` for all multi-leg strategies. The `legs` array drives simultaneous execution.

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

Use these templates as the starting point for each strategy's typical entry order. Substitute actual symbols, strikes, expiries, and prices. Always run `order_dry_run` before submitting.

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

### VRP — Short Straddle OTOCO (50% profit / 2× credit stop)
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
      "price": -4.00,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00455000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119P00455000", "action": "Buy to Close", "quantity": 1}
      ]
    },
    {
      "time-in-force": "GTC",
      "order-type": "Limit",
      "price": -16.00,
      "legs": [
        {"instrument-type": "Equity Option", "symbol": "SPY 240119C00455000", "action": "Buy to Close", "quantity": 1},
        {"instrument-type": "Equity Option", "symbol": "SPY 240119P00455000", "action": "Buy to Close", "quantity": 1}
      ]
    }
  ]
}
```

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

### Earnings Crush — Short Straddle OTOCO (50% profit / 2× credit stop)

Same structure as VRP Short Straddle OTOCO above. Use next-day expiry for earnings plays.

---

### Earnings Crush — Iron Butterfly OTOCO (50% profit / 2× credit stop)
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
      "price": -3.00,
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
      "price": -12.00,
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

```
order_dry_run(accountNumber, orderJson)
```

Review the response for:
- `buying-power-effect` — impact on available capital
- `fee-calculation` — commissions and exchange fees
- Warnings or validation errors

Present this summary to the user before asking for confirmation to place the order.
