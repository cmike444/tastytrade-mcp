#!/usr/bin/env python3
"""
PostToolUse hook: tt-ff-exit-monitor
Fires on: get_market_metrics (detail="full")

For each open calendar position (read from /tmp/tt_positions.json), computes
the Forward Factor (FF) using the term structure data injected by
get_market_metrics. If any calendar's FF has dropped to <= 0%, warns the agent
that the edge is gone and the exit rule requires closing the position.

FF formula (forward-factor.md):
  σ_fwd² = (σ₂² × T₂ − σ₁² × T₁) / (T₂ − T₁)   [T in years]
  σ_fwd  = sqrt(σ_fwd²)
  FF     = (FrontIV − σ_fwd) / σ_fwd

Where:
  σ₁, T₁ = IV and DTE of the front (short) leg
  σ₂, T₂ = IV and DTE of the back  (long)  leg

Exit rule: close when FF ≤ 0 (forward vol edge is gone — trade is now pure
theta with no structural edge).

The hook exits 0 in all cases (warning only; does not block).
"""

import json
import math
import os
import re
import sys
from datetime import date

WATCHED_TOOLS = {"get_market_metrics"}
POSITIONS_FILE = "/tmp/tt_positions.json"

# Sidecar file: maps SYMBOL → earnings implied move fraction (straddle/stock).
# Written by the user or a prefetch script before get_market_metrics is called.
# Example: {"AAPL": 0.05, "SPY": 0.02}
EARNINGS_MOVES_FILE = "/tmp/tt_earnings_moves.json"

# Maximum days difference allowed when matching a calendar expiry to a term
# structure entry that does not fall exactly on that expiry.
MAX_EXPIRY_MATCH_DAYS = 7


# ---------------------------------------------------------------------------
# OCC symbol parsing
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
    underlying = parts[0].lstrip("./").upper()
    return underlying, expiry, opt_type, strike_raw


# ---------------------------------------------------------------------------
# Load positions and detect calendar pairs
# ---------------------------------------------------------------------------

