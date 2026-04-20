# Order Execution Reference

## Core Rules

- **Price sign**: negative = debit (you pay to open), positive = credit (you receive to open)
- **JSON keys use dashes**: `instrument-type`, `time-in-force`, `order-type` (not underscores)
- **ALWAYS run `order_dry_run` first** — confirm buying power effect and fee estimate before submitting
- **Never skip the startup sequence** — account balances + positions + live orders before every order

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

## Dry Run — Always Run First

```
order_dry_run(accountNumber, orderJson)
```

Review the response for:
- `buying-power-effect` — impact on available capital
- `fee-calculation` — commissions and exchange fees
- Warnings or validation errors

Present this summary to the user before asking for confirmation to place the order.
