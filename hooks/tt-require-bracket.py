#!/usr/bin/env python3
"""
PreToolUse hook: tt-require-bracket
Fires on: create_order, create_complex_order

Detects naked short-premium option opens and blocks them unless an OTOCO
bracket with valid child prices is present.

NAKEDNESS DEFINITION — a STO option leg is "naked" when its BTO protection
on the same underlying does NOT provide equal-or-greater offsetting coverage:

  Rule 1 — Quantity parity (primary):
    BTO contracts must be >= STO contracts on the same underlying.
    Defined-risk spreads (1:1) are fully offset and are NOT naked.
    Ratio spreads (2:1) have one naked leg.

  Rule 2 — Meaningful debit (secondary, when per-leg prices are available):
    For single-leg pairs where per-leg prices are included in the order JSON,
    the BTO leg must cost at least 5% of the STO credit. A near-zero BTO
    debit (e.g. $0.01 vs $3.00 STO) is decorative and does not constitute
    real protection — the STO is treated as naked.

    NOTE: TastyTrade multi-leg orders carry only a net order price (not
    individual leg prices). For these orders, Rule 1 (quantity parity) is
    the sole gate. The net credit of the order is used for bracket pricing.

OTOCO BRACKET STRUCTURE — two child orders:
  TastyTrade OTOCO option brackets typically use TWO "Limit" children:
    * Profit target: Limit at a smaller absolute close debit
    * Stop loss:     Limit at a larger absolute close debit
  This is the expected form for multi-leg option OTOCOs. The hook also
  accepts an explicit STOP / STOP LIMIT child (used for equity brackets
  with a stop-trigger price). When both children are Limit, the smaller
  absolute price is treated as the profit target and the larger as the stop.

STRATEGY-SPECIFIC BRACKET LEVELS (absolute close debit vs credit received):

  Strangle / Iron Condor (different STO strikes):
    Profit target: close at 50% of credit  (allowed range: 35%–65% of credit)
    Stop level:    close at 2.0× credit    (allowed range: 1.4×–2.6× of credit)

  Straddle / Iron Butterfly (same STO strike):
    Profit target: close at 65%–75% of credit  (retain 25%–35% as profit)
    Stop level:    close at 1.5× credit         (allowed range: 1.05×–1.95×)

  0DTE orders (any STO option expiring today):
    OTOCO structure is required, but bracket prices are NOT validated.
    0DTE uses a time-based exit (~2 h after open), not a credit-percentage
    target — any bracket prices are acceptable.

"Close at X% of credit" means the buy-to-close debit equals X% of the
credit received at entry. Example: sold strangle for $5.50 → profit Limit
at −$2.75 (50%); stop Limit at −$11.00 (2×). Prices are negative in
TastyTrade JSON (debit to buy back); the hook compares absolute values.
"""

import json
import re
import sys
from datetime import date

WATCHED_TOOLS = {"create_order", "create_complex_order"}
MIN_BTO_DEBIT_FRACTION = 0.05

# Strangle / Iron Condor bracket parameters (close debit as fraction of credit)
STRANGLE_PROFIT_TARGET = 0.50   # close at 50% of credit
STRANGLE_PROFIT_TOL    = 0.30   # ±30% → range 35%–65%
STRANGLE_STOP_TARGET   = 2.00   # close at 2.0× credit
STRANGLE_STOP_TOL      = 0.30   # ±30% → range 1.4×–2.6×

# Straddle / Iron Butterfly bracket parameters (close debit as fraction of credit)
# Profit retained 25–35% → close debit in [65%, 75%] of credit
STRADDLE_PROFIT_CLOSE_MIN = 0.65  # retain 35%
STRADDLE_PROFIT_CLOSE_MAX = 0.75  # retain 25%
STRADDLE_STOP_TARGET      = 1.50  # close at 1.5× credit
STRADDLE_STOP_TOL         = 0.30  # ±30% → range 1.05×–1.95×


# ---------------------------------------------------------------------------
# Price helpers
# ---------------------------------------------------------------------------

def safe_abs_price(val):
    """Return abs(float) if non-zero, else None. Accepts positive or negative."""
    try:
        p = abs(float(val))
        return p if p > 0 else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Symbol parsing
# ---------------------------------------------------------------------------

def _extract_underlying(symbol):
    if not symbol:
        return None
    parts = symbol.strip().split()
    if len(parts) >= 2:
        return parts[0].lstrip("./").upper()
    return symbol.lstrip("./").upper()