def load_calendar_pairs():
    """
    Read /tmp/tt_positions.json and return a list of detected calendar spreads.

    A calendar pair is identified as two option positions sharing the same
    underlying, option type (C/P), and strike, with different expiry dates,
    one Short (front/near) and one Long (back/far).

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
# Extract term structure and earnings dates from the get_market_metrics response
# ---------------------------------------------------------------------------

def _try_parse_json(value):
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def _parse_items(tool_response):
    """
    Shared JSON-parsing helper that returns the list of per-symbol metric items
    from a get_market_metrics tool response.
    """
    raw = tool_response

    if isinstance(raw, list):
        text_parts = [
            b.get("text", "")
            for b in raw
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        combined = "\n".join(text_parts)
        raw = _try_parse_json(combined) or raw

    if isinstance(raw, str):
        raw = _try_parse_json(raw) or {}

    items = []
    if isinstance(raw, dict):
        data = raw.get("data", raw)
        if isinstance(data, dict):
            items = data.get("items", [])
        elif isinstance(data, list):
            items = data
    elif isinstance(raw, list):
        items = raw

    return items if isinstance(items, list) else []


def extract_earnings_dates(tool_response):
    """
    Parse the get_market_metrics tool response and return a mapping:
      { SYMBOL_UPPER: date }

    Only symbols with a valid 'earnings-next-date' field are included.
    """
    result = {}
    for item in _parse_items(tool_response):
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol", "")).upper()
        if not symbol:
            continue
        earn_str = item.get("earnings-next-date")
        if not earn_str:
            continue
        try:
            result[symbol] = date.fromisoformat(str(earn_str))
        except (ValueError, TypeError):
            continue
    return result


def extract_term_structures(tool_response):
    """
    Parse the get_market_metrics tool response and return a mapping:
      { SYMBOL_UPPER: [ {expiration_date: date, iv: float}, ... ] }

    The response arrives as a list of MCP content blocks:
      [{"type": "text", "text": "{...json...}"}]

    The JSON body can have various shapes; we try to handle them all.
    """
    result = {}
    for item in _parse_items(tool_response):
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol", "")).upper()
        if not symbol:
            continue
        expirations_raw = item.get("option-expiration-implied-volatilities", [])
        if not isinstance(expirations_raw, list):
            continue
        expirations = []
        for exp in expirations_raw:
            if not isinstance(exp, dict):
                continue
            exp_date_str = exp.get("expiration-date", "")
            iv_val = exp.get("implied-volatility")
            if not exp_date_str or iv_val is None:
                continue
            try:
                exp_date = date.fromisoformat(exp_date_str)
                iv = float(iv_val)
                if iv > 0:
                    expirations.append({"expiration_date": exp_date, "iv": iv})
            except (ValueError, TypeError):
                continue
        if expirations:
            result[symbol] = sorted(expirations, key=lambda x: x["expiration_date"])

    return result


# ---------------------------------------------------------------------------
# Earnings implied-move sidecar
# ---------------------------------------------------------------------------

def load_earnings_moves():
    """
    Load /tmp/tt_earnings_moves.json and return a dict mapping SYMBOL → implied_move.

    implied_move is a fraction representing the market-expected one-standard-deviation
    earnings move: straddle_price / stock_price (e.g. 0.05 = 5%).

    Returns an empty dict if the file is absent or malformed.
    """
    if not os.path.exists(EARNINGS_MOVES_FILE):
        return {}
    try:
        with open(EARNINGS_MOVES_FILE) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    result = {}
    for sym, val in data.items():
        try:
            move = float(val)
            if move > 0:
                result[str(sym).upper()] = move
        except (TypeError, ValueError):
            continue
    return result


# ---------------------------------------------------------------------------
# Ex-earn IV computation
# ---------------------------------------------------------------------------

def compute_exearn_iv(iv_raw, dte, implied_move):
    """
    Strip the earnings jump variance from iv_raw to obtain the ex-earnings IV.

    Formula (from computations.md):
        IV_exearn² × T = IV_raw² × T − implied_move²
        => IV_exearn² = IV_raw² − implied_move² / T

    Args:
        iv_raw:       Raw IV in decimal (e.g. 0.30 = 30%).
        dte:          Calendar days to expiry of the window containing earnings.
        implied_move: Earnings implied move fraction (straddle / stock price).

    Returns the ex-earn IV in decimal, or None if the result would be imaginary
    (i.e. the full variance is dominated by the earnings jump).
    """
    t = dte / 365.0
    if t <= 0 or implied_move <= 0 or iv_raw <= 0:
        return None
    var_exearn = iv_raw ** 2 - (implied_move ** 2) / t
    if var_exearn <= 0:
        return None
    return math.sqrt(var_exearn)


# ---------------------------------------------------------------------------
# Forward vol and FF computation
# ---------------------------------------------------------------------------

def compute_forward_vol(iv_front, dte_front, iv_back, dte_back):
    """
    Compute forward implied volatility between the front and back expiry.
    IVs in decimal (e.g., 0.30 = 30%). DTEs in calendar days.
    Returns forward vol in decimal, or None if the calculation is invalid.
    """
    t1 = dte_front / 365.0
    t2 = dte_back / 365.0
    if t2 <= t1 or t1 <= 0 or iv_front <= 0 or iv_back <= 0:
        return None
    var_total = (iv_back ** 2) * t2
    var_near = (iv_front ** 2) * t1
    var_forward = var_total - var_near
    if var_forward <= 0:
        return None
    return math.sqrt(var_forward / (t2 - t1))


def compute_ff(iv_front, fwd_vol):
    """
    FF = (FrontIV − FwdVol) / FwdVol

    Returns FF as a decimal (e.g., 0.30 = 30%), or None if invalid.
    FF > 0 → front elevated above forward vol → calendar has edge.
    FF ≤ 0 → front at or below forward vol → edge is gone.
    """
    if fwd_vol is None or fwd_vol <= 0:
        return None
    return (iv_front - fwd_vol) / fwd_vol


# ---------------------------------------------------------------------------
# Find the IV entry in a term structure closest to a target date
# ---------------------------------------------------------------------------

def find_iv_for_expiry(term_structure, target_date):
    """
    Return (iv, matched_date) for the term structure entry closest to
    target_date, within MAX_EXPIRY_MATCH_DAYS.  Returns (None, None) if no
    entry qualifies.
    """
    best_entry = None
    best_delta = None
    for entry in term_structure:
        delta = abs((entry["expiration_date"] - target_date).days)
        if delta <= MAX_EXPIRY_MATCH_DAYS:
            if best_delta is None or delta < best_delta:
                best_delta = delta
                best_entry = entry
    if best_entry is None:
        return None, None
    return best_entry["iv"], best_entry["expiration_date"]


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(
            "tt-ff-exit-monitor: failed to parse hook input: {}".format(e),
            file=sys.stderr,
        )
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in WATCHED_TOOLS:
        sys.exit(0)

    detail = str(hook_input.get("tool_input", {}).get("detail", "")).lower()
    if detail != "full":
        sys.exit(0)

    calendars = load_calendar_pairs()
    if not calendars:
        sys.exit(0)

    tool_response = hook_input.get("tool_response", [])
    term_structures = extract_term_structures(tool_response)
    if not term_structures:
        sys.exit(0)

    earnings_dates = extract_earnings_dates(tool_response)
    earnings_moves = load_earnings_moves()

    today = date.today()
    warnings = []
    advisories = []

    for cal in calendars:
        underlying = cal["underlying"]
        term = term_structures.get(underlying)
        if not term:
            continue

        front_expiry = cal["front_expiry"]
        back_expiry = cal["back_expiry"]

        if front_expiry <= today:
            continue

        dte_front = (front_expiry - today).days
        dte_back = (back_expiry - today).days

        iv_front, _ = find_iv_for_expiry(term, front_expiry)
        iv_back, _ = find_iv_for_expiry(term, back_expiry)

        if iv_front is None or iv_back is None:
            continue

        fwd_vol = compute_forward_vol(iv_front, dte_front, iv_back, dte_back)
        if fwd_vol is None:
            continue

        ff = compute_ff(iv_front, fwd_vol)
        if ff is None:
            continue

        label = "{} {}{}  {}/{}".format(
            underlying,
            cal["opt_type"],
            cal["strike_raw"],
            front_expiry.strftime("%b%d"),
            back_expiry.strftime("%b%d"),
        )
        ff_pct = ff * 100

        earn_date = earnings_dates.get(underlying)
        earn_in_front = (
            earn_date is not None and today < earn_date <= front_expiry
        )
        earn_in_back = (
            earn_date is not None and front_expiry < earn_date <= back_expiry
        )

        # ------------------------------------------------------------------
        # Ex-earn IV adjustment: strip earnings jump variance from whichever
        # expiry window contains the earnings event, then recompute FF.
        # Formula: IV_exearn² × T = IV_raw² × T − implied_move²
        # ------------------------------------------------------------------
        implied_move = earnings_moves.get(underlying) if (earn_in_front or earn_in_back) else None
        ff_exearn = None
        fwd_vol_exearn = None
        iv_front_exearn = iv_front
        iv_back_exearn = iv_back

        if implied_move is not None:
            adjustment_applied = False
            if earn_in_front:
                iv_fe = compute_exearn_iv(iv_front, dte_front, implied_move)
                if iv_fe is not None:
                    iv_front_exearn = iv_fe
                    adjustment_applied = True
            elif earn_in_back:
                iv_be = compute_exearn_iv(iv_back, dte_back, implied_move)
                if iv_be is not None:
                    iv_back_exearn = iv_be
                    adjustment_applied = True

            if adjustment_applied:
                fwd_vol_exearn = compute_forward_vol(
                    iv_front_exearn, dte_front, iv_back_exearn, dte_back
                )
                ff_exearn = compute_ff(iv_front_exearn, fwd_vol_exearn)

        if ff <= 0:
            warn_lines = [
                "Forward Factor edge is gone on {} — rule requires closing this position"
                "  (FF = {:.1f}%, front IV = {:.1f}%, fwd vol = {:.1f}%)".format(
                    label, ff_pct, iv_front * 100, fwd_vol * 100
                )
            ]
            if earn_in_back:
                if ff_exearn is not None:
                    warn_lines.append(
                        "  ► Earnings on {} fall within the BACK expiry window — back IV "
                        "includes earnings premium (implied move {:.1f}%). "
                        "Ex-earn FF = {:.1f}% (ex-earn front IV {:.1f}%, ex-earn fwd vol {:.1f}%). "
                        "{}".format(
                            earn_date,
                            implied_move * 100,
                            ff_exearn * 100,
                            iv_front_exearn * 100,
                            fwd_vol_exearn * 100,
                            "Ex-earn FF is also ≤ 0 — closing remains appropriate."
                            if ff_exearn <= 0
                            else "Ex-earn FF is positive — back earnings premium was masking the true signal; verify before closing.",
                        )
                    )
                else:
                    warn_lines.append(
                        "  ► Earnings on {} fall within the BACK expiry window — back IV "
                        "may include earnings premium, which could make FF appear lower than "
                        "the true ex-earn FF. Verify ex-earn FF before closing.".format(
                            earn_date
                        )
                    )
            elif earn_in_front:
                if ff_exearn is not None:
                    warn_lines.append(
                        "  ► Earnings on {} fall within the FRONT expiry window — front IV "
                        "includes earnings premium (implied move {:.1f}%). "
                        "Ex-earn FF = {:.1f}% (ex-earn front IV {:.1f}%, ex-earn fwd vol {:.1f}%). "
                        "Ex-earn FF is even lower; closing remains appropriate.".format(
                            earn_date,
                            implied_move * 100,
                            ff_exearn * 100,
                            iv_front_exearn * 100,
                            fwd_vol_exearn * 100,
                        )
                    )
                else:
                    warn_lines.append(
                        "  ► Earnings on {} fall within the FRONT expiry window — front IV "
                        "may include earnings premium. Ex-earn FF may be even lower; "
                        "closing remains appropriate.".format(earn_date)
                    )
            warnings.append("\n".join(warn_lines))
        elif earn_in_front or earn_in_back:
            window = "front" if earn_in_front else "back"
            if ff_exearn is not None:
                advisories.append(
                    "{} — raw FF = {:.1f}%, ex-earn FF = {:.1f}% "
                    "(implied move {:.1f}%, earnings on {} in {} window, "
                    "ex-earn front IV {:.1f}%, ex-earn fwd vol {:.1f}%). "
                    "{}".format(
                        label,
                        ff_pct,
                        ff_exearn * 100,
                        implied_move * 100,
                        earn_date,
                        window,
                        iv_front_exearn * 100,
                        fwd_vol_exearn * 100,
                        "Ex-earn FF ≥ 0 — edge confirmed after stripping earnings premium."
                        if ff_exearn >= 0
                        else "Ex-earn FF < 0 — edge is gone after stripping earnings premium; consider closing.",
                    )
                )
            else:
                advisories.append(
                    "{} — FF = {:.1f}% (positive, no exit signal). "
                    "Earnings on {} fall within the {} expiry window — raw IVs include "
                    "earnings premium. Confirm ex-earn FF ≥ 0 before relying on this signal.".format(
                        label, ff_pct, earn_date, window
                    )
                )

    if warnings or advisories:
        print("=== FF EXIT MONITOR ===")
        for w in warnings:
            print("⚠", w)
        if warnings:
            print(
                "\nExit rule (forward-factor.md): close the calendar when FF ≤ 0% — "
                "the forward vol edge has mean-reverted and the trade is now pure theta."
            )
        if advisories:
            print("\n--- Earnings-IV Advisory ---")
            for a in advisories:
                print("ℹ", a)

    sys.exit(0)


if __name__ == "__main__":
    main()
