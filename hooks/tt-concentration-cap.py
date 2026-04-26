#!/usr/bin/env python3
"""
PreToolUse hook: tt-concentration-cap
Fires on: create_order, create_complex_order

Reads /tmp/tt_netliq.json for current net liq, reads /tmp/tt_positions.json
for existing per-underlying exposure, and blocks any new opening order that
would push an underlying above 25% of net liq.

Only OPENING legs (Buy to Open / Sell to Open) add to concentration.
Closing legs (Buy to Close / Sell to Close) do not add exposure and are
never blocked by this hook.

Fails CLOSED if:
  - /tmp/tt_netliq.json is missing, unreadable, or contains no net liq
  - /tmp/tt_positions.json is missing, unreadable, or not valid JSON

POSITIONS FILE FORMAT (from get_positions MCP tool):
  Each position item is expected to have:
    - underlying-symbol or underlying (str) — root underlying
    - average-open-price (float)           — price per contract unit
    - quantity (float)                     — number of contracts (positive)
    - multiplier (int, optional)           — contract size; defaults to 100
                                             for options, 1 for equities
  Cost basis = average-open-price * quantity * multiplier
  (Note: cost-effect is a direction string "Debit"/"Credit" — not numeric)
"""

import json
import os
import sys

WATCHED_TOOLS = {"create_complex_order", "create_order"}
NET_LIQ_FILE = "/tmp/tt_netliq.json"
POSITIONS_FILE = "/tmp/tt_positions.json"
CAP_PCT = 0.25

OPENING_ACTIONS = {"buy to open", "sell to open"}


def load_netliq():
    """Returns (float, None) on success or (None, error_str) on failure."""
    if not os.path.exists(NET_LIQ_FILE):
        return None, "{} is missing".format(NET_LIQ_FILE)
    try:
        with open(NET_LIQ_FILE) as f:
            data = json.load(f)
        for key in ("net-liquidating-value", "net_liq", "netliq"):
            if key in data and data[key] is not None:
                v = float(data[key])
                if v > 0:
                    return v, None
        for v in data.values():
            if isinstance(v, (int, float)) and v > 0:
                return float(v), None
        return None, "{} contains no recognizable net liq value".format(NET_LIQ_FILE)
    except json.JSONDecodeError as e:
        return None, "{} is not valid JSON: {}".format(NET_LIQ_FILE, e)
    except (ValueError, TypeError, OSError) as e:
        return None, "cannot read {}: {}".format(NET_LIQ_FILE, e)


def load_existing_exposure():
    """
    Returns ({underlying: cost_basis}, None) on success or
    (None, error_str) on any failure (missing file, bad JSON, parse error).

    A missing or unreadable positions file is treated as an error —
    the hook fails closed rather than assuming zero existing exposure.
    An empty list (no open positions) returns ({}, None) — that is valid.

    Cost basis per position = average-open-price * quantity * multiplier.
    The cost-effect field ("Debit"/"Credit") is a string direction indicator
    and is NOT used for numeric calculation.
    """
    if not os.path.exists(POSITIONS_FILE):
        return None, (
            "{file} is missing. Run get_positions first so that "
            "existing concentration can be verified before adding new "
            "opening exposure.".format(file=POSITIONS_FILE)
        )

    try:
        with open(POSITIONS_FILE) as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return None, "{} is not valid JSON: {}".format(POSITIONS_FILE, e)
    except OSError as e:
        return None, "cannot read {}: {}".format(POSITIONS_FILE, e)

    try:
        items = (
            data
            if isinstance(data, list)
            else data.get("items", data.get("positions", data.get("data", [])))
        )
        if not isinstance(items, list):
            return None, (
                "{} did not contain a position list at the expected path "
                "(top-level array or items/positions/data key)".format(POSITIONS_FILE)
            )

        exposure = {}
        for pos in items:
            underlying = (
                pos.get("underlying-symbol")
                or pos.get("underlying")
                or _extract_underlying(pos.get("symbol", ""))
            )
            if not underlying:
                continue

            avg_price = _safe_float(pos.get("average-open-price"))
            qty = abs(_safe_float(pos.get("quantity")) or 0)
            instrument_type = pos.get("instrument-type", "").lower()
            multiplier = _safe_float(pos.get("multiplier"))
            if multiplier is None or multiplier <= 0:
                multiplier = 100 if "option" in instrument_type else 1

            if avg_price is None:
                continue

            cost_basis = avg_price * qty * multiplier
            exposure[underlying] = exposure.get(underlying, 0) + cost_basis

        return exposure, None

    except (TypeError, KeyError, AttributeError) as e:
        return None, "{} could not be parsed: {}".format(POSITIONS_FILE, e)


