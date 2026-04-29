#!/usr/bin/env python3
"""
PostToolUse hook: tt-loss-monitor
Fires on: get_positions

Groups position legs by underlying root (e.g. both legs of a strangle, all
four legs of an iron condor) and checks the combined unrealized P&L as a
percentage of account net liq.

Warning levels:
  ⛔ BREACH  — position-level loss > 5% of net liq
  ⚠  WARNING — position-level loss 2–5% of net liq

When /tmp/tt_txns_90d.json is present, net credit collected per underlying
(over the last 90 days, including rolls) is reported alongside each entry so
the agent can compute the exact 2× stop trigger dollar amount.

Net liq is read from /tmp/tt_netliq.json (written by the growth-phase hook
after get_account_balances — call get_account_balances before get_positions).

The hook exits 0 in all cases (warning only; does not block).
"""

import json
import os
import re
import sys
from datetime import date, datetime, timedelta

WATCHED_TOOLS = {"get_positions"}
NET_LIQ_FILE = "/tmp/tt_netliq.json"
TXNS_FILE = "/tmp/tt_txns_90d.json"


# ---------------------------------------------------------------------------
# Parse positions from the tool response
# ---------------------------------------------------------------------------

def _try_parse_json(value):
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def extract_positions(tool_response):
    """
    Extract a flat list of position dicts from a get_positions tool response.

    Handles MCP content-block wrappers:
      [{"type": "text", "text": "{...json...}"}]
    as well as raw JSON dict or list values.

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
        parsed = _try_parse_json(combined)
        if parsed is not None:
            raw = parsed

    if isinstance(raw, str):
        raw = _try_parse_json(raw) or {}

    items = []
    if isinstance(raw, dict):
        data = raw.get("data", raw)
        if isinstance(data, dict):
            items = data.get("items", data.get("positions", []))
        elif isinstance(data, list):
            items = data
    elif isinstance(raw, list):
        items = raw

    return items if isinstance(items, list) else []


# ---------------------------------------------------------------------------
# Net liq
# ---------------------------------------------------------------------------

def load_netliq():
    """
    Read /tmp/tt_netliq.json and return (net_liq_float, error_str_or_None).
    """
    if not os.path.exists(NET_LIQ_FILE):
        return None, "{} is missing".format(NET_LIQ_FILE)
    try:
        with open(NET_LIQ_FILE) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        return None, "failed to read {}: {}".format(NET_LIQ_FILE, exc)
    for key in ("net-liquidating-value", "net_liq", "netliq"):
        if key in data and data[key] is not None:
            try:
                v = float(data[key])
                if v > 0:
                    return v, None
            except (ValueError, TypeError):
                continue
    return None, "no usable net liq value found in {}".format(NET_LIQ_FILE)


# ---------------------------------------------------------------------------
# Transactions → net credit per underlying root
# ---------------------------------------------------------------------------

def load_transactions():
    """Return list of transaction dicts from /tmp/tt_txns_90d.json, or []."""
    if not os.path.exists(TXNS_FILE):
        return []
    try:
        with open(TXNS_FILE) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("items", "transactions", "data"):
            v = data.get(key)
            if isinstance(v, list):
                return v
    return []


def _txn_underlying_root(tx):
    """
    Derive the normalized underlying root from a transaction dict using the
    shared _normalize_futures_root helper so that futures roots (e.g. /ESM6)
    produce the same key (ES) as position groups.
    """
    sym = tx.get("underlying-symbol") or tx.get("symbol") or ""
    if not sym:
        return ""
    first_token = sym.split()[0]
    return _normalize_futures_root(first_token)


def compute_net_credit_by_root(transactions, lookback_days=90):
    """
    Compute cumulative net credit received per underlying root over the last
    `lookback_days` calendar days.  Covers initial entries and rolls.
    Returns dict mapping root -> net_credit (positive = net credit received).

    Roots are normalized via _txn_underlying_root so futures positions
    (e.g. /ESM6) share the same root key (ES) as position groups.
    """
    since = date.today() - timedelta(days=lookback_days)
    credits = {}
    for tx in transactions:
        tx_type = tx.get("transaction-type", "")
        if tx_type not in ("Trade", "Receive Deliver"):
            continue
        value = tx.get("net-value") or tx.get("value") or 0
        try:
            pnl = float(value)
        except (ValueError, TypeError):
            continue
        dt_str = tx.get("executed-at") or tx.get("transaction-date", "")
        try:
            dt = datetime.fromisoformat(str(dt_str).replace("Z", "+00:00")).date()
        except Exception:
            continue
        if dt < since:
            continue
        root = _txn_underlying_root(tx)
        if root:
            credits[root] = credits.get(root, 0.0) + pnl
    return credits


# ---------------------------------------------------------------------------
# Underlying root extraction (mirrors prefetch._position_underlying_root)
# ---------------------------------------------------------------------------

def _normalize_futures_root(raw):
    """
    Strip the leading ./ or / prefix and the trailing CME contract-month
    suffix from a futures symbol token (e.g. './ESM6' → 'ES', '/GCZ5' → 'GC').
    Returns the raw token unchanged if it does not look like a futures root.
    """
    s = raw.strip()
    if s.startswith("./") or s.startswith("/"):
        bare = s.lstrip("./").upper()
        bare = re.sub(r"[FGHJKMNQUVXZ]\d{1,2}$", "", bare)
        return bare
    return s


def _position_underlying_root(pos):
    """
    Return the normalized underlying root for a position dict.

    Checks both compact-bundle field name ('underlying') and raw API field
    name ('underlying-symbol') so this works regardless of which format is
    passed.  Falls back to splitting the OCC symbol on whitespace to strip
    the option suffix.

    For futures positions, the contract-month suffix is stripped so legs on
    different contract months (e.g. /ESM6 and /ESU6) share the same root (ES)
    and are correctly grouped as a multi-leg position.
    """
    raw = pos.get("underlying") or pos.get("underlying-symbol") or ""
    if raw:
        return _normalize_futures_root(raw)
    symbol = pos.get("symbol") or ""
    if not symbol:
        return ""
    first_token = symbol.split()[0]
    return _normalize_futures_root(first_token)


# ---------------------------------------------------------------------------
# Strategy detection heuristic
# ---------------------------------------------------------------------------

def _detect_strategy(legs):
    """
    Return a short strategy label based on the leg symbols in the group.

    Heuristic based on leg count and option type:
      1 leg (option)  → 'single'
      2 legs, C + P   → 'strangle'
      2 legs, CC / PP → 'spread'
      4 legs          → 'iron condor'
      other           → 'position'

    Returns (label, stop_multiplier) where stop_multiplier is 2.0 or 1.5.
    """
    occ_pattern = re.compile(r"\d{6}([CP])\d+$")
    opt_types = []
    for sym in legs:
        m = occ_pattern.search(sym)
        if m:
            opt_types.append(m.group(1))

    n = len(legs)
    n_opt = len(opt_types)

    if n == 1:
        return ("single", 2.0)

    if n_opt == 0:
        return ("position", 2.0)

    unique_types = set(opt_types)
    if n == 2:
        if unique_types == {"C", "P"}:
            return ("strangle", 2.0)
        else:
            return ("spread", 2.0)
    if n == 4:
        if unique_types == {"C", "P"}:
            return ("iron condor", 2.0)
        if unique_types == {"C"}:
            return ("call spread", 2.0)
        if unique_types == {"P"}:
            return ("put spread", 2.0)

    return ("position", 2.0)


# ---------------------------------------------------------------------------
# Core monitor: group positions by underlying root and check thresholds
# ---------------------------------------------------------------------------

def compute_loss_monitor(positions, net_liq, net_credits):
    """
    Group position legs by underlying root, sum unrealized P&L, and flag
    entries that breach 5% of net liq (BREACH) or 2–5% (WARNING).

    Returns (breaches, warnings) where each item is a dict with keys:
      symbol, legs, unrealized_pnl, pct_netliq, net_credit, level, strategy
    """
    groups = {}
    for pos in positions:
        root = _position_underlying_root(pos)
        if not root:
            continue
        symbol = pos.get("symbol") or root
        upnl_raw = (
            pos.get("unrealized-day-gain")
            or pos.get("unrealized_pnl")
            or pos.get("unrealized-gain")
            or 0
        )
        try:
            upnl = float(upnl_raw)
        except (ValueError, TypeError):
            upnl = 0.0
        if root not in groups:
            groups[root] = {"legs": [], "total_upnl": 0.0}
        if symbol not in groups[root]["legs"]:
            groups[root]["legs"].append(symbol)
        groups[root]["total_upnl"] += upnl

    breaches = []
    warnings = []

    for root, grp in groups.items():
        total_upnl = grp["total_upnl"]
        net_credit = net_credits.get(root)
        strategy, stop_mult = _detect_strategy(grp["legs"])

        entry = {
            "symbol": root,
            "legs": grp["legs"],
            "unrealized_pnl": round(total_upnl, 2),
            "net_credit": round(net_credit, 2) if net_credit is not None else None,
            "strategy": strategy,
            "stop_mult": stop_mult,
        }

        if net_liq > 0:
            pct = (total_upnl / net_liq) * 100
            entry["pct_netliq"] = round(pct, 2)

            if pct < -5:
                entry["level"] = "BREACH"
                breaches.append(entry)
            elif pct < -2:
                entry["level"] = "WARNING"
                warnings.append(entry)

    return breaches, warnings


# ---------------------------------------------------------------------------
# Format output lines
# ---------------------------------------------------------------------------

def _format_entry(entry):
    """
    Format a single breach/warning entry for agent output.

    Primary format (with net credit):
      [UNDERLYING] [strategy] at [X]% of 2× stop ($[loss] loss vs $[trigger] trigger)

    Fallback (no net credit):
      [UNDERLYING] [strategy]: [X]% of net liq unrealized loss ($[loss])
    """
    root = entry["symbol"]
    strategy = entry["strategy"]
    upnl = entry["unrealized_pnl"]
    pct = entry.get("pct_netliq", 0)
    net_credit = entry.get("net_credit")
    stop_mult = entry.get("stop_mult", 2.0)
    mult_label = "{}×".format(int(stop_mult) if stop_mult == int(stop_mult) else stop_mult)

    loss_str = "${:.0f}".format(abs(upnl))

    if net_credit and net_credit > 0:
        trigger = net_credit * stop_mult
        pct_of_stop = (abs(upnl) / trigger) * 100
        trigger_str = "${:.0f}".format(trigger)
        return (
            "{} {} at {:.0f}% of {} stop ({} loss vs {} trigger)".format(
                root, strategy, pct_of_stop, mult_label, loss_str, trigger_str
            )
        )
    else:
        return (
            "{} {}: {:.1f}% of net liq unrealized loss ({})".format(
                root, strategy, abs(pct), loss_str
            )
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(
            "tt-loss-monitor: failed to parse hook input: {}".format(exc),
            file=sys.stderr,
        )
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in WATCHED_TOOLS:
        sys.exit(0)

    tool_response = hook_input.get("tool_response", [])
    positions = extract_positions(tool_response)

    if not positions:
        sys.exit(0)

    net_liq, err = load_netliq()
    if net_liq is None:
        print(
            "tt-loss-monitor: skipping — {}".format(err),
            file=sys.stderr,
        )
        sys.exit(0)

    transactions = load_transactions()
    net_credits = compute_net_credit_by_root(transactions) if transactions else {}

    breaches, warnings = compute_loss_monitor(positions, net_liq, net_credits)

    if not breaches and not warnings:
        sys.exit(0)

    print("=== LOSS MONITOR ===")

    if breaches:
        print("⛔ BREACH — position-level loss exceeds 5% of net liq:")
        for entry in breaches:
            print("  •", _format_entry(entry))
            if len(entry["legs"]) > 1:
                print("    Legs:", ", ".join(entry["legs"]))

    if warnings:
        print("⚠  WARNING — position-level loss 2–5% of net liq:")
        for entry in warnings:
            print("  •", _format_entry(entry))
            if len(entry["legs"]) > 1:
                print("    Legs:", ", ".join(entry["legs"]))

    if breaches:
        print(
            "\nStop rule: evaluate at the position level across all legs of the "
            "same underlying. Never close individual legs in isolation."
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
