#!/usr/bin/env python3
"""
PostToolUse hook: tt-ff-stage2-exearn
Fires on: get_options_greeks

For each calendar expiry pair identified in the get_options_greeks response,
computes the strike-level Forward Factor (FF_strike) using ex-earn IVs when
an earnings event falls within either expiry window.

Stage 2 FF_strike formula (forward-factor.md):
    FF_strike = (IV_front_strike − IV_back_strike) / IV_back_strike

Ex-earn adjustment: strip earnings jump variance from whichever expiry window
contains the earnings event before computing FF_strike.
    IV_exearn² = IV_raw² − implied_move² / T    (T in years)

Reads:
  /tmp/tt_earnings_moves.json  — symbol → implied_move fraction
  /tmp/tt_earnings_dates.json  — symbol → earnings date (ISO format "YYYY-MM-DD")

The hook exits 0 in all cases (advisory only; does not block).
"""

import json
import os
import re
import sys
from datetime import date

from tt_hook_utils import (
    parse_greeks_items,
    load_earnings_moves,
    compute_exearn_iv,
)

WATCHED_TOOLS = {"get_options_greeks"}

EARNINGS_DATES_FILE = "/tmp/tt_earnings_dates.json"


# ---------------------------------------------------------------------------
# Option symbol parsing
# ---------------------------------------------------------------------------

# Matches TastyTrade option symbol formats:
#   ".AAPL260516C00200000"
#   "AAPL 260516C00200000"
#   ".AAPL260516C00200000" (with leading dot)
_SYMBOL_RE = re.compile(r"\.?(\w+?)(\d{6})([CP])(\d+)$")


def parse_option_symbol(symbol):
    """
    Parse a TastyTrade option symbol and return
    (underlying, expiry_date, opt_type, strike_str) or None.

    Handles:
      .AAPL260516C00200000
      AAPL 260516C00200000
    """
    s = (symbol or "").strip().replace(" ", "")
    m = _SYMBOL_RE.match(s)
    if not m:
        return None
    underlying = m.group(1).upper()
    date_str = m.group(2)
    opt_type = m.group(3)
    strike_str = m.group(4)
    try:
        expiry = date(
            2000 + int(date_str[:2]),
            int(date_str[2:4]),
            int(date_str[4:6]),
        )
    except ValueError:
        return None
    return underlying, expiry, opt_type, strike_str


# ---------------------------------------------------------------------------
# Sidecar loaders
# ---------------------------------------------------------------------------