def _safe_float(val):
    """Return float or None if val is None, non-numeric, or non-positive."""
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _extract_underlying(symbol):
    if not symbol:
        return None
    parts = symbol.strip().split()
    if len(parts) >= 2:
        return parts[0].lstrip("./").upper()
    return symbol.lstrip("./").upper()


def get_opening_exposure(order):
    """
    Estimate per-underlying notional for OPENING legs only.
    Closing legs (BTC/STC) are ignored — they reduce risk, not add it.
    Exposure = |price| x max_opening_qty_per_underlying x multiplier.

    For OTOCO orders the opening legs live under trigger-order.legs, not at
    the top-level legs key.  The child orders[] array holds closing bracket
    legs and must NOT be counted as new opening exposure.  The net credit /
    debit price for OTOCO orders is also in trigger-order.price, not the
    top-level price field.
    """
    trigger = order.get("trigger-order", {})
    is_otoco = bool(trigger)

    legs = list(order.get("legs", []))
    if is_otoco:
        # OTOCO: opening legs are in trigger-order only.  The child orders[]
        # array contains bracket closing legs (BTC/STC) and must be excluded
        # to avoid double-counting or misclassifying closing legs as opening.
        legs.extend(trigger.get("legs", []))
    else:
        # Plain multi-leg or OCO complex order: collect all sub-order legs.
        for sub in order.get("orders", []):
            legs.extend(sub.get("legs", []))

    opening_legs = [
        leg for leg in legs
        if leg.get("action", "").lower() in OPENING_ACTIONS
    ]
    if not opening_legs:
        return {}

    # For OTOCO orders the price lives in trigger-order, not the top level.
    price = abs(
        _safe_float(order.get("price"))
        or _safe_float(trigger.get("price"))
        or 0
    )
    per_underlying = {}

    for leg in opening_legs:
        underlying = _extract_underlying(leg.get("symbol", ""))
        if not underlying:
            continue
        qty = abs(_safe_float(leg.get("quantity")) or 1)
        instrument_type = leg.get("instrument-type", "").lower()
        multiplier = _safe_float(leg.get("multiplier"))
        if multiplier is None or multiplier <= 0:
            multiplier = 100 if "option" in instrument_type else 1
        key = (underlying, multiplier)
        if qty > per_underlying.get(key, 0):
            per_underlying[key] = qty

    exposure = {}
    for (underlying, multiplier), max_qty in per_underlying.items():
        exposure[underlying] = exposure.get(underlying, 0) + price * max_qty * multiplier

    return exposure


def main():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print("tt-concentration-cap: failed to parse hook input: {}".format(e), file=sys.stderr)
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in WATCHED_TOOLS:
        sys.exit(0)

    netliq, netliq_err = load_netliq()
    if netliq_err:
        print(
            "BLOCKED -- concentration cap cannot be verified: {err}\n\n"
            "Run get_account_balances to populate {file} before submitting "
            "any order.\n"
            "This hook fails closed to prevent unchecked concentration risk.".format(
                err=netliq_err, file=NET_LIQ_FILE
            )
        )
        sys.exit(2)

    existing, positions_err = load_existing_exposure()
    if positions_err:
        print(
            "BLOCKED -- concentration cap cannot be verified: {err}\n\n"
            "Run get_positions to populate {file} before submitting "
            "any order.\n"
            "This hook fails closed to prevent unchecked concentration risk.".format(
                err=positions_err, file=POSITIONS_FILE
            )
        )
        sys.exit(2)

    cap_dollars = netliq * CAP_PCT
    new_exposure = get_opening_exposure(hook_input.get("tool_input", {}))

    if not new_exposure:
        sys.exit(0)

    blocks = []
    for underlying, new_notional in new_exposure.items():
        current = existing.get(underlying, 0)
        projected = current + new_notional
        projected_pct = (projected / netliq) * 100
        current_pct = (current / netliq) * 100

        if projected > cap_dollars:
            blocks.append(
                "  {u}: currently {cp:.1f}% (${c:.0f}); "
                "order adds ${add:.0f} -> {pp:.1f}% (${p:.0f}) -- "
                "cap is 25% (${cap:.0f}). "
                "Close an existing {u} leg first.".format(
                    u=underlying,
                    cp=current_pct,
                    c=current,
                    add=new_notional,
                    pp=projected_pct,
                    p=projected,
                    cap=cap_dollars,
                )
            )

    if not blocks:
        sys.exit(0)

    print(
        "BLOCKED -- concentration cap exceeded "
        "(25% of net liq = ${cap:.0f} on ${nl:.0f} account)\n\n"
        "{details}\n\n"
        "Action required: reduce existing exposure in the flagged "
        "underlying(s) before adding more.\n"
        "Run get_positions to review current holdings.\n"
        "Note: closing orders (Buy to Close / Sell to Close) are never "
        "blocked by this hook.".format(
            cap=cap_dollars,
            nl=netliq,
            details="\n".join(blocks),
        )
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