def _parse_strike(symbol):
    """
    Return the strike as an integer from an OCC symbol, or None.
    OCC format: AAPL 240119C00150000 -> 150000 (= $150.000 in 1/1000 units)
    Future option: ./ESM4 EW1M4 240119C4800 -> 4800
    """
    m = re.search(r"[CP](\d+)$", symbol.strip())
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            pass
    return None


def _parse_expiry(symbol):
    """
    Return expiration date from an OCC option symbol, or None.
    Matches 6-digit YYMMDD immediately before C or P.
    """
    m = re.search(r"(\d{6})[CP]", symbol)
    if not m:
        return None
    ds = m.group(1)
    try:
        return date(2000 + int(ds[:2]), int(ds[2:4]), int(ds[4:6]))
    except ValueError:
        return None


def is_option(leg):
    return leg.get("instrument-type", "").lower() in ("equity option", "future option")


# ---------------------------------------------------------------------------
# OTOCO structure helpers
# ---------------------------------------------------------------------------

def _is_otoco(order):
    """
    Return True if the order is an OTOCO wrapper.
    TastyTrade payloads use "type": "OTOCO"; some variants may use
    "order-type": "OTOCO". Both forms are recognised.
    """
    return (
        str(order.get("type", "")).upper() == "OTOCO"
        or str(order.get("order-type", "")).upper() == "OTOCO"
    )


def get_opening_legs(order):
    """
    Return only the opening (trigger) legs from an order.
    For OTOCO orders the opening legs live under trigger-order.legs.
    For plain orders they are at the top-level legs array.
    """
    if _is_otoco(order):
        return list(order.get("trigger-order", {}).get("legs", []))
    return list(order.get("legs", []))


def get_order_credit(order):
    """
    Return the opening credit (positive abs value) for bracket validation.
    For OTOCO orders the credit is in trigger-order.price.
    For plain orders it is order.price.
    """
    if _is_otoco(order):
        return safe_abs_price(order.get("trigger-order", {}).get("price"))
    return safe_abs_price(order.get("price"))


def get_bracket_children(order):
    """Return child bracket orders (from OTOCO orders[])."""
    return list(order.get("orders", []))


# ---------------------------------------------------------------------------
# Nakedness detection
# ---------------------------------------------------------------------------

def compute_naked_qty(legs, order_price):
    """
    Returns {underlying: (naked_qty, sto_total, bto_total)} for option legs
    where naked_qty > 0.

    Primary test: quantity parity (BTO < STO → naked).
    Secondary test: near-zero BTO debit (< 5% of STO credit) → decorative.
    """
    sto_legs = {}
    bto_legs = {}

    for leg in legs:
        if not is_option(leg):
            continue
        action = leg.get("action", "").lower()
        underlying = _extract_underlying(leg.get("symbol", ""))
        if not underlying:
            continue
        qty = abs(float(leg.get("quantity", 1) or 1))

        if action == "sell to open":
            sto_legs.setdefault(underlying, []).append((qty, leg))
        elif action == "buy to open":
            bto_legs.setdefault(underlying, []).append((qty, leg))

    naked = {}
    for underlying, sto_list in sto_legs.items():
        sto_total = sum(q for q, _ in sto_list)
        bto_list = bto_legs.get(underlying, [])
        bto_total = sum(q for q, _ in bto_list)

        unhedged = max(0.0, sto_total - bto_total)
        if unhedged > 0:
            naked[underlying] = (unhedged, sto_total, bto_total)
            continue

        if (
            len(sto_list) == 1
            and len(bto_list) == 1
            and order_price is not None
        ):
            bto_leg_price = safe_abs_price(bto_list[0][1].get("price"))
            if bto_leg_price is not None:
                min_debit = order_price * MIN_BTO_DEBIT_FRACTION
                if bto_leg_price < min_debit:
                    naked[underlying] = (sto_list[0][0], sto_total, bto_total)

    return naked


# ---------------------------------------------------------------------------
# Strategy type detection
# ---------------------------------------------------------------------------

def is_straddle_type(opening_legs):
    """
    True when all STO option legs share the same strike — indicating a
    short straddle or iron butterfly (ATM structures, tighter exits).
    False for strangles and iron condors (different STO strikes, 50%/2×).
    """
    sto_option_legs = [
        leg for leg in opening_legs
        if is_option(leg) and leg.get("action", "").lower() == "sell to open"
    ]
    if len(sto_option_legs) < 2:
        return False
    strikes = set()
    for leg in sto_option_legs:
        s = _parse_strike(leg.get("symbol", ""))
        if s is not None:
            strikes.add(s)
    return len(strikes) == 1