def load_earnings_dates():
    """
    Load /tmp/tt_earnings_dates.json → {SYMBOL: date}.
    Returns {} on missing or malformed file.
    """
    if not os.path.exists(EARNINGS_DATES_FILE):
        return {}
    try:
        with open(EARNINGS_DATES_FILE) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    result = {}
    for sym, val in data.items():
        try:
            result[str(sym).upper()] = date.fromisoformat(str(val))
        except (ValueError, TypeError):
            continue
    return result


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(
            "tt-ff-stage2-exearn: failed to parse hook input: {}".format(e),
            file=sys.stderr,
        )
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in WATCHED_TOOLS:
        sys.exit(0)

    tool_response = hook_input.get("tool_response", [])
    items = parse_greeks_items(tool_response)
    if not items:
        sys.exit(0)

    # ------------------------------------------------------------------
    # Group option data by (underlying, opt_type, strike) across expiries
    # ------------------------------------------------------------------
    # Structure: groups[(underlying, opt_type, strike_str)][expiry_date] = iv
    groups = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        sym = item.get("symbol", "")
        iv_val = item.get("implied-volatility")
        if iv_val is None:
            continue
        try:
            iv = float(iv_val)
        except (TypeError, ValueError):
            continue
        if iv <= 0:
            continue

        parsed = parse_option_symbol(sym)
        if parsed is None:
            continue
        underlying, expiry, opt_type, strike_str = parsed

        key = (underlying, opt_type, strike_str)
        groups.setdefault(key, {})
        # Keep only the first IV seen per expiry per key (no overwrite needed)
        if expiry not in groups[key]:
            groups[key][expiry] = iv

    if not groups:
        sys.exit(0)

    # ------------------------------------------------------------------
    # Identify calendar pairs (two distinct expiries for the same key)
    # ------------------------------------------------------------------
    earnings_moves = load_earnings_moves()
    earnings_dates = load_earnings_dates()
    today = date.today()

    # Collect results per underlying so we can print a summary per name
    # results[(underlying, opt_type)] = list of strike result dicts
    results = {}

    for (underlying, opt_type, strike_str), expiry_map in groups.items():
        sorted_expiries = sorted(expiry_map.keys())
        if len(sorted_expiries) < 2:
            continue

        # Use the earliest as front and the latest as back
        front_expiry = sorted_expiries[0]
        back_expiry = sorted_expiries[-1]

        if front_expiry <= today:
            continue

        dte_front = (front_expiry - today).days
        dte_back = (back_expiry - today).days

        iv_front_raw = expiry_map[front_expiry]
        iv_back_raw = expiry_map[back_expiry]

        # Determine earnings window membership
        earn_date = earnings_dates.get(underlying)
        earn_in_front = (
            earn_date is not None and today < earn_date <= front_expiry
        )
        earn_in_back = (
            earn_date is not None
            and front_expiry < earn_date <= back_expiry
        )

        # Apply ex-earn IV stripping if earnings fall in either window
        iv_front = iv_front_raw
        iv_back = iv_back_raw
        implied_move = earnings_moves.get(underlying) if (earn_in_front or earn_in_back) else None
        exearn_applied = False
        exearn_failed = False

        if implied_move is not None:
            if earn_in_front:
                iv_fe = compute_exearn_iv(iv_front_raw, dte_front, implied_move)
                if iv_fe is not None:
                    iv_front = iv_fe
                    exearn_applied = True
                else:
                    exearn_failed = True
            elif earn_in_back:
                iv_be = compute_exearn_iv(iv_back_raw, dte_back, implied_move)
                if iv_be is not None:
                    iv_back = iv_be
                    exearn_applied = True
                else:
                    exearn_failed = True

        # Compute FF_strike (Stage 2 formula)
        if iv_back <= 0:
            continue
        ff_strike = (iv_front - iv_back) / iv_back
        ff_raw = (iv_front_raw - iv_back_raw) / iv_back_raw

        key2 = (underlying, opt_type)
        results.setdefault(key2, [])
        results[key2].append({
            "strike_str": strike_str,
            "front_expiry": front_expiry,
            "back_expiry": back_expiry,
            "dte_front": dte_front,
            "dte_back": dte_back,
            "iv_front_raw": iv_front_raw,
            "iv_back_raw": iv_back_raw,
            "iv_front": iv_front,
            "iv_back": iv_back,
            "ff_raw": ff_raw,
            "ff_strike": ff_strike,
            "earn_date": earn_date,
            "earn_in_front": earn_in_front,
            "earn_in_back": earn_in_back,
            "implied_move": implied_move,
            "exearn_applied": exearn_applied,
            "exearn_failed": exearn_failed,
        })

    if not results:
        sys.exit(0)

    # ------------------------------------------------------------------
    # Emit the Stage 2 ex-earn FF_strike report
    # ------------------------------------------------------------------
    print("=== STAGE 2 FF_STRIKE SCAN ===")

    for (underlying, opt_type), strike_rows in sorted(results.items()):
        if not strike_rows:
            continue

        # Use the first row's expiry info (all rows share the same expiry pair)
        first = strike_rows[0]
        front_expiry = first["front_expiry"]
        back_expiry = first["back_expiry"]
        earn_date = first["earn_date"]
        earn_in_front = first["earn_in_front"]
        earn_in_back = first["earn_in_back"]
        implied_move = first["implied_move"]
        exearn_applied_any = any(r["exearn_applied"] for r in strike_rows)
        exearn_failed_any = any(r["exearn_failed"] for r in strike_rows)

        print(
            "\n{} {} {}/{} (front DTE={}, back DTE={})".format(
                underlying,
                opt_type,
                front_expiry.strftime("%b%d"),
                back_expiry.strftime("%b%d"),
                first["dte_front"],
                first["dte_back"],
            )
        )

        if earn_date and (earn_in_front or earn_in_back):
            window = "FRONT" if earn_in_front else "BACK"
            if implied_move is not None:
                print(
                    "  Earnings {} fall in {} expiry window — ex-earn IV stripping applied "
                    "(implied move {:.1f}%)".format(earn_date, window, implied_move * 100)
                )
            else:
                print(
                    "  Earnings {} fall in {} expiry window — no implied move in sidecar "
                    "(tt_earnings_moves.json); raw IVs used. Populate the sidecar to enable "
                    "ex-earn stripping.".format(earn_date, window)
                )
            if exearn_failed_any:
                print(
                    "  ⚠ Some strikes: earnings variance exceeds total IV variance — "
                    "raw IV used at those strikes (earnings premium dominates)."
                )

        # Sort strikes for display (numeric)
        def strike_sort_key(r):
            try:
                return float(r["strike_str"]) / 1000.0 if len(r["strike_str"]) > 4 else float(r["strike_str"])
            except ValueError:
                return 0.0

        sorted_rows = sorted(strike_rows, key=strike_sort_key)

        best_row = max(sorted_rows, key=lambda r: r["ff_strike"])

        header_parts = ["  {:>10}  {:>10}  {:>10}".format("Strike", "IV_front", "IV_back")]
        if exearn_applied_any or exearn_failed_any:
            header_parts.append("  {:>12}  {:>12}  {:>12}  {:>12}".format(
                "IVf_exearn", "IVb_exearn", "FF_raw", "FF_exearn"
            ))
        else:
            header_parts.append("  {:>12}".format("FF_strike"))
        print("".join(header_parts))

        for r in sorted_rows:
            # Format strike (OCC format has leading zeros; display as price)
            try:
                strike_disp = "{:.1f}".format(int(r["strike_str"]) / 1000.0)
            except ValueError:
                strike_disp = r["strike_str"]

            best_marker = " ◄ BEST" if r is best_row and r["ff_strike"] > 0 else ""

            row_parts = ["  {:>10}  {:>10.1f}%  {:>10.1f}%".format(
                strike_disp,
                r["iv_front_raw"] * 100,
                r["iv_back_raw"] * 100,
            )]
            if exearn_applied_any or exearn_failed_any:
                row_parts.append("  {:>12}  {:>12}  {:>12}  {:>12}{}".format(
                    "{:.1f}%".format(r["iv_front"] * 100) if r["exearn_applied"] or not r["earn_in_front"] else "n/a",
                    "{:.1f}%".format(r["iv_back"] * 100) if r["exearn_applied"] or not r["earn_in_back"] else "n/a",
                    "{:+.1f}%".format(r["ff_raw"] * 100),
                    "{:+.1f}%".format(r["ff_strike"] * 100),
                    best_marker,
                ))
            else:
                row_parts.append("  {:>12}{}".format(
                    "{:+.1f}%".format(r["ff_strike"] * 100),
                    best_marker,
                ))
            print("".join(row_parts))

        # Summary
        if best_row["ff_strike"] > 0:
            try:
                best_strike_disp = "{:.1f}".format(int(best_row["strike_str"]) / 1000.0)
            except ValueError:
                best_strike_disp = best_row["strike_str"]
            adj = " (ex-earn)" if exearn_applied_any else ""
            print(
                "  → Best strike: {}{} FF_strike{} = {:+.1f}%  — enter here per Stage 2 rule".format(
                    opt_type, best_strike_disp, adj, best_row["ff_strike"] * 100
                )
            )
        else:
            print(
                "  → FF_strike ≤ 0 at all strikes — term-structure signal was aggregate noise; "
                "do NOT enter (Stage 2 hard gate)"
            )

    sys.exit(0)


if __name__ == "__main__":
    main()
