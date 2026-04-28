#!/usr/bin/env python3
"""
PostToolUse hook / standalone prefetch:  tt-fetch-earnings-straddle

─── PostToolUse mode (default, reads stdin) ────────────────────────────────
Fires on: get_options_greeks

Reads the option-item array from the get_options_greeks tool response.
Groups options by (underlying, expiry, strike), selects the ATM straddle
per underlying, and writes:
    implied_move = (ATM_call_mark + ATM_put_mark) / stock_price
to /tmp/tt_earnings_moves.json.

stock_price is taken from the `underlying-price` field in the response when
present.  When absent (greeks-only responses), put-call parity is used to
estimate it:  stock_price ≈ ATM_strike + call_mark − put_mark.

Expiry selection priority:
  1. The calendar front_expiry from /tmp/tt_positions.json if the underlying
     has an open calendar spread (front expiry is the one that "captures"
     earnings).
  2. Otherwise, the nearest future expiry that has a complete call+put pair.

─── Standalone / prefetch mode  (--fetch UNDERLYING EXPIRY_ISO) ────────────
Called directly (by tt-ff-exit-monitor or cron) when the sidecar is absent
for a symbol that has an upcoming earnings event.  Fetches live option
prices from the TastyTrade REST API using the session cache at
/tmp/tt_session_cache.json, computes the ATM straddle, and writes to
/tmp/tt_earnings_moves.json.

Usage:
    python3 hooks/tt-fetch-earnings-straddle.py --fetch AAPL 2026-05-16

Exits 0 on success (even if the underlying is already in the sidecar),
exits 1 on unrecoverable error (missing credentials, API failure, etc.).

Note: this mode calls the TastyTrade REST API directly (GET /market-data/
quotes and GET /option-chains/{sym}/compact) rather than routing through
the get_options_greeks MCP tool.  The standalone mode is invoked outside
an active MCP tool call (e.g. from the FF-exit-monitor subprocess), so
direct REST is the only available path.  The PostToolUse hook mode still
fires on every get_options_greeks tool call and populates the sidecar from
the live greeks payload; the standalone mode is only a self-healing
fallback for the rare case where the sidecar is absent at monitor runtime.

─── Design notes ────────────────────────────────────────────────────────────
ATM is determined by the call option whose |delta − 0.50| is minimised.
When delta is unavailable, ATM is the strike closest to the median of all
available strikes for that expiry.

Both modes merge new entries with existing sidecar content so that prior
data (e.g. from prefetch.py) is not lost.
"""

import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

from tt_hook_utils import (
    EARNINGS_MOVES_FILE,
    parse_greeks_items,
    load_earnings_moves,
)

WATCHED_TOOLS = {"get_options_greeks"}
POSITIONS_FILE = "/tmp/tt_positions.json"
SESSION_CACHE = "/tmp/tt_session_cache.json"
TT_BASE = "https://api.tastytrade.com"


# ---------------------------------------------------------------------------
# OCC / streamer symbol → expiry parsing
# ---------------------------------------------------------------------------

def _parse_expiry_from_symbol(symbol: str):
    """
    Extract the expiry date embedded in a TastyTrade option symbol.

    Supports:
      Equity option streamer: ".AAPL260516C200"  → 2026-05-16
      Equity option OCC:      "AAPL 260516C00200000" → 2026-05-16
      Future option OCC:      "./ESM6 EW1M6 260516C4800" → 2026-05-16

    Returns a date or None.
    """
    m = re.search(r"(\d{6})[CP]", str(symbol or ""))
    if not m:
        return None
    d = m.group(1)
    try:
        return date(2000 + int(d[:2]), int(d[2:4]), int(d[4:6]))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Positions: find calendar front expiries per underlying
# ---------------------------------------------------------------------------

