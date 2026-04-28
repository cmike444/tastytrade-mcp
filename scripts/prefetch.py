#!/usr/bin/env python3
"""
prefetch.py — Pre-fetch and pre-digest daily trading report bundles.

Authenticates directly to the TastyTrade REST API, computes all hook signals
inline, and writes a compact JSON bundle to disk. Claude reads the bundle
instead of making MCP tool calls, saving 60-80% of token budget.

Usage:
  python3 scripts/prefetch.py --report morning
  python3 scripts/prefetch.py --report eod --output-dir /tmp
  python3 scripts/prefetch.py --report noon --dry-run

Report types: morning, open, noon, preclose, eod, weekend
"""

import argparse
import json
import math
import os
import sys
import tempfile
import time
from datetime import datetime, date, timedelta, timezone
from pathlib import Path
from typing import Optional
import urllib.error
import urllib.parse
import urllib.request

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TT_BASE = "https://api.tastytrade.com"
SESSION_CACHE = "/tmp/tt_session_cache.json"
FUTURES_WATCHLIST = ["/ES", "/NQ", "/CL", "/GC", "/SI", "/ZN", "/6E"]


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

class TastyTradeSession:
    """Login, cache session token, and expose get/post wrappers."""

    def __init__(self):
        self.token: Optional[str] = None
        self.account_number: Optional[str] = None
        self._load_or_login()

    def _load_or_login(self):
        try:
            cache = json.loads(Path(SESSION_CACHE).read_text())
            expires_at = cache.get("expires_at", 0)
            if time.time() < expires_at - 300:
                self.token = cache["token"]
                self.account_number = cache.get("account_number")
                return
        except Exception:
            pass

        username = os.environ.get("TT_USERNAME")
        password = os.environ.get("TT_PASSWORD")
        if not username or not password:
            sys.exit("ERROR: TT_USERNAME and TT_PASSWORD environment variables must be set.")

        body = json.dumps({"login": username, "password": password}).encode()
        req = urllib.request.Request(
            f"{TT_BASE}/sessions",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            sys.exit(f"ERROR: Login failed ({e.code}): {e.read().decode()}")

        session_data = data.get("data", {})
        self.token = session_data.get("session-token")
        if not self.token:
            sys.exit("ERROR: No session token in login response.")

        self.account_number = self._fetch_account_number()

        cache_data = {
            "token": self.token,
            "account_number": self.account_number,
            "expires_at": time.time() + 86400,
        }
        Path(SESSION_CACHE).write_text(json.dumps(cache_data))

    def _fetch_account_number(self) -> Optional[str]:
        try:
            data = self.get("/customers/me/accounts")
            items = data.get("data", {}).get("items", [])
            if items:
                return items[0].get("account", {}).get("account-number")
        except Exception:
            pass
        return None

    def _request(self, method: str, path: str, body=None) -> dict:
        url = TT_BASE + path
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Authorization": self.token,
                "Content-Type": "application/json",
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            err_body = e.read().decode()
            print(f"  WARN: {method} {path} -> {e.code}: {err_body[:200]}", file=sys.stderr)
            return {}

    def get(self, path: str) -> dict:
        return self._request("GET", path)

    def post(self, path: str, body: dict) -> dict:
        return self._request("POST", path, body)


# ---------------------------------------------------------------------------
# Signal computation library
# ---------------------------------------------------------------------------

def compute_hv(candles: list, window: int = 21) -> Optional[float]:
    """
    Compute annualised historical volatility from daily OHLCV candle dicts.
    Each candle must have a 'close' key. Returns HV as a percentage or None.
    """
    closes = []
    for c in candles:
        val = c.get("close") or c.get("closePrice")
        if val is not None:
            try:
                closes.append(float(val))
            except (ValueError, TypeError):
                pass

    if len(closes) < window + 1:
        return None

    log_returns = [
        math.log(closes[i] / closes[i - 1])
        for i in range(1, len(closes))
        if closes[i - 1] > 0 and closes[i] > 0
    ]
    if len(log_returns) < window:
        return None
    recent = log_returns[-window:]
    mean = sum(recent) / len(recent)
    variance = sum((r - mean) ** 2 for r in recent) / (len(recent) - 1)
    hv_annual = math.sqrt(variance * 252) * 100
    return round(hv_annual, 2)


def compute_ff_score(term_structure: list) -> dict:
    """
    Compute Forward Factor scores from a term structure list.
    Each element: {"expiry": "YYYY-MM-DD", "dte": int, "atm_iv": float (%)}.
    Returns {"max_ff": float, "signal": str, "pairs": [...]}.
    """
    if len(term_structure) < 2:
        return {"max_ff": None, "signal": "INSUFFICIENT_DATA", "pairs": []}

    ts = sorted(term_structure, key=lambda x: x.get("dte", 0))
    pairs = []
    for i in range(1, len(ts)):
        t1 = ts[i - 1]["dte"] / 365.0
        t2 = ts[i]["dte"] / 365.0
        iv1 = ts[i - 1]["atm_iv"] / 100.0
        iv2 = ts[i]["atm_iv"] / 100.0

        if t2 <= t1 or t1 <= 0 or iv1 <= 0 or iv2 <= 0:
            continue

        var_forward = (iv2 ** 2) * t2 - (iv1 ** 2) * t1
        if var_forward <= 0:
            continue

        fwd_vol = math.sqrt(var_forward / (t2 - t1))
        ff = fwd_vol / iv2 if iv2 > 0 else None

        pairs.append({
            "near_expiry": ts[i - 1]["expiry"],
            "far_expiry": ts[i]["expiry"],
            "near_dte": ts[i - 1]["dte"],
            "far_dte": ts[i]["dte"],
            "fwd_iv_pct": round(fwd_vol * 100, 2),
            "ff": round(ff, 3) if ff else None,
            "calendar_signal": ff is not None and ff >= 1.2,
        })

    if not pairs:
        return {"max_ff": None, "signal": "NO_DATA", "pairs": []}

    max_ff = max((p["ff"] for p in pairs if p["ff"] is not None), default=None)
    if max_ff is None:
        signal = "NO_DATA"
    elif max_ff >= 1.2:
        signal = "CALENDAR_OPPORTUNITY"
    elif max_ff >= 1.0:
        signal = "NEUTRAL"
    else:
        signal = "BACK_MONTH_CHEAP"

    return {"max_ff": round(max_ff, 3) if max_ff else None, "signal": signal, "pairs": pairs}


def annotate_ff_earnings(ff_score: dict, earnings_date_str: Optional[str]) -> dict:
    """
    Annotate each FF pair with earnings-awareness per forward-factor.md Case A/B/C rules.

    Case A: front expiry < earnings ≤ back expiry
        → "earnings in back window (Case A) — confirm ex-earn FF; close before earnings"
    Case B: earnings ≤ front expiry (both expiries after earnings)
        → "earnings before front expiry (Case B) — both legs after earnings; confirm
           ex-earn FF ≥ 0.30 AND willingness to be short earnings vol"
    Potential Case B: Case A but earnings within ≤5 DTE of back expiry
        → additionally flagged "[earnings within 5 DTE of back expiry — Case B proximity]"
    Clean: earnings after back expiry (or no earnings data) — no annotation added.

    Returns a copy of ff_score with 'earnings_case' and 'earnings_note' fields added to
    each relevant pair, plus a top-level 'has_earnings_flag' bool when any pair is flagged.
    """
    if not earnings_date_str:
        return ff_score

    today = date.today()
    try:
        earn_date = date.fromisoformat(str(earnings_date_str))
    except (ValueError, TypeError):
        return ff_score

    if earn_date < today:
        return ff_score

    annotated_pairs = []
    has_earnings_flag = False

    for pair in ff_score.get("pairs", []):
        pair = dict(pair)
        try:
            front_date = date.fromisoformat(pair["near_expiry"])
            back_date = date.fromisoformat(pair["far_expiry"])
        except (ValueError, KeyError, TypeError):
            annotated_pairs.append(pair)
            continue

        if earn_date <= front_date:
            pair["earnings_case"] = "B"
            pair["earnings_note"] = (
                "earnings on {} before front expiry (Case B: both legs expire after earnings) — "
                "only proceed if ex-earn FF ≥ 0.30 AND willing to be short earnings vol "
                "(forward-factor.md §Earnings Case Handling)"
            ).format(earn_date.isoformat())
            has_earnings_flag = True
        elif earn_date <= back_date:
            near_back = (back_date - earn_date).days <= 5
            pair["earnings_case"] = "A"
            note = (
                "earnings on {} in back window (Case A: front expires before earnings) — "
                "confirm ex-earn FF ≥ 0.30; close on front expiry day before earnings"
            ).format(earn_date.isoformat())
            if near_back:
                note += (
                    " [earnings within 5 DTE of back expiry — potential Case B overlap; "
                    "treat as Case B and confirm willingness to be short earnings vol]"
                )
            pair["earnings_note"] = note
            has_earnings_flag = True
        else:
            pair["earnings_case"] = "clean"

        pair["earnings_date"] = earn_date.isoformat()
        annotated_pairs.append(pair)

    result = dict(ff_score)
    result["pairs"] = annotated_pairs
    if has_earnings_flag:
        result["has_earnings_flag"] = True
        cases = [p.get("earnings_case") for p in annotated_pairs if p.get("earnings_case") not in (None, "clean")]
        worst = "B" if "B" in cases else "A"
        max_ff_val = result.get("max_ff")
        ff_pct = "FF = {:.0f}%".format((max_ff_val - 1) * 100) if max_ff_val is not None else "FF data"
        if worst == "B":
            result["earnings_ff_note"] = (
                "{} [earnings in front window (Case B) — both expiries after earnings; "
                "confirm ex-earn FF ≥ 0.30 and willingness to be short earnings vol]"
            ).format(ff_pct)
        else:
            result["earnings_ff_note"] = (
                "{} [earnings in back window (Case A) — confirm ex-earn FF ≥ 0.30; "
                "close on front expiry day before earnings]"
            ).format(ff_pct)
    return result


def compute_regime(iv30: Optional[float], ivr: Optional[float]) -> str:
    """
    Classify volatility regime from IV30 (%) and IVR (0-100).
    Returns: "CALM" | "ELEVATED" | "STRESS" | "UNKNOWN"
    """
    if iv30 is None or ivr is None:
        return "UNKNOWN"
    try:
        iv30 = float(iv30)
        ivr = float(ivr)
    except (ValueError, TypeError):
        return "UNKNOWN"

    if iv30 <= 20 and ivr <= 40:
        return "CALM"
    elif iv30 <= 30 and ivr <= 70:
        return "ELEVATED"
    else:
        return "STRESS"


def _position_underlying_root(pos: dict) -> str:
    """
    Return the underlying root for a position dict.
    Checks both compact-bundle field name ('underlying') and raw API field name
    ('underlying-symbol') so this works regardless of which format is passed.
    Falls back to splitting the OCC symbol on whitespace to strip the option suffix.
    """
    root = pos.get("underlying") or pos.get("underlying-symbol") or ""
    if root:
        return root.strip()
    symbol = pos.get("symbol") or ""
    return symbol.split()[0] if symbol else ""


def compute_net_credit_by_root(transactions: list, lookback_days: int = 90) -> dict:
    """
    Compute cumulative net credit received per underlying root over the last
    `lookback_days` calendar days.  Covers initial entries and rolls.
    Returns dict mapping root -> net_credit (positive = net credit received).
    """
    since = date.today() - timedelta(days=lookback_days)
    credits: dict = {}
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
        sym = tx.get("underlying-symbol") or tx.get("symbol") or ""
        root = sym.split()[0] if sym else ""
        if root:
            credits[root] = credits.get(root, 0.0) + pnl
    return credits


def compute_loss_monitor(positions: list, net_liq: float, transactions: list = None) -> dict:
    """
    Check position-level unrealized P&L drawdown flags.

    Legs are grouped by underlying root (e.g. both legs of a put spread, all
    four legs of an iron condor) so that stop thresholds are evaluated against
    the *combined* position P&L rather than individual legs.

    When `transactions` are supplied, the cumulative net credit collected for
    each underlying (including any rolls within the last 90 days) is surfaced
    as `net_credit` on each entry so the agent can compute the exact 2x stop
    trigger dollar amount.

    Returns dict with breach/warning lists and circuit_breaker flag.
    """
    if transactions is None:
        transactions = []

    net_credits = compute_net_credit_by_root(transactions) if transactions else {}

    groups: dict = {}
    for pos in positions:
        root = _position_underlying_root(pos)
        if not root:
            continue
        symbol = pos.get("symbol") or root
        upnl_raw = pos.get("unrealized-day-gain") or pos.get("unrealized_pnl") or 0
        try:
            upnl = float(upnl_raw)
        except (ValueError, TypeError):
            upnl = 0.0
        if root not in groups:
            groups[root] = {"legs": [], "total_upnl": 0.0}
        if symbol not in groups[root]["legs"]:
            groups[root]["legs"].append(symbol)
        groups[root]["total_upnl"] += upnl

    flags = []
    warnings = []

    for root, grp in groups.items():
        total_upnl = grp["total_upnl"]
        net_credit = net_credits.get(root)

        entry = {
            "symbol": root,
            "legs": grp["legs"],
            "unrealized_pnl": round(total_upnl, 2),
            "net_credit": round(net_credit, 2) if net_credit is not None else None,
        }

        if net_liq > 0:
            pct = (total_upnl / net_liq) * 100
            entry["pct_netliq"] = round(pct, 2)

            if pct < -5:
                entry["level"] = "BREACH"
                flags.append(entry)
            elif pct < -2:
                entry["level"] = "WARNING"
                warnings.append(entry)

    return {
        "breach_count": len(flags),
        "warning_count": len(warnings),
        "breaches": flags,
        "warnings": warnings,
        "circuit_breaker": len(flags) > 0,
    }


def compute_daily_pnl_from_transactions(transactions: list) -> dict:
    """
    Summarize realized P&L for today and this week from transaction list.
    Returns daily, weekly, and monthly totals with circuit breaker flags.
    """
    today = date.today()
    week_start = today.toordinal() - today.weekday()

    daily_pnl = 0.0
    weekly_pnl = 0.0
    monthly_pnl = 0.0

    items = transactions
    if isinstance(transactions, dict):
        items = transactions.get("data", {}).get("items", []) or []

    for tx in items:
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

        if dt == today:
            daily_pnl += pnl
        if dt.toordinal() >= week_start:
            weekly_pnl += pnl
        if dt.year == today.year and dt.month == today.month:
            monthly_pnl += pnl

    return {
        "daily_realized_pnl": round(daily_pnl, 2),
        "weekly_realized_pnl": round(weekly_pnl, 2),
        "monthly_realized_pnl": round(monthly_pnl, 2),
        "daily_0dte_circuit_breaker": daily_pnl < -250,
        "weekly_circuit_breaker": weekly_pnl < -1500,
    }


def detect_calendar_expiry_alerts(raw_positions: list) -> list:
    """
    Inspect raw TastyTrade positions for calendar spreads whose front (short)
    leg expires today or tomorrow (≤ 1 DTE).

    A calendar pair: same underlying root, option type (C/P), and strike;
    one Short leg and one Long leg where the back expiry > front expiry.

    Returns a list of human-readable warning strings (empty if none).
    """
    import re as _re

    def _parse(symbol):
        s = (symbol or "").strip()
        m = _re.search(r"(\d{6})([CP])(\d+)$", s)
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

    groups: dict = {}
    for pos in raw_positions:
        instrument_type = pos.get("instrument-type", "").lower()
        if "option" not in instrument_type:
            continue
        qty_dir = (pos.get("quantity-direction") or "").strip()
        if qty_dir not in ("Long", "Short"):
            continue
        parsed = _parse(pos.get("symbol", ""))
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

    today = date.today()
    warnings = []
    for (underlying, opt_type, strike_raw), legs in groups.items():
        front_expiry = legs.get("Short")
        back_expiry = legs.get("Long")
        if front_expiry is None or back_expiry is None:
            continue
        if back_expiry <= front_expiry:
            continue
        dte = (front_expiry - today).days
        if dte < 0 or dte > 1:
            continue
        label = "{}  {}{}  {}/{}".format(
            underlying,
            opt_type,
            strike_raw,
            front_expiry.strftime("%b%d"),
            back_expiry.strftime("%b%d"),
        )
        warnings.append(
            "Calendar {} front leg expires {} — close the spread before market"
            " close to avoid pin risk."
            " Exit rule (forward-factor.md §a): close on front expiry day as a"
            " spread before the close — avoids pin risk and assignment.".format(
                label, front_expiry.isoformat()
            )
        )
    return warnings


def _parse_option_expiry(symbol: str) -> Optional[str]:
    """
    Extract expiration date (YYYY-MM-DD) from an OCC option symbol.
    OCC format: "SPY   241115C00600000" or compact "SPY 241115C00600000".
    Returns None for non-option symbols.
    """
    stripped = symbol.strip()
    parts = stripped.split()
    date_part = None
    for part in parts:
        if len(part) >= 15 and (part[-9] in ("C", "P")):
            date_part = part[:6]
            break
        elif len(part) >= 6 and part[:6].isdigit():
            date_part = part[:6]
            break
    if date_part and len(date_part) == 6:
        try:
            return datetime.strptime(date_part, "%y%m%d").strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


# ---------------------------------------------------------------------------
# Shared fetch helpers
# ---------------------------------------------------------------------------

def fetch_account_context(session: TastyTradeSession) -> dict:
    """Fetch balances, positions, live orders."""
    acct = session.account_number
    if not acct:
        return {}

    balances_raw = session.get(f"/accounts/{acct}/balances")
    balances = balances_raw.get("data", {})
    net_liq = float(balances.get("net-liquidating-value", 0) or 0)
    buying_power = float(
        balances.get("derivative-buying-power", 0) or
        balances.get("buying-power", 0) or 0
    )

    positions_raw = session.get(f"/accounts/{acct}/positions")
    positions = positions_raw.get("data", {}).get("items", [])

    try:
        with open("/tmp/tt_positions.json", "w") as _pf:
            json.dump(positions, _pf)
    except OSError:
        pass

    orders_raw = session.get(f"/accounts/{acct}/orders/live")
    live_orders = orders_raw.get("data", {}).get("items", [])

    loss_mon = compute_loss_monitor(positions, net_liq)
    calendar_alerts = detect_calendar_expiry_alerts(positions)

    compact_positions = []
    for p in positions:
        qty = p.get("quantity", 0)
        try:
            qty = float(qty)
        except (ValueError, TypeError):
            qty = 0
        if qty == 0:
            continue
        compact_positions.append({
            "symbol": p.get("symbol"),
            "underlying": p.get("underlying-symbol"),
            "instrument_type": p.get("instrument-type"),
            "quantity": qty,
            "cost_effect": p.get("cost-effect"),
            "average_open_price": p.get("average-open-price"),
            "close_price": p.get("close-price"),
            "unrealized_pnl": p.get("unrealized-day-gain"),
            "delta": p.get("delta"),
            "expiration_date": p.get("expires-at") or _parse_option_expiry(p.get("symbol", "")),
            "quantity_direction": p.get("quantity-direction"),
        })

    compact_orders = []
    for o in live_orders:
        compact_orders.append({
            "id": o.get("id"),
            "underlying": o.get("underlying-symbol"),
            "status": o.get("status"),
            "order_type": o.get("order-type"),
            "price": o.get("price"),
            "legs": len(o.get("legs", [])),
        })

    return {
        "account_number": acct,
        "net_liq": net_liq,
        "buying_power": buying_power,
        "cash_balance": float(balances.get("cash-balance", 0) or 0),
        "position_count": len(compact_positions),
        "positions": compact_positions,
        "live_order_count": len(compact_orders),
        "live_orders": compact_orders,
        "loss_monitor": loss_mon,
        "calendar_alerts": calendar_alerts,
    }


def _build_term_structure(expiry_ivs: list) -> list:
    """
    Convert market-metrics expiration-implied-volatilities list to term structure.
    Each element from API: {"expiration-date": "YYYY-MM-DD", "implied-volatility": "0.185"}.
    """
    today = date.today()
    ts = []
    for entry in expiry_ivs:
        exp_str = entry.get("expiration-date") or entry.get("expiry")
        iv_raw = entry.get("implied-volatility") or entry.get("atm_iv")
        if not exp_str or iv_raw is None:
            continue
        try:
            exp_date = date.fromisoformat(exp_str)
            dte = (exp_date - today).days
            iv_pct = float(iv_raw)
            if iv_pct < 1:
                iv_pct = iv_pct * 100
            if dte >= 0:
                ts.append({"expiry": exp_str, "dte": dte, "atm_iv": iv_pct})
        except (ValueError, TypeError):
            continue
    return sorted(ts, key=lambda x: x["dte"])


def fetch_market_metrics(session: TastyTradeSession, symbols: list) -> list:
    """
    Fetch market metrics for a list of symbols.
    Includes IV30, IVR, IVP, HV30, VRP, regime, and FF score from term structure.
    """
    if not symbols:
        return []

    syms_param = "&".join(f"symbols[]={urllib.parse.quote(s)}" for s in symbols)
    raw = session.get(f"/market-metrics?{syms_param}")
    items = raw.get("data", {}).get("items", [])

    results = []
    for item in items:
        symbol = item.get("symbol")
        iv30_raw = item.get("implied-volatility-index")
        ivr_raw = item.get("implied-volatility-index-rank")
        ivp_raw = item.get("implied-volatility-percentile")
        hv30_raw = item.get("historical-volatility-30-day")

        def _to_pct(v):
            if v is None:
                return None
            try:
                f = float(v)
                return round(f * 100 if f < 1 else f, 2)
            except (ValueError, TypeError):
                return None

        iv30_f = _to_pct(iv30_raw)
        ivr_f = _to_pct(ivr_raw)
        ivp_f = _to_pct(ivp_raw)
        hv30_f = _to_pct(hv30_raw)

        regime = compute_regime(iv30_f, ivr_f)

        expiry_ivs = (
            item.get("option-expiration-implied-volatilities") or
            item.get("expiration-implied-volatilities") or []
        )
        term_structure = _build_term_structure(expiry_ivs)
        ff_score = compute_ff_score(term_structure)

        earnings_next_date = item.get("earnings-next-date") or item.get("earnings-date")
        ff_score = annotate_ff_earnings(ff_score, earnings_next_date)

        results.append({
            "symbol": symbol,
            "iv30_pct": iv30_f,
            "ivr": ivr_f,
            "ivp": ivp_f,
            "hv30_pct": hv30_f,
            "vrp": round(iv30_f - hv30_f, 2) if iv30_f is not None and hv30_f is not None else None,
            "regime": regime,
            "ff_score": ff_score,
            "term_structure": term_structure[:8],
            "earnings_next_date": earnings_next_date,
            "earnings_date": earnings_next_date,
            "dividend_next_date": item.get("dividend-next-date"),
        })

    return results


def fetch_futures_quotes(session: TastyTradeSession) -> list:
    """
    Fetch front-month futures contracts with live quote data.

    Strategy:
    1. Resolve front-month contract via /instruments/futures.
    2. Try /market-data/quotes with the streamer-symbol (e.g. /ESM6:XCME) first,
       then fall back to the regular symbol (e.g. /ESM6).
    3. If the quotes endpoint returns no price data, fall back to instrument-level
       fields: mark (last price) and settlement-price (prev close).
    """

    def _f(v):
        try:
            return float(v) if v is not None else None
        except (ValueError, TypeError):
            return None

    def _fetch_quote(symbol: str) -> dict:
        """Call /market-data/quotes for a single symbol; return first item or {}."""
        encoded = urllib.parse.quote(symbol, safe="")
        raw = session.get(f"/market-data/quotes?symbols[]={encoded}")
        items = raw.get("data", {}).get("items", []) or []
        return items[0] if items else {}

    results = []
    for sym in FUTURES_WATCHLIST:
        product_code = sym.lstrip("/")
        raw = session.get(f"/instruments/futures?product-code={product_code}")
        futures = raw.get("data", {}).get("items", [])
        if not futures:
            results.append({
                "product": sym, "front_symbol": None, "expiration": None,
                "last": None, "bid": None, "ask": None, "change": None, "change_pct": None,
            })
            continue

        front = futures[0]
        ticker = front.get("symbol", sym)
        streamer_symbol = front.get("streamer-symbol") or front.get("streamerSymbol")
        expiration = front.get("expiration-date")

        quote: dict = {}

        if streamer_symbol:
            quote = _fetch_quote(streamer_symbol)

        if not quote.get("last") and not quote.get("lastPrice") and ticker != streamer_symbol:
            fallback = _fetch_quote(ticker)
            if fallback.get("last") or fallback.get("lastPrice"):
                quote = fallback

        last = _f(quote.get("last") or quote.get("lastPrice"))
        bid = _f(quote.get("bid") or quote.get("bidPrice"))
        ask = _f(quote.get("ask") or quote.get("askPrice"))
        prev_close = _f(
            quote.get("prevClose")
            or quote.get("prevDayClose")
            or quote.get("close")
        )

        if last is None:
            last = _f(front.get("mark") or front.get("mark-price"))

        if prev_close is None:
            prev_close = _f(
                front.get("settlement-price")
                or front.get("prev-settlement-price")
                or front.get("daily-close")
            )

        change = round(last - prev_close, 4) if last is not None and prev_close is not None else None
        change_pct = round((last - prev_close) / prev_close * 100, 2) if last and prev_close else None

        results.append({
            "product": sym,
            "front_symbol": ticker,
            "expiration": expiration,
            "last": last,
            "bid": bid,
            "ask": ask,
            "change": change,
            "change_pct": change_pct,
        })

    return results


def fetch_candles_for_hv(session: TastyTradeSession, symbol: str, days_back: int = 35) -> Optional[float]:
    """Fetch daily candles for a symbol and compute HV21."""
    encoded = urllib.parse.quote(symbol, safe="")
    raw = session.get(
        f"/market-data/history?symbol={encoded}&period-type=day&num-periods={days_back}"
    )
    candles = (
        raw.get("data", {}).get("candles") or
        raw.get("candles") or
        []
    )
    if not candles:
        return None
    return compute_hv(candles, window=21)


def get_active_underlyings(positions: list) -> list:
    """Extract unique underlying symbols from position list."""
    seen = set()
    symbols = []
    for p in positions:
        sym = p.get("underlying") or p.get("underlying-symbol") or p.get("symbol")
        if sym and sym not in seen:
            seen.add(sym)
            symbols.append(sym)
    return symbols


def fetch_transactions_recent(session: TastyTradeSession, days: int = 7) -> list:
    """
    Fetch transactions going back `days` calendar days.
    Uses a proper date range so weekly/monthly P&L summaries are correct.
    """
    acct = session.account_number
    if not acct:
        return []

    since_date = date.today() - timedelta(days=days - 1)
    since_str = since_date.strftime("%Y-%m-%d")
    raw = session.get(
        f"/accounts/{acct}/transactions?start-date={since_str}&per-page=250"
    )
    return raw.get("data", {}).get("items", [])


def build_metadata(report_type: str) -> dict:
    return {
        "report_type": report_type,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_date": date.today().isoformat(),
        "schema_version": "1.0",
        "macro_events": None,
        "fed_calendar": None,
    }


# ---------------------------------------------------------------------------
# Report fetchers
# ---------------------------------------------------------------------------

def fetch_morning(session: TastyTradeSession) -> dict:
    """
    Morning bundle: full account context + market metrics (with FF) + futures snapshot.
    This is the base bundle that intraday reports delta-compress against.
    """
    print("  Fetching account context...")
    account = fetch_account_context(session)

    active_syms = get_active_underlyings(account.get("positions", []))
    print(f"  Fetching market metrics + FF scores for {len(active_syms)} underlyings...")
    metrics = fetch_market_metrics(session, active_syms) if active_syms else []

    regime_summary = {m["symbol"]: m["regime"] for m in metrics}

    print("  Fetching futures quotes...")
    futures_snapshot = fetch_futures_quotes(session)

    print("  Fetching transactions for P&L + net credit history (past 90 days)...")
    txns = fetch_transactions_recent(session, days=90)
    pnl_summary = compute_daily_pnl_from_transactions(txns)

    positions = account.get("positions", [])
    net_liq = account.get("net_liq", 0)
    loss_mon = compute_loss_monitor(positions, net_liq, txns)

    calendar_alerts = account.get("calendar_alerts", [])
    if calendar_alerts:
        print(f"  ⚠  {len(calendar_alerts)} calendar expiry alert(s) detected.")

    bundle: dict = {"meta": build_metadata("morning")}

    if calendar_alerts:
        bundle["calendar_expiry_alerts"] = calendar_alerts

    bundle.update({
        "account": {
            "account_number": account.get("account_number"),
            "net_liq": account.get("net_liq"),
            "buying_power": account.get("buying_power"),
            "cash_balance": account.get("cash_balance"),
        },
        "positions": positions,
        "live_orders": account.get("live_orders", []),
        "loss_monitor": loss_mon,
        "market_metrics": metrics,
        "regime_summary": regime_summary,
        "futures_snapshot": futures_snapshot,
        "pnl": pnl_summary,
    })

    return bundle


def fetch_weekend(session: TastyTradeSession) -> dict:
    """
    Weekend bundle: full watchlist metrics + HV21 for top candidates + weekly P&L.
    """
    print("  Fetching account context...")
    account = fetch_account_context(session)
    active_syms = get_active_underlyings(account.get("positions", []))

    print("  Fetching personal watchlists...")
    watchlist_raw = session.get("/watchlists")
    watchlists = watchlist_raw.get("data", {}).get("items", [])
    watchlist_symbols = set(active_syms)
    for wl in watchlists:
        for entry in wl.get("watchlist-entries", []):
            sym = entry.get("symbol")
            if sym:
                watchlist_symbols.add(sym)

    watchlist_symbols_list = list(watchlist_symbols)[:40]
    print(f"  Fetching metrics for {len(watchlist_symbols_list)} symbols...")
    metrics = fetch_market_metrics(session, watchlist_symbols_list)

    top_candidates = sorted(
        [m for m in metrics if m.get("ivr") is not None and m["ivr"] > 40],
        key=lambda x: x.get("ivr", 0),
        reverse=True,
    )[:10]

    print(f"  Computing HV21 for {len(top_candidates)} top candidates...")
    for candidate in top_candidates:
        sym = candidate["symbol"]
        if not sym.startswith("/"):
            hv21 = fetch_candles_for_hv(session, sym, days_back=35)
            candidate["hv21_pct"] = hv21
        else:
            candidate["hv21_pct"] = None

    print("  Fetching transactions for P&L + net credit history (past 90 days)...")
    txns = fetch_transactions_recent(session, days=90)
    pnl_summary = compute_daily_pnl_from_transactions(txns)

    positions = account.get("positions", [])
    net_liq = account.get("net_liq", 0)
    loss_mon = compute_loss_monitor(positions, net_liq, txns)

    print("  Fetching futures quotes...")
    futures_snapshot = fetch_futures_quotes(session)

    return {
        "meta": build_metadata("weekend"),
        "account": {
            "account_number": account.get("account_number"),
            "net_liq": account.get("net_liq"),
            "buying_power": account.get("buying_power"),
            "cash_balance": account.get("cash_balance"),
        },
        "positions": positions,
        "loss_monitor": loss_mon,
        "full_watchlist_metrics": metrics,
        "top_candidates_by_ivr": top_candidates,
        "pnl": pnl_summary,
        "futures_snapshot": futures_snapshot,
    }


def _load_morning_bundle(output_dir: str) -> Optional[dict]:
    """Load the morning bundle for delta compression in intraday reports."""
    path = Path(output_dir) / "tt_brief_morning.json"
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return None


def _delta_compress_positions(morning_positions: list, session: TastyTradeSession, account_number: str) -> list:
    """
    Delta-compress intraday positions: load structure from morning bundle,
    refresh live close_price, unrealized_pnl, and delta.
    """
    raw = session.get(f"/accounts/{account_number}/positions")
    live_positions = raw.get("data", {}).get("items", [])
    live_map = {p.get("symbol"): p for p in live_positions}

    result = []
    for mp in morning_positions:
        sym = mp.get("symbol")
        live = live_map.get(sym, {})
        result.append({
            **mp,
            "close_price": live.get("close-price") if live else mp.get("close_price"),
            "unrealized_pnl": live.get("unrealized-day-gain") if live else mp.get("unrealized_pnl"),
            "delta": live.get("delta") if live else mp.get("delta"),
        })
    return result


def fetch_intraday(session: TastyTradeSession, report_type: str, output_dir: str) -> dict:
    """
    Intraday report (open, noon, preclose, eod): delta-compress against morning bundle.
    Refreshes live close_price, unrealized_pnl, and delta per position.
    """
    morning = _load_morning_bundle(output_dir)
    acct = session.account_number

    delta_compressed = False
    if morning and acct:
        print("  Delta compressing against morning bundle...")
        positions = _delta_compress_positions(
            morning.get("positions", []),
            session,
            acct,
        )
        balances_raw = session.get(f"/accounts/{acct}/balances")
        balances = balances_raw.get("data", {})
        net_liq = float(balances.get("net-liquidating-value", 0) or 0)
        buying_power = float(
            balances.get("derivative-buying-power", 0) or
            balances.get("buying-power", 0) or 0
        )
        delta_compressed = True
    else:
        print("  Morning bundle not found — fetching full account context...")
        account = fetch_account_context(session)
        positions = account.get("positions", [])
        net_liq = account.get("net_liq", 0)
        buying_power = account.get("buying_power", 0)

    print("  Fetching live orders...")
    orders_raw = session.get(f"/accounts/{acct}/orders/live") if acct else {}
    live_orders_raw = orders_raw.get("data", {}).get("items", [])
    live_orders = [
        {
            "id": o.get("id"),
            "underlying": o.get("underlying-symbol"),
            "status": o.get("status"),
            "order_type": o.get("order-type"),
            "price": o.get("price"),
            "legs": len(o.get("legs", [])),
        }
        for o in live_orders_raw
    ]

    active_syms = list({p.get("underlying") for p in positions if p.get("underlying")})
    print(f"  Refreshing metrics + FF for {len(active_syms)} underlyings...")
    metrics = fetch_market_metrics(session, active_syms) if active_syms else []

    print("  Fetching transactions for P&L + net credit history (past 90 days)...")
    txns = fetch_transactions_recent(session, days=90)
    pnl_summary = compute_daily_pnl_from_transactions(txns)

    loss_mon = compute_loss_monitor(positions, net_liq, txns)

    futures_snapshot = None
    if report_type == "open":
        print("  Fetching futures quotes for open brief...")
        futures_snapshot = fetch_futures_quotes(session)

    bundle = {
        "meta": {
            **build_metadata(report_type),
            "delta_compressed": delta_compressed,
            "delta_compression_note": (
                "Position structure (strikes/expiry/quantity) loaded from morning bundle. "
                "Only close_price, unrealized_pnl, and delta are refreshed. "
                "Positions opened/closed after the morning run may not appear here."
            ) if delta_compressed else None,
        },
        "account": {
            "account_number": acct,
            "net_liq": net_liq,
            "buying_power": buying_power,
        },
        "positions": positions,
        "live_orders": live_orders,
        "loss_monitor": loss_mon,
        "market_metrics": metrics,
        "pnl": pnl_summary,
    }

    if futures_snapshot is not None:
        bundle["futures_snapshot"] = futures_snapshot

    if report_type == "preclose":
        today_str = date.today().isoformat()
        zero_dte_positions = [
            p for p in positions
            if p.get("instrument_type") in ("Equity Option", "Future Option")
            and p.get("expiration_date") == today_str
        ]
        bundle["zero_dte_flag"] = len(zero_dte_positions) > 0
        bundle["zero_dte_positions"] = zero_dte_positions
        bundle["circuit_breaker"] = (
            loss_mon.get("circuit_breaker", False) or
            pnl_summary.get("daily_0dte_circuit_breaker", False)
        )

    if report_type == "eod":
        print("  Fetching weekly transactions for full EOD P&L...")
        all_txns = fetch_transactions_recent(session, days=7)
        full_pnl = compute_daily_pnl_from_transactions(all_txns)
        bundle["pnl"] = full_pnl
        bundle["growth_plan"] = {
            "net_liq": net_liq,
            "phase_1_target": 25000,
            "phase_2_target": 50000,
            "phase_3_target": 100000,
            "phase_4_target": 250000,
            "current_phase": (
                1 if net_liq < 25000 else
                2 if net_liq < 50000 else
                3 if net_liq < 100000 else
                4
            ),
            "pct_to_next_milestone": round(
                (net_liq / (
                    25000 if net_liq < 25000 else
                    50000 if net_liq < 50000 else
                    100000 if net_liq < 100000 else
                    250000
                )) * 100, 1
            ) if net_liq > 0 else None,
        }

    return bundle


# ---------------------------------------------------------------------------
# Report dispatch
# ---------------------------------------------------------------------------

REPORT_FETCHERS = {
    "morning":  lambda s, od: fetch_morning(s),
    "weekend":  lambda s, od: fetch_weekend(s),
    "open":     lambda s, od: fetch_intraday(s, "open", od),
    "noon":     lambda s, od: fetch_intraday(s, "noon", od),
    "preclose": lambda s, od: fetch_intraday(s, "preclose", od),
    "eod":      lambda s, od: fetch_intraday(s, "eod", od),
}


def write_bundle_atomic(bundle: dict, output_dir: str, report_type: str) -> Path:
    """Write bundle atomically: write to temp file, then rename."""
    output_path = Path(output_dir) / f"tt_brief_{report_type}.json"
    output_dir_path = Path(output_dir)
    output_dir_path.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=output_dir, prefix=f"tt_brief_{report_type}_", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(bundle, f, indent=2, default=str)
        os.rename(tmp_path, output_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        raise

    return output_path


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Pre-fetch TastyTrade data bundles for daily trading reports.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Report types:
  morning   — Full account snapshot (base for delta compression)
  open      — Intraday refresh at market open (delta vs morning)
  noon      — Midday position + P&L refresh
  preclose  — Pre-close check with 0DTE flags and circuit breaker
  eod       — End-of-day realized P&L and growth plan update
  weekend   — Full watchlist scan + HV computation + weekly P&L

Environment variables:
  TT_USERNAME   TastyTrade login email
  TT_PASSWORD   TastyTrade password

Examples:
  python3 scripts/prefetch.py --report morning
  python3 scripts/prefetch.py --report eod --output-dir /tmp
  python3 scripts/prefetch.py --report noon --dry-run
""",
    )
    parser.add_argument(
        "--report",
        required=True,
        choices=list(REPORT_FETCHERS.keys()),
        help="Report type to generate",
    )
    parser.add_argument(
        "--output-dir",
        default="/tmp",
        help="Directory to write bundle JSON (default: /tmp)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print bundle as formatted JSON without writing to disk",
    )
    args = parser.parse_args()

    print(f"[prefetch] Generating '{args.report}' bundle...")
    t0 = time.time()

    session = TastyTradeSession()
    fetcher = REPORT_FETCHERS[args.report]
    bundle = fetcher(session, args.output_dir)

    elapsed = round(time.time() - t0, 1)

    if args.dry_run:
        print(json.dumps(bundle, indent=2, default=str))
        print(f"\n[prefetch] Dry run complete in {elapsed}s — bundle NOT written.", file=sys.stderr)
    else:
        output_path = write_bundle_atomic(bundle, args.output_dir, args.report)
        print(f"[prefetch] Bundle written to {output_path} in {elapsed}s")

    token_est = len(json.dumps(bundle, default=str)) // 4
    print(f"[prefetch] Estimated bundle size: ~{token_est} tokens", file=sys.stderr)


if __name__ == "__main__":
    main()
