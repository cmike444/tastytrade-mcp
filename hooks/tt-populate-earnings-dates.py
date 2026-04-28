#!/usr/bin/env python3
"""
PostToolUse hook: tt-populate-earnings-dates
Fires on: get_market_metrics (detail="full")

Extracts the 'earnings-next-date' field for each symbol returned by
get_market_metrics and writes (or merges) the results into
/tmp/tt_earnings_dates.json.

This auto-populates the sidecar file consumed by tt-ff-stage2-exearn.py
so that Stage 2 ex-earn IV stripping works without any manual setup.

File format:  {"SYMBOL": "YYYY-MM-DD", ...}

The hook merges into any existing file so that entries for symbols not
present in the current response are preserved.

The hook exits 0 in all cases (advisory only; does not block).
"""

import json
import os
import sys
from datetime import date

WATCHED_TOOLS = {"get_market_metrics"}
EARNINGS_DATES_FILE = "/tmp/tt_earnings_dates.json"


# ---------------------------------------------------------------------------
# JSON parsing helpers (same shape as tt-ff-exit-monitor._parse_items)
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
    Return the list of per-symbol metric items from a get_market_metrics
    tool response.  Handles both raw dict/list and MCP content-block formats.
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
    Parse a get_market_metrics tool response and return a mapping:
      { SYMBOL_UPPER: "YYYY-MM-DD" }

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
            # Validate the date string is a proper ISO date before storing it.
            date.fromisoformat(str(earn_str))
            result[symbol] = str(earn_str)
        except (ValueError, TypeError):
            continue
    return result


# ---------------------------------------------------------------------------
# Sidecar I/O
# ---------------------------------------------------------------------------

def load_existing_dates():
    """Load /tmp/tt_earnings_dates.json; return {} on missing or bad file."""
    if not os.path.exists(EARNINGS_DATES_FILE):
        return {}
    try:
        with open(EARNINGS_DATES_FILE) as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {str(k).upper(): str(v) for k, v in data.items()}
    except (json.JSONDecodeError, OSError):
        pass
    return {}


def write_dates(dates):
    """Atomically write the dates dict to /tmp/tt_earnings_dates.json."""
    tmp_path = EARNINGS_DATES_FILE + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(dates, f, indent=2)
    os.replace(tmp_path, EARNINGS_DATES_FILE)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        sys.exit(0)

    tool_name = payload.get("tool_name", "")
    if tool_name not in WATCHED_TOOLS:
        sys.exit(0)

    tool_input = payload.get("tool_input", {})
    if not isinstance(tool_input, dict):
        tool_input = {}
    if tool_input.get("detail") != "full":
        sys.exit(0)

    tool_response = payload.get("tool_response", [])
    new_dates = extract_earnings_dates(tool_response)

    if not new_dates:
        sys.exit(0)

    existing = load_existing_dates()
    merged = {**existing, **new_dates}
    try:
        write_dates(merged)
    except OSError as exc:
        print(f"[tt-populate-earnings-dates] WARNING: could not write {EARNINGS_DATES_FILE}: {exc}",
              file=sys.stderr)
        sys.exit(0)

    for sym, dt in sorted(new_dates.items()):
        print(f"[tt-populate-earnings-dates] {sym}: earnings-next-date={dt}")

    sys.exit(0)


if __name__ == "__main__":
    main()
