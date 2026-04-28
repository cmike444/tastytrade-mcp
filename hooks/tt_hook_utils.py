"""
Shared utilities for TastyTrade PostToolUse hooks.

Extracted from tt-ff-exit-monitor.py and tt-ff-stage2-exearn.py to avoid
duplicating the same logic across multiple hook files.

Public API
----------
EARNINGS_MOVES_FILE : str
    Path to the sidecar JSON that maps SYMBOL → implied_move fraction.

_try_parse_json(value) -> dict | list | None
    Coerce a raw tool-response value to a Python object.

parse_greeks_items(tool_response) -> list[dict]
    Extract the flat list of per-symbol items from any get_market_metrics or
    get_options_greeks tool response (handles MCP content-block wrappers).

load_earnings_moves() -> dict[str, float]
    Load EARNINGS_MOVES_FILE and return {SYMBOL: implied_move}.

compute_exearn_iv(iv_raw, dte, implied_move) -> float | None
    Strip the earnings jump variance from iv_raw to obtain the ex-earnings IV.
"""

import json
import math
import os

EARNINGS_MOVES_FILE = "/tmp/tt_earnings_moves.json"


def _try_parse_json(value):
    """
    Coerce *value* to a Python dict/list.

    If *value* is already a dict or list it is returned as-is.  If it is a
    string, JSON parsing is attempted; on failure None is returned.
    """
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def parse_greeks_items(tool_response):
    """
    Extract the flat list of per-symbol item dicts from a tool response.

    Handles the two shapes seen in practice:
      • A list of MCP content blocks: [{"type": "text", "text": "{...json...}"}]
      • A raw JSON dict or list

    Returns a (possibly empty) list of dicts.
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


def load_earnings_moves():
    """
    Load EARNINGS_MOVES_FILE and return a dict mapping SYMBOL → implied_move.

    *implied_move* is the market-expected one-standard-deviation earnings move
    expressed as a fraction of the stock price (e.g. 0.05 = 5%).

    Returns an empty dict when the file is absent or malformed.
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


def compute_exearn_iv(iv_raw, dte, implied_move):
    """
    Strip the earnings jump variance from *iv_raw* to obtain the ex-earnings IV.

    Formula (from computations.md):
        IV_exearn² × T = IV_raw² × T − implied_move²
        => IV_exearn² = IV_raw² − implied_move² / T     (T = dte / 365)

    Args:
        iv_raw:       Raw IV in decimal (e.g. 0.30 = 30 %).
        dte:          Calendar days to expiry of the window containing earnings.
        implied_move: Earnings implied move fraction (straddle / stock price).

    Returns the ex-earn IV in decimal, or None when the result would be
    imaginary (i.e. the full variance is dominated by the earnings jump).
    """
    t = dte / 365.0
    if t <= 0 or implied_move <= 0 or iv_raw <= 0:
        return None
    var_exearn = iv_raw ** 2 - (implied_move ** 2) / t
    if var_exearn <= 0:
        return None
    return math.sqrt(var_exearn)