def is_zero_dte(opening_legs):
    """
    True when any STO option leg expires today (0DTE).
    0DTE uses a time-based exit (~2 h after open) — prices not validated.
    """
    today = date.today()
    for leg in opening_legs:
        if not is_option(leg):
            continue
        if leg.get("action", "").lower() != "sell to open":
            continue
        expiry = _parse_expiry(leg.get("symbol", ""))
        if expiry is not None and expiry == today:
            return True
    return False


# ---------------------------------------------------------------------------
# Bracket child classification
# ---------------------------------------------------------------------------

def _classify_children(children):
    """
    Return (profit_child, stop_child) or (None, None) if unable to classify.

    TastyTrade option OTOCO brackets typically use two Limit children:
      * Profit target — smaller absolute close debit
      * Stop loss     — larger absolute close debit

    Equity/futures brackets may use an explicit STOP / STOP LIMIT child.
    Both patterns are handled.
    """
    limit_children = [c for c in children if c.get("order-type", "").upper() == "LIMIT"]
    stop_children = [
        c for c in children
        if c.get("order-type", "").upper() in ("STOP", "STOP_LIMIT", "STOP LIMIT")
    ]

    if len(limit_children) >= 2 and len(stop_children) == 0:
        # Two-Limit option OTOCO pattern: sort by absolute price
        sorted_limits = sorted(
            limit_children,
            key=lambda c: safe_abs_price(c.get("price")) or 0.0,
        )
        return sorted_limits[0], sorted_limits[-1]

    if len(limit_children) >= 1 and len(stop_children) >= 1:
        # Explicit Stop child pattern (e.g., equity OTOCO with stop-trigger)
        return limit_children[0], stop_children[0]

    return None, None


# ---------------------------------------------------------------------------
# Bracket validation
# ---------------------------------------------------------------------------