def _load_calendar_front_expiries():
    """
    Read /tmp/tt_positions.json and return {underlying: front_expiry_date}.
    Only underlyings with a detected calendar spread (Short + Long option,
    same type & strike, different expiries) are included.
    """
    result = {}
    if not os.path.exists(POSITIONS_FILE):
        return result
    try:
        with open(POSITIONS_FILE) as f:
            positions = json.load(f)
    except (json.JSONDecodeError, OSError):
        return result
    if not isinstance(positions, list):
        return result

    groups = {}
    for pos in positions:
        instrument_type = pos.get("instrument-type", "").lower()
        if "option" not in instrument_type:
            continue
        qty_dir = (pos.get("quantity-direction") or "").strip()
        if qty_dir not in ("Long", "Short"):
            continue
        symbol = pos.get("symbol", "")
        expiry = _parse_expiry_from_symbol(symbol)
        if expiry is None:
            continue
        m = re.search(r"(\d{6})([CP])(\d+)$", symbol)
        if not m:
            continue
        underlying_raw = symbol[:m.start()].strip().split()[0].lstrip("./").upper()
        # Strip futures contract-month suffix (e.g. ESM6 → ES)
        underlying = re.sub(r"[FGHJKMNQUVXZ]\d{1,2}$", "", underlying_raw)
        opt_type = m.group(2)
        strike = m.group(3)
        key = (underlying, opt_type, strike)
        groups.setdefault(key, {})
        if qty_dir == "Short":
            existing = groups[key].get("Short")
            if existing is None or expiry < existing:
                groups[key]["Short"] = expiry
        else:
            existing = groups[key].get("Long")
            if existing is None or expiry > existing:
                groups[key]["Long"] = expiry

    for (underlying, _opt, _strike), legs in groups.items():
        front = legs.get("Short")
        back = legs.get("Long")
        if front and back and back > front:
            if underlying not in result or front < result[underlying]:
                result[underlying] = front

    return result


# ---------------------------------------------------------------------------
# ATM straddle extraction
# ---------------------------------------------------------------------------

def _mark(item):
    mark = item.get("mark")
    if mark is not None:
        try:
            return float(mark)
        except (TypeError, ValueError):
            pass
    bid = item.get("bid")
    ask = item.get("ask")
    try:
        return (float(bid) + float(ask)) / 2.0
    except (TypeError, ValueError):
        pass
    return None


def _opt_type(item):
    raw = str(item.get("option-type", "") or "").strip().upper()
    if raw in ("C", "CALL"):
        return "C"
    if raw in ("P", "PUT"):
        return "P"
    return None


def _strike(item):
    val = item.get("strike-price") or item.get("strike")
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _delta(item):
    val = item.get("delta")
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _underlying(item):
    raw = (
        item.get("underlying-symbol")
        or item.get("underlying")
        or item.get("root-symbol")
        or ""
    )
    s = str(raw).strip().upper()
    # Strip futures contract-month suffix
    s = re.sub(r"[FGHJKMNQUVXZ]\d{1,2}$", "", s)
    return s if s else None


