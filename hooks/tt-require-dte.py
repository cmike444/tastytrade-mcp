#!/usr/bin/env python3
"""
PreToolUse hook: tt-require-dte
Fires on: create_order, create_complex_order

Warns when any Sell-to-Open option leg in the order is already at or inside
the configurable DTE threshold (default 21, override via TT_DTE_WARN_THRESHOLD).
The threshold is a mechanical time stop — VRP positions should be entered with
enough time remaining to capture premium before the gamma-risk zone begins.

Per-strategy thresholds can be set via TT_DTE_THRESHOLDS (comma-separated
name:value pairs, e.g. "iron_condor:30,covered_call:14").  When an order
carries a "strategy" field in its payload the matching per-strategy threshold
is used; otherwise the global threshold applies.

This hook does NOT block the order (exit 1 = warning). The agent receives
the warning in context and should confirm the DTE is intentional before
proceeding. Hard exits belong to the EOD management process, not entry gating.

Exemptions (hook exits 0 silently):
  - Non-option instruments (equities, futures, crypto)
  - Closing orders only (Buy to Close / Sell to Close)
  - 0DTE entries (DTE = 0) — these are valid intraday entries by design
  - Orders with no parseable expiry date in any STO option leg

OCC symbol format: AAPL 240119C00150000  (YYMMDD embedded before C/P)
Future option:    ./ESM4 EW1M4 240119C4800
"""

import json
import os
import re
import sys
from datetime import date

WATCHED_TOOLS = {"create_order", "create_complex_order"}

# ---------------------------------------------------------------------------
# Global threshold (TT_DTE_WARN_THRESHOLD)
# ---------------------------------------------------------------------------

_dte_env = os.environ.get("TT_DTE_WARN_THRESHOLD", "")
try:
    DTE_WARN_THRESHOLD = int(_dte_env) if _dte_env.strip() else 21
except ValueError:
    print(
        "tt-require-dte: TT_DTE_WARN_THRESHOLD={!r} is not a valid integer; "
        "falling back to 21.".format(_dte_env),
        file=sys.stderr,
    )
    DTE_WARN_THRESHOLD = 21

# ---------------------------------------------------------------------------
# Per-strategy thresholds (TT_DTE_THRESHOLDS)
# Format: "iron_condor:30,covered_call:14"
# ---------------------------------------------------------------------------

_strategy_thresholds = {}
_thresholds_env = os.environ.get("TT_DTE_THRESHOLDS", "")
if _thresholds_env.strip():
    for _entry in _thresholds_env.split(","):
        _entry = _entry.strip()
        if not _entry:
            continue
        if ":" not in _entry:
            print(
                "tt-require-dte: TT_DTE_THRESHOLDS entry {!r} is missing ':'; "
                "skipping.".format(_entry),
                file=sys.stderr,
            )
            continue
        _name, _, _val = _entry.partition(":")
        _name = _name.strip()
        _val = _val.strip()
        try:
            _strategy_thresholds[_name] = int(_val)
        except ValueError:
            print(
                "tt-require-dte: TT_DTE_THRESHOLDS entry {!r} has non-integer value {!r}; "
                "skipping.".format(_entry, _val),
                file=sys.stderr,
            )


def _threshold_for(strategy):
    """Return the DTE threshold for the given strategy name (may be None or '').
    Falls back to the global DTE_WARN_THRESHOLD when no per-strategy value exists."""
    if strategy and strategy in _strategy_thresholds:
        return _strategy_thresholds[strategy]
    return DTE_WARN_THRESHOLD


def _parse_expiry(symbol):
    """
    Return expiration date from an OCC option symbol, or None.
    Matches the 6-digit YYMMDD sequence immediately preceding C or P.
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


def is_sto(leg):
    return leg.get("action", "").lower() == "sell to open"


def collect_opening_legs(order):
    """
    Return opening (STO/BTO) legs from an order.
    For OTOCO orders opening legs are in trigger-order.legs.
    For plain orders they are at top-level legs.
    """
    if order.get("type", "").upper() == "OTOCO":
        return list(order.get("trigger-order", {}).get("legs", []))
    return list(order.get("legs", []))


def check_dte(order):
    """
    Inspect all STO option legs and return a list of (symbol, dte, threshold) tuples
    where dte <= threshold and dte > 0 (0DTE is exempt).
    Returns empty list if nothing to warn about.
    """
    opening_legs = collect_opening_legs(order)
    today = date.today()
    violations = []

    strategy = order.get("strategy", "")
    threshold = _threshold_for(strategy)

    for leg in opening_legs:
        if not is_option(leg):
            continue
        if not is_sto(leg):
            continue
        symbol = leg.get("symbol", "")
        expiry = _parse_expiry(symbol)
        if expiry is None:
            continue
        dte = (expiry - today).days
        if dte <= 0:
            continue
        if dte <= threshold:
            violations.append((symbol, dte, threshold))

    return violations


def main():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print("tt-require-dte: failed to parse hook input: {}".format(e), file=sys.stderr)
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in WATCHED_TOOLS:
        sys.exit(0)

    order = hook_input.get("tool_input", {})
    violations = check_dte(order)

    if not violations:
        sys.exit(0)

    lines = []
    for symbol, dte, threshold in sorted(violations, key=lambda x: x[1]):
        lines.append("  {} — {} DTE (threshold: {} DTE)".format(symbol, dte, threshold))

    # Use the threshold from the first violation for the narrative (they share a strategy)
    narrative_threshold = violations[0][2]

    print(
        "WARNING -- entering at or inside {threshold} DTE:\n"
        "{details}\n\n"
        "The {threshold}-DTE rule is a mechanical time stop: VRP positions should be entered\n"
        "with >{threshold} DTE remaining so they can be closed at {threshold} DTE before gamma risk\n"
        "accelerates. Entering now means the time stop triggers immediately or very\n"
        "soon after entry, leaving no room to capture premium.\n\n"
        "If this is intentional (e.g. an earnings straddle, a same-day roll, or a\n"
        "strategy that explicitly uses short-dated expiries), confirm before proceeding.\n"
        "The order has NOT been blocked — this is an advisory warning.".format(
            threshold=narrative_threshold,
            details="\n".join(lines),
        )
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
