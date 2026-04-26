#!/usr/bin/env python3
"""
PreToolUse hook: tt-require-bracket
Fires on: create_order, create_complex_order

Detects naked short-premium option opens and blocks them unless an OTOCO
bracket with explicit, correct prices is present.

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

BRACKET REQUIREMENTS for naked positions:
  - order-type must be "OTOCO"
  - LIMIT child order:
      price must be explicitly set (non-zero)
      price must be within 30% of credit * 0.50 (50% profit target)
  - STOP child order:
      price must be explicitly set (non-zero)
      price must be within 30% of credit * 2.00 (2x stop loss)
  - Parent order.price must be set (non-zero) — it is the credit received

All three prices are required and validated. Zero or missing prices block.
"""

import json
import sys

WATCHED_TOOLS = {"create_order", "create_complex_order"}
BRACKET_PRICE_TOLERANCE = 0.30
MIN_BTO_DEBIT_FRACTION = 0.05


def collect_legs(order):
    legs = list(order.get("legs", []))
    for sub in order.get("orders", []):
        legs.extend(sub.get("legs", []))
    return legs


def _extract_underlying(symbol):
    if not symbol:
        return None
    parts = symbol.strip().split()
    if len(parts) >= 2:
        return parts[0].lstrip("./").upper()
    return symbol.lstrip("./").upper()


def is_option(leg):
    return leg.get("instrument-type", "").lower() in ("equity option", "future option")


def safe_price(val):
    """Return positive float or None."""
    try:
        p = float(val)
        return p if p > 0 else None
    except (TypeError, ValueError):
        return None


def compute_naked_qty(legs, order_price):
    """
    Returns {underlying: naked_qty} for option legs, where naked_qty > 0.

    Primary test (always applied): quantity parity.
      naked_qty = max(0, STO_qty - BTO_qty) per underlying.

    Secondary test (only for single STO+BTO pairs with per-leg prices):
      If the BTO leg has a price field set to < 5% of STO credit, the
      BTO is treated as decorative and the STO is counted as naked.
      This closes the near-zero-wing bypass.
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

        # Primary: quantity parity
        unhedged = max(0.0, sto_total - bto_total)
        if unhedged > 0:
            naked[underlying] = unhedged
            continue

        # Secondary: meaningful debit (single-leg pairs with per-leg prices)
        if (
            len(sto_list) == 1
            and len(bto_list) == 1
            and order_price is not None
        ):
            bto_leg_price = safe_price(bto_list[0][1].get("price"))
            if bto_leg_price is not None:
                min_debit = order_price * MIN_BTO_DEBIT_FRACTION
                if bto_leg_price < min_debit:
                    naked[underlying] = sto_list[0][0]

    return naked


def validate_bracket(order, naked_underlyings):
    """
    Returns (ok, problems_list). Validates OTOCO type, LIMIT + STOP child
    orders, mandatory positive child prices, and correct price levels vs
    the parent order credit. All three prices must be present and non-zero.
    """
    order_type = order.get("order-type", "").upper()
    children = order.get("orders", [])

    if order_type != "OTOCO":
        return False, [
            "order-type must be OTOCO (got: {!r}) -- naked exposure on: {}".format(
                order.get("order-type", "not set"),
                ", ".join(sorted(naked_underlyings)),
            )
        ]

    if not children:
        return False, ["OTOCO order has no child bracket orders (need LIMIT + STOP)"]

    profit_orders = [c for c in children if c.get("order-type", "").upper() == "LIMIT"]
    stop_orders = [
        c for c in children
        if c.get("order-type", "").upper() in ("STOP", "STOP_LIMIT", "STOP LIMIT")
    ]

    problems = []
    if not profit_orders:
        problems.append("missing profit-target child order (LIMIT at 50% of credit)")
    if not stop_orders:
        problems.append("missing stop-loss child order (STOP at 2x credit)")
    if problems:
        return False, problems

    profit_price = safe_price(profit_orders[0].get("price"))
    stop_price = safe_price(stop_orders[0].get("price"))

    if profit_price is None:
        problems.append(
            "LIMIT child price is missing or zero -- "
            "must be set to ~50% of the credit received"
        )
    if stop_price is None:
        problems.append(
            "STOP child price is missing or zero -- "
            "must be set to ~2x the credit received"
        )
    if problems:
        return False, problems

    credit = safe_price(order.get("price"))
    if credit is None:
        problems.append(
            "parent order credit (order.price) is missing or zero -- "
            "must be set so bracket prices can be validated "
            "(required: LIMIT=50% of credit, STOP=2x credit)"
        )
        return False, problems

    tol = BRACKET_PRICE_TOLERANCE

    target = credit * 0.5
    lo, hi = target * (1 - tol), target * (1 + tol)
    if not (lo <= profit_price <= hi):
        problems.append(
            "LIMIT price ${:.2f} outside ${:.2f}-${:.2f} "
            "(50% of ${:.2f} credit, +-30%)".format(profit_price, lo, hi, credit)
        )

    target = credit * 2.0
    lo, hi = target * (1 - tol), target * (1 + tol)
    if not (lo <= stop_price <= hi):
        problems.append(
            "STOP price ${:.2f} outside ${:.2f}-${:.2f} "
            "(2x ${:.2f} credit, +-30%)".format(stop_price, lo, hi, credit)
        )

    if problems:
        return False, problems
    return True, []


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
    legs = collect_legs(order)
    order_price = safe_price(order.get("price"))
    naked = compute_naked_qty(legs, order_price)

    if not naked:
        sys.exit(0)

    ok, problems = validate_bracket(order, naked)
    if ok:
        sys.exit(0)

    summary = ", ".join(
        "{} ({} naked contract{})".format(u, int(q), "s" if q != 1 else "")
        for u, q in sorted(naked.items())
    )

    print(
        "BLOCKED -- naked short premium detected: {summary}\n\n"
        "Bracket issues:\n"
        "{issues}\n\n"
        "Every unhedged Sell-to-Open option requires an OTOCO bracket with explicit prices:\n"
        "  * Profit-target child: LIMIT with price ~50% of credit received\n"
        "  * Stop-loss child:     STOP  with price ~2x  credit received\n\n"
        "Rules:\n"
        "  - 1:1 spreads (BTO qty >= STO qty) are offset and do not require a bracket.\n"
        "  - Ratio spreads (2:1) require a bracket for the unhedged leg.\n"
        "  - Near-zero BTO (< 5% of STO credit) does not count as protection.\n"
        "  - All prices must be non-zero and within 30% of the target levels.".format(
            summary=summary,
            issues="\n".join("  - " + p for p in problems),
        )
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