def compute_implied_moves(items, calendar_front_expiries=None):
    """
    Parse option items into implied moves per underlying.

    Grouping: (underlying, expiry, strike) → {C: {mark, delta}, P: {mark, delta}}

    Expiry selection (per underlying):
      1. Use the calendar front_expiry from calendar_front_expiries if available
         and that expiry has a complete ATM pair.
      2. Fall back to the nearest expiry (≥ today) with a complete straddle pair.

    Returns {underlying: implied_move}.
    """
    if calendar_front_expiries is None:
        calendar_front_expiries = {}

    today = date.today()

    # Structure: data[underlying][expiry][strike][C|P] = {mark, delta}
    data = {}
    # underlying-price harvested from response items (when TT includes it).
    # Used as the straddle denominator; falls back to put-call parity per strike.
    spot_prices: dict[str, float] = {}

    for item in items:
        if not isinstance(item, dict):
            continue
        sym = _underlying(item)
        if not sym:
            # Fall back to parsing from option symbol
            opt_sym = str(item.get("symbol") or "")
            expiry_from_sym = _parse_expiry_from_symbol(opt_sym)
            m = re.search(r"(\d{6})[CP]", opt_sym)
            if not m:
                continue
            prefix = opt_sym[:m.start()].strip()
            parts = prefix.split()
            if not parts:
                continue
            raw_u = parts[0].lstrip("./").upper()
            sym = re.sub(r"[FGHJKMNQUVXZ]\d{1,2}$", "", raw_u)
            if not sym:
                continue

        # Harvest underlying spot price if the API includes it
        for sp_key in ("underlying-price", "underlying-mark", "underlyingPrice"):
            sp_raw = item.get(sp_key)
            if sp_raw is not None:
                try:
                    sp = float(sp_raw)
                    if sp > 0:
                        spot_prices[sym] = sp
                        break
                except (TypeError, ValueError):
                    pass

        strike = _strike(item)
        if strike is None or strike <= 0:
            continue
        opt = _opt_type(item)
        if opt not in ("C", "P"):
            continue
        mark = _mark(item)
        if mark is None or mark < 0:
            continue
        delta = _delta(item)

        # Determine expiry
        expiry = _parse_expiry_from_symbol(str(item.get("symbol", "")))
        if expiry is None:
            continue

        data.setdefault(sym, {})
        data[sym].setdefault(expiry, {})
        data[sym][expiry].setdefault(strike, {})
        data[sym][expiry][strike][opt] = {"mark": mark, "delta": delta}

    result = {}
    for sym, expiries_data in data.items():
        # Candidate expiries: only future/current dates with at least one paired strike
        candidate_expiries = [
            exp for exp, strikes_data in expiries_data.items()
            if exp >= today
            and any("C" in strikes_data[s] and "P" in strikes_data[s] for s in strikes_data)
        ]
        if not candidate_expiries:
            continue

        # Prefer the calendar front_expiry if available and valid
        preferred = calendar_front_expiries.get(sym)
        chosen_expiry = None
        if preferred and preferred in expiries_data:
            strikes_here = expiries_data[preferred]
            if any("C" in strikes_here[s] and "P" in strikes_here[s] for s in strikes_here):
                chosen_expiry = preferred
        if chosen_expiry is None:
            chosen_expiry = min(candidate_expiries)

        strikes_data = expiries_data[chosen_expiry]
        paired_strikes = sorted(
            s for s in strikes_data if "C" in strikes_data[s] and "P" in strikes_data[s]
        )
        if not paired_strikes:
            continue

        # ATM: call with delta closest to 0.50
        calls_with_delta = [
            (s, strikes_data[s]["C"]["delta"])
            for s in paired_strikes
            if strikes_data[s]["C"]["delta"] is not None
        ]
        if calls_with_delta:
            atm_strike = min(calls_with_delta, key=lambda x: abs(x[1] - 0.50))[0]
        else:
            atm_strike = paired_strikes[len(paired_strikes) // 2]

        call_info = strikes_data[atm_strike]["C"]
        put_info = strikes_data[atm_strike]["P"]
        call_mark = call_info["mark"]
        put_mark = put_info["mark"]
        straddle = call_mark + put_mark
        if straddle <= 0 or atm_strike <= 0:
            continue

        # Use the harvested spot price when available; otherwise approximate via
        # put-call parity (S ≈ K + C − P) which is accurate for near-ATM options.
        stock_price = spot_prices.get(sym)
        if stock_price is None or stock_price <= 0:
            stock_price = atm_strike + call_mark - put_mark
        if stock_price <= 0:
            continue

        result[sym] = straddle / stock_price

    return result


# ---------------------------------------------------------------------------
# Sidecar helpers
# ---------------------------------------------------------------------------

def write_moves(moves):
    tmp = EARNINGS_MOVES_FILE + ".tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(moves, f, indent=2)
        os.replace(tmp, EARNINGS_MOVES_FILE)
    except OSError as exc:
        print(
            f"tt-fetch-earnings-straddle: failed to write sidecar: {exc}",
            file=sys.stderr,
        )


# ---------------------------------------------------------------------------
# Standalone / prefetch mode: direct TastyTrade REST API calls
# ---------------------------------------------------------------------------

def _load_session():
    """
    Load session token from /tmp/tt_session_cache.json.
    Returns the token string, or None if absent / expired.
    """
    if not os.path.exists(SESSION_CACHE):
        return None
    try:
        cache = json.loads(Path(SESSION_CACHE).read_text())
        expires_at = cache.get("expires_at", 0)
        if time.time() < expires_at - 60:
            return cache.get("token")
    except (json.JSONDecodeError, OSError):
        pass
    return None


def _api_get(token, path):
    """GET request to the TastyTrade REST API. Returns parsed JSON dict or {}."""
    url = TT_BASE + path
    req = urllib.request.Request(
        url,
        headers={"Authorization": token, "Content-Type": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as exc:
        print(
            f"tt-fetch-earnings-straddle: API error {path}: {exc}",
            file=sys.stderr,
        )
        return {}


def fetch_straddle_from_api(underlying: str, front_expiry: date) -> float | None:
    """
    Fetch the ATM straddle implied move directly from the TastyTrade REST API.

    Steps:
      1. Load session token from /tmp/tt_session_cache.json.
      2. GET /market-data/quotes?symbols[]=UNDERLYING → current stock price.
      3. GET /option-chains/UNDERLYING/compact → chain with strikes & streamer symbols.
      4. Filter to the expiry closest to front_expiry (within 7 days).
      5. Find ATM strike (closest to stock price) that has both a call and a put.
      6. GET /market-data/quotes for those two streamer symbols → bid/ask.
      7. Compute implied_move = (call_mark + put_mark) / stock_price.

    Returns the implied_move fraction, or None on any failure.
    """
    token = _load_session()
    if not token:
        print(
            "tt-fetch-earnings-straddle: no valid session cache; "
            "cannot fetch straddle for {} via API.".format(underlying),
            file=sys.stderr,
        )
        return None

    # Step 1: Stock quote
    encoded = urllib.parse.quote(underlying, safe="")
    raw = _api_get(token, f"/market-data/quotes?symbols[]={encoded}")
    items = raw.get("data", {}).get("items", [])
    stock_price = None
    for item in items:
        for field in ("mark", "last", "lastPrice", "bid", "ask"):
            try:
                stock_price = float(item.get(field))
                if stock_price and stock_price > 0:
                    break
            except (TypeError, ValueError):
                pass
        if stock_price:
            break
    if not stock_price:
        print(
            f"tt-fetch-earnings-straddle: could not get stock price for {underlying}",
            file=sys.stderr,
        )
        return None

    # Step 2: Option chain (compact)
    raw = _api_get(token, f"/option-chains/{encoded}/compact")
    expirations = (
        raw.get("data", {}).get("expirations")
        or raw.get("data", {}).get("items", [{}])[0].get("expirations", [])
        if raw else []
    )

    # Find the expiry entry closest to front_expiry
    best_exp = None
    best_diff = None
    for exp_entry in (expirations or []):
        exp_date_str = exp_entry.get("expiration-date") or exp_entry.get("expiry-date")
        if not exp_date_str:
            continue
        try:
            exp_date = date.fromisoformat(str(exp_date_str))
        except (ValueError, TypeError):
            continue
        diff = abs((exp_date - front_expiry).days)
        if diff <= 7 and (best_diff is None or diff < best_diff):
            best_exp = exp_entry
            best_diff = diff

    if best_exp is None:
        print(
            "tt-fetch-earnings-straddle: no chain expiry within 7 days of {} for {}".format(
                front_expiry, underlying
            ),
            file=sys.stderr,
        )
        return None

    # Step 3: Find ATM strike
    strikes = best_exp.get("strikes", [])
    paired = [
        s for s in strikes
        if s.get("call-streamer-symbol") and s.get("put-streamer-symbol")
        and s.get("strike-price")
    ]
    if not paired:
        print(
            f"tt-fetch-earnings-straddle: no paired strikes for {underlying} at {front_expiry}",
            file=sys.stderr,
        )
        return None

    def _sp(s):
        try:
            return float(s.get("strike-price"))
        except (TypeError, ValueError):
            return None

    atm_entry = min(
        (s for s in paired if _sp(s) is not None),
        key=lambda s: abs(_sp(s) - stock_price),
        default=None,
    )
    if atm_entry is None:
        return None

    call_sym = urllib.parse.quote(atm_entry["call-streamer-symbol"], safe="")
    put_sym = urllib.parse.quote(atm_entry["put-streamer-symbol"], safe="")
    atm_strike = _sp(atm_entry)

    # Step 4: Fetch option quotes
    raw = _api_get(token, f"/market-data/quotes?symbols[]={call_sym}&symbols[]={put_sym}")
    opt_items = raw.get("data", {}).get("items", [])

    def _get_mark(sym_label, items_list):
        for it in items_list:
            if str(it.get("symbol", "")).upper() == sym_label.upper():
                m = it.get("mark")
                if m is not None:
                    try:
                        return float(m)
                    except (TypeError, ValueError):
                        pass
                try:
                    return (float(it.get("bid", 0)) + float(it.get("ask", 0))) / 2.0
                except (TypeError, ValueError):
                    pass
        return None

    call_mark = _get_mark(atm_entry["call-streamer-symbol"], opt_items)
    put_mark = _get_mark(atm_entry["put-streamer-symbol"], opt_items)

    if call_mark is None or put_mark is None or call_mark < 0 or put_mark < 0:
        print(
            f"tt-fetch-earnings-straddle: could not get option prices for {underlying}",
            file=sys.stderr,
        )
        return None

    straddle = call_mark + put_mark
    if straddle <= 0 or stock_price <= 0:
        return None

    return straddle / stock_price


def run_prefetch_mode(underlying: str, front_expiry_str: str) -> bool:
    """
    Standalone prefetch mode: fetch ATM straddle for one underlying and write
    to the sidecar.  Returns True on success.
    """
    try:
        front_expiry = date.fromisoformat(front_expiry_str)
    except (ValueError, TypeError) as exc:
        print(f"tt-fetch-earnings-straddle: invalid expiry '{front_expiry_str}': {exc}", file=sys.stderr)
        return False

    existing = load_earnings_moves()
    move = fetch_straddle_from_api(underlying, front_expiry)
    if move is None:
        return False

    merged = {**existing, underlying.upper(): move}
    write_moves(merged)
    print(
        "tt-fetch-earnings-straddle: wrote implied_move={:.4f} ({:.2f}%) for {} "
        "[prefetch mode, expiry {}]".format(move, move * 100, underlying, front_expiry_str)
    )
    return True


# ---------------------------------------------------------------------------
# PostToolUse mode
# ---------------------------------------------------------------------------

def run_hook_mode():
    raw_input = sys.stdin.read()
    try:
        hook_input = json.loads(raw_input)
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in WATCHED_TOOLS:
        sys.exit(0)

    tool_response = hook_input.get("tool_response", [])
    items = parse_greeks_items(tool_response)
    if not items:
        sys.exit(0)

    calendar_front_expiries = _load_calendar_front_expiries()
    new_moves = compute_implied_moves(items, calendar_front_expiries)
    if not new_moves:
        sys.exit(0)

    existing = load_earnings_moves()
    merged = {**existing, **new_moves}
    write_moves(merged)

    for sym, move in sorted(new_moves.items()):
        print(
            "tt-fetch-earnings-straddle: wrote implied_move={:.4f} ({:.2f}%) for {}".format(
                move, move * 100, sym
            )
        )

    sys.exit(0)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    args = sys.argv[1:]
    if args and args[0] == "--fetch":
        if len(args) < 3:
            print("Usage: tt-fetch-earnings-straddle.py --fetch UNDERLYING EXPIRY_ISO", file=sys.stderr)
            sys.exit(1)
        underlying = args[1].upper()
        expiry_str = args[2]
        ok = run_prefetch_mode(underlying, expiry_str)
        sys.exit(0 if ok else 1)
    else:
        run_hook_mode()


if __name__ == "__main__":
    main()
