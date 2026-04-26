# Hook Integration Tests

Integration tests for the pre-trade enforcement hooks and PostToolUse monitor
hooks (`tt-require-bracket`, `tt-concentration-cap`, `tt-require-plan`,
`tt-ff-exit-monitor`).

## Running the tests

```bash
python hooks/tests/run_tests.py           # human-readable output
python hooks/tests/run_tests.py --json    # machine-readable JSON
```

All 18 tests should pass (exit 0). The runner creates and tears down the
required sidecar files (`/tmp/tt_pending_plan.json`, `/tmp/tt_netliq.json`,
`/tmp/tt_positions.json`) automatically for each test case.

## Fixture files (`fixtures/`)

Each `.json` file is a complete hook input envelope (`tool_name` + `tool_input`)
matching the shape that TastyTrade's API returns for `order_dry_run` responses.
Field names use TastyTrade's actual hyphenated keys (`instrument-type`,
`time-in-force`, `trigger-order`, `order-type`, etc.).

| Fixture | Strategy | Scenarios exercised |
|---|---|---|
| `naked_short.json` | Single STO call, no bracket | bracket BLOCKS; plan blocks without plan file |
| `bracketed_strangle.json` | OTOCO short strangle, 50%/2× bracket | bracket ALLOWS; concentration ALLOWS within limits; stale plan BLOCKS |
| `put_spread.json` | Credit put spread (defined-risk) | bracket ALLOWS (equal BTO/STO qty = not naked) |
| `futures_option_otoco.json` | /ES futures-option OTOCO, 50%/2× | Future Option instrument-type recognised; concentration uses trigger-order |
| `over_concentrated_strangle.json` | OTOCO strangle exceeding 25% cap | concentration BLOCKS; verifies trigger-order fix |
| `ff_exit_monitor_full_response.json` | PostToolUse `get_market_metrics(detail="full")` response | FF exit monitor: AAPL calendar FF<0 → WARN; SPY calendar FF>0 → silent; no calendars → silent; missing positions file → silent |

## Refreshing fixtures from real dry-run captures

When new TastyTrade API response shapes are observed, update the fixtures with
the real payload to keep the tests representative.

1. Run `order_dry_run` for the order you want to capture (dry-run never submits):
   ```
   order_dry_run(accountNumber, orderJson)
   ```
2. Extract the `order` field from the response — that is the `tool_input` value.
3. Wrap it in the hook envelope and save it as a `.json` fixture:
   ```json
   {
     "_comment": "Describe the scenario and expected hook outcomes here",
     "tool_name": "create_complex_order",
     "tool_input": { <paste the order object here> }
   }
   ```
4. Redact the account number from the fixture (use `5WX12345` or similar).
5. Add test cases in `run_tests.py` asserting the expected `exit` code for
   each hook, then run the suite to confirm.

## Field-name notes discovered during testing

- OTOCO orders use `trigger-order.legs` (not `legs`) for the opening entry.
- OTOCO credit/price is in `trigger-order.price` (not the top-level `price`).
- `instrument-type` is hyphenated; values: `"Equity Option"`, `"Future Option"`,
  `"Future"`, `"Equity"`, `"Cryptocurrency"`.
- Closing debit prices are **negative** in TastyTrade JSON; hooks compare
  absolute values for bracket price validation.
