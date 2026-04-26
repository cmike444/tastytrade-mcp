#!/usr/bin/env python3
"""
PostToolUse hook: tt-calendar-expiry-alert
Fires on: get_market_metrics (detail="full")  OR  get_positions

For each open calendar position (read from /tmp/tt_positions.json), checks
whether the front (short) leg expires today or tomorrow (≤ 1 DTE).  If so,
warns the agent to close the spread before the market close to avoid pin risk
and assignment — per the Forward Factor exit rule (a).

The hook exits 0 in all cases (warning only; does not block).
"""

import json
import os
import re
import sys
from datetime import date

WATCHED_TOOLS = {"get_market_metrics", "get_positions"}
POSITIONS_FILE = "/tmp/tt_positions.json"


# ---------------------------------------------------------------------------
# OCC symbol parsing  (shared pattern with tt-ff-exit-monitor)
# ---------------------------------------------------------------------------

def parse_occ_symbol(symbol):
    """
    Parse an OCC option symbol.

    Supported formats:
      Equity option:  "AAPL 240119C00150000"
      Future option:  "./ESM4 EW1M4 240119C4800"

    Returns (underlying_root, expiry_date, opt_type, strike_raw) or None.
    """
    s = (symbol or "").strip()
    m = re.search(r"(\d{6})([CP])(\d+)$", s)
    if not m:
        return None
    date_str, opt_type, strike_raw = m.group(1), m.group(2), m.group(3)
    try:
        expiry = date(2000 + int(date_str[:2]), int(date_str[2:4]), int(date_str[4:6]))
    except ValueError:
        return None
    prefix = s[: m.start()].strip()
    parts = prefix.split()
    if not parts:
        return None
    raw_underlying = parts[0]
    is_future = raw_underlying.startswith("./")
    underlying = raw_underlying.lstrip("./").upper()
    # For futures underlyings (e.g. "./ESM6", "./ESU6") strip the trailing
    # contract-month suffix (one CME month letter + 1–2 digit year) so that
    # legs on different contract months (ESM6 vs ESU6) share the same root
    # (ES) and are correctly grouped as a calendar pair.
    if is_future:
        underlying = re.sub(r"[FGHJKMNQUVXZ]\d{1,2}$", "", underlying)
    return underlying, expiry, opt_type, strike_raw


# ---------------------------------------------------------------------------
# Load positions and detect calendar pairs
# ---------------------------------------------------------------------------

def load_calendar_pairs():
    """
    Read /tmp/tt_positions.json and return a list of detected calendar spreads.

    A calendar pair is two option positions sharing the same underlying,
    option type (C/P), and strike, with different expiry dates — one Short
    (front/near) and one Long (back/far).

    Returns a list of dicts:
      {underlying, opt_type, strike_raw, front_expiry (date), back_expiry (date)}
    """
    if not os.path.exists(POSITIONS_FILE):
        return []
    try:
        with open(POSITIONS_FILE) as f:
            positions = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []

    if not isinstance(positions, list):
        return []

    groups = {}
    for pos in positions:
        instrument_type = pos.get("instrument-type", "").lower()
        if "option" not in instrument_type:
            continue
        qty_dir = (pos.get("quantity-direction") or "").strip()
        if qty_dir not in ("Long", "Short"):
            continue
        parsed = parse_occ_symbol(pos.get("symbol", ""))
        if not parsed:
            continue
        underlying, expiry, opt_type, strike_raw = parsed
        key = (underlying, opt_type, strike_raw)
        groups.setdefault(key, {})
        if qty_dir == "Short":
            existing = groups[key].get("Short")
            if existing is None or expiry < existing:
                groups[key]["Short"] = expiry
        else:
            existing = groups[key].get("Long")
            if existing is None or expiry > existing:
                groups[key]["Long"] = expiry

    calendars = []
    for (underlying, opt_type, strike_raw), legs in groups.items():
        front_expiry = legs.get("Short")
        back_expiry = legs.get("Long")
        if front_expiry is None or back_expiry is None:
            continue
        if back_expiry <= front_expiry:
            continue
        calendars.append(
            {
                "underlying": underlying,
                "opt_type": opt_type,
                "strike_raw": strike_raw,
                "front_expiry": front_expiry,
                "back_expiry": back_expiry,
            }
        )
    return calendars


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(
            "tt-calendar-expiry-alert: failed to parse hook input: {}".format(e),
            file=sys.stderr,
        )
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in WATCHED_TOOLS:
        sys.exit(0)

    # For get_market_metrics, only fire when detail="full"
    if tool_name == "get_market_metrics":
        detail = str(hook_input.get("tool_input", {}).get("detail", "")).lower()
        if detail != "full":
            sys.exit(0)

    calendars = load_calendar_pairs()
    if not calendars:
        sys.exit(0)

    today = date.today()
    warnings = []

    for cal in calendars:
        front_expiry = cal["front_expiry"]
        dte = (front_expiry - today).days

        if dte > 1:
            continue

        label = "{} {}{}  {}/{}".format(
            cal["underlying"],
            cal["opt_type"],
            cal["strike_raw"],
            front_expiry.strftime("%b%d"),
            cal["back_expiry"].strftime("%b%d"),
        )

        if dte < 0:
            # Already expired — skip (should not normally happen if positions are current)
            continue

        warnings.append(
            "Calendar {} front leg expires {} — close the spread before market close"
            " to avoid pin risk".format(label, front_expiry.isoformat())
        )

    if warnings:
        print("=== CALENDAR EXPIRY ALERT ===")
        for w in warnings:
            print("⚠", w)
        print(
            "\nExit rule (forward-factor.md §a): close on front expiry day as a spread"
            " before the close — avoids pin risk and assignment."
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