def validate_bracket(order, naked_underlyings):
    """
    Returns (ok, problems_list).

    Validates:
    1. order.type == "OTOCO"
    2. Two classifiable child orders are present (profit + stop)
    3. 0DTE: only structure check; skip price validation
    4. Prices are within strategy-specific allowed ranges
    """
    children = get_bracket_children(order)

    if not _is_otoco(order):
        return False, [
            "order must be type OTOCO (got: {!r}) -- naked exposure on: {}".format(
                order.get("type", order.get("order-type", "not set")),
                ", ".join(sorted(naked_underlyings)),
            )
        ]

    if len(children) < 2:
        return False, [
            "OTOCO order must have at least 2 child bracket orders "
            "(profit-target + stop-loss); found {}".format(len(children))
        ]

    # Determine 0DTE status BEFORE classifying child prices — 0DTE only needs
    # the OTOCO structure with 2+ children; price levels are not validated
    # because 0DTE uses a time-based exit (~2 h after open).
    opening_legs = get_opening_legs(order)
    if is_zero_dte(opening_legs):
        return True, []

    profit_child, stop_child = _classify_children(children)
    if profit_child is None or stop_child is None:
        return False, [
            "cannot identify profit-target and stop-loss children; "
            "expected two Limit children (profit + stop) or one Limit + one Stop child"
        ]

    credit = get_order_credit(order)
    if credit is None:
        return False, [
            "trigger-order price (credit received) is missing or zero -- "
            "must be set so bracket prices can be validated"
        ]

    profit_price = safe_abs_price(profit_child.get("price"))
    stop_price = safe_abs_price(stop_child.get("price"))

    straddle = is_straddle_type(opening_legs)
    problems = []

    if straddle:
        # Straddle / Iron Butterfly: retain 25–35% → close at 65–75% of credit
        pt_lo = credit * STRADDLE_PROFIT_CLOSE_MIN
        pt_hi = credit * STRADDLE_PROFIT_CLOSE_MAX
        stop_lo = credit * STRADDLE_STOP_TARGET * (1 - STRADDLE_STOP_TOL)
        stop_hi = credit * STRADDLE_STOP_TARGET * (1 + STRADDLE_STOP_TOL)
        strategy_label = "straddle/iron-butterfly"
        profit_desc = "65–75% of ${:.2f} credit (retain 25–35% as profit)".format(credit)
        stop_desc   = "1.5× ${:.2f} credit = ${:.2f}–${:.2f}".format(credit, stop_lo, stop_hi)
    else:
        # Strangle / Iron Condor: 50% profit / 2× stop
        pt_lo = credit * STRANGLE_PROFIT_TARGET * (1 - STRANGLE_PROFIT_TOL)
        pt_hi = credit * STRANGLE_PROFIT_TARGET * (1 + STRANGLE_PROFIT_TOL)
        stop_lo = credit * STRANGLE_STOP_TARGET * (1 - STRANGLE_STOP_TOL)
        stop_hi = credit * STRANGLE_STOP_TARGET * (1 + STRANGLE_STOP_TOL)
        strategy_label = "strangle/iron-condor"
        profit_desc = "50% of ${:.2f} credit = ${:.2f}–${:.2f} (±30%)".format(
            credit, pt_lo, pt_hi)
        stop_desc = "2× ${:.2f} credit = ${:.2f}–${:.2f} (±30%)".format(
            credit, stop_lo, stop_hi)

    if profit_price is None:
        problems.append(
            "profit-target child price is missing or zero -- "
            "must be set to ~{} for {}".format(profit_desc, strategy_label)
        )
    elif not (pt_lo <= profit_price <= pt_hi):
        problems.append(
            "profit-target price ${:.2f} outside ${:.2f}–${:.2f} "
            "({}) for {}".format(profit_price, pt_lo, pt_hi, profit_desc, strategy_label)
        )

    if stop_price is None:
        problems.append(
            "stop-loss child price is missing or zero -- "
            "must be set to ~{} for {}".format(stop_desc, strategy_label)
        )
    elif not (stop_lo <= stop_price <= stop_hi):
        problems.append(
            "stop-loss price ${:.2f} outside ${:.2f}–${:.2f} "
            "({}) for {}".format(stop_price, stop_lo, stop_hi, stop_desc, strategy_label)
        )

    if problems:
        return False, problems
    return True, []


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print("tt-require-bracket: failed to parse hook input: {}".format(e), file=sys.stderr)
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in WATCHED_TOOLS:
        sys.exit(0)

    order = hook_input.get("tool_input", {})
    opening_legs = get_opening_legs(order)
    order_price = get_order_credit(order)
    naked = compute_naked_qty(opening_legs, order_price)

    if not naked:
        sys.exit(0)

    ok, problems = validate_bracket(order, naked)
    if ok:
        sys.exit(0)

    summary_parts = []
    ratio_notes = []
    for u, (naked_qty, sto_total, bto_total) in sorted(naked.items()):
        summary_parts.append(
            "{} ({} naked contract{})".format(
                u, int(naked_qty), "s" if naked_qty != 1 else ""
            )
        )
        if sto_total > bto_total > 0:
            ratio_notes.append(
                "  {}: ratio spread detected -- {} STO vs {} BTO = {} naked leg{}; "
                "add {} more BTO contract{} or reduce STO qty to fully hedge".format(
                    u,
                    int(sto_total), int(bto_total), int(naked_qty),
                    "s" if naked_qty != 1 else "",
                    int(naked_qty), "s" if naked_qty != 1 else "",
                )
            )

    summary = ", ".join(summary_parts)
    ratio_section = (
        "\nRatio-spread detail:\n" + "\n".join(ratio_notes)
        if ratio_notes else ""
    )

    print(
        "BLOCKED -- naked short premium detected: {summary}\n\n"
        "Bracket issues:\n"
        "{issues}"
        "{ratio_section}\n\n"
        "Every unhedged Sell-to-Open option requires an OTOCO bracket.\n"
        "Strategy-specific bracket levels (absolute close debit vs credit received):\n"
        "  Strangle / Iron Condor:     profit at 50% of credit (close at 50%), stop at 2× credit\n"
        "  Straddle / Iron Butterfly:  profit retaining 25–35% (close at 65–75%), stop at 1.5× credit\n"
        "  0DTE:                        OTOCO required; bracket prices not validated (time-based close)\n\n"
        "Bracket child format: two Limit children (smaller abs price = profit, larger = stop),\n"
        "or one Limit (profit) + one Stop/Stop-Limit (stop). Close prices are negative in TastyTrade JSON;\n"
        "the hook compares absolute values.".format(
            summary=summary,
            issues="\n".join("  - " + p for p in problems),
            ratio_section=ratio_section,
        )
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
