#!/usr/bin/env python3
"""
filter_chain.py — Tastytrade option chain compressor.
Prevents context window overflow by extracting only relevant data.

Usage:
  python3 filter_chain.py --input /tmp/tt_chain_SPY.json --expiry 2024-01-19 --mode strikes
  python3 filter_chain.py --input /tmp/tt_chain_SPY.json --mode term
  python3 filter_chain.py --input /tmp/tt_chain_SPY.json --mode surface
  python3 filter_chain.py --input /tmp/tt_chain_SPY.json --expiry 2024-01-19 --target-deltas 0.30 0.16
"""
import argparse
import json
import sys
from datetime import date


def load_chain(path):
    with open(path) as f:
        data = json.load(f)
    # Handle both raw MCP response and pre-extracted chain
    if isinstance(data, dict) and "data" in data:
        data = data["data"]
    if isinstance(data, dict) and "items" in data:
        data = data["items"]
    return data


def find_expirations(chain):
    """Return list of (expiry_date_str, strikes_list) tuples."""
    results = []
    for item in chain:
        exp_date = item.get("expiration-date") or item.get("expiry-date") or item.get("expiration")
        strikes = item.get("strikes") or item.get("options") or []
        if exp_date:
            results.append((exp_date, strikes))
    return results


def get_atm_iv(strikes, spot=None):
    """Find ATM IV (call and put average) from a list of strikes."""
    if not strikes:
        return None
    # Find strike closest to ATM
    if spot:
        closest = min(strikes, key=lambda s: abs(float(s.get("strike-price", 0)) - spot))
    else:
        # Use 0.50 delta as ATM proxy
        closest = min(strikes, key=lambda s: abs(float(s.get("call-delta", s.get("delta", 0.5)) or 0.5) - 0.5))
    call_iv = float(closest.get("call-implied-volatility") or closest.get("implied-volatility") or 0)
    put_iv = float(closest.get("put-implied-volatility") or call_iv)
    return (call_iv + put_iv) / 2 if call_iv or put_iv else None


def mode_term(chain):
    """Extract ATM IV per expiry date for term structure analysis."""
    expirations = find_expirations(chain)
    result = []
    today = date.today()
    for exp_date, strikes in sorted(expirations, key=lambda x: x[0]):
        try:
            exp = date.fromisoformat(exp_date)
            dte = (exp - today).days
        except Exception:
            dte = None
        atm_iv = get_atm_iv(strikes)
        if atm_iv and dte is not None and dte >= 0:
            result.append({"expiry": exp_date, "dte": dte, "atm_iv": round(atm_iv * 100, 2)})
    return result


def mode_strikes(chain, expiry, delta_min=0.05, delta_max=0.55):
    """Extract strikes in delta range for a single expiry."""
    expirations = find_expirations(chain)
    target_exp = None
    for exp_date, strikes in expirations:
        if exp_date == expiry or exp_date.startswith(expiry):
            target_exp = strikes
            break
    if target_exp is None:
        available = [e for e, _ in expirations]
        print(f"Expiry {expiry} not found. Available: {available[:10]}", file=sys.stderr)
        sys.exit(1)

    result = []
    for s in target_exp:
        call_delta = abs(float(s.get("call-delta", s.get("delta", 0)) or 0))
        put_delta = abs(float(s.get("put-delta", 0) or 0)) or (1 - call_delta)
        strike = float(s.get("strike-price", 0))
        call_iv = float(s.get("call-implied-volatility") or s.get("implied-volatility") or 0) * 100
        put_iv = float(s.get("put-implied-volatility") or call_iv / 100) * 100
        call_bid = float(s.get("call-bid-price", 0) or 0)
        call_ask = float(s.get("call-ask-price", 0) or 0)
        put_bid = float(s.get("put-bid-price", 0) or 0)
        put_ask = float(s.get("put-ask-price", 0) or 0)

        in_range = (delta_min <= call_delta <= delta_max) or (delta_min <= put_delta <= delta_max)
        if in_range:
            result.append({
                "strike": strike,
                "call_delta": round(call_delta, 3),
                "put_delta": round(-put_delta, 3),
                "call_iv_pct": round(call_iv, 1),
                "put_iv_pct": round(put_iv, 1),
                "call_mid": round((call_bid + call_ask) / 2, 2) if call_bid or call_ask else None,
                "put_mid": round((put_bid + put_ask) / 2, 2) if put_bid or put_ask else None,
            })
    return sorted(result, key=lambda x: x["strike"])


def mode_surface(chain):
    """Extract full IV surface: list of {expiry, dte, strike, call_iv, put_iv}."""
    expirations = find_expirations(chain)
    today = date.today()
    result = []
    for exp_date, strikes in sorted(expirations, key=lambda x: x[0]):
        try:
            exp = date.fromisoformat(exp_date)
            dte = (exp - today).days
        except Exception:
            dte = None
        if dte is None or dte < 0:
            continue
        for s in strikes:
            strike = float(s.get("strike-price", 0))
            call_iv = float(s.get("call-implied-volatility") or s.get("implied-volatility") or 0) * 100
            put_iv = float(s.get("put-implied-volatility") or call_iv / 100) * 100
            if call_iv or put_iv:
                result.append({"expiry": exp_date, "dte": dte, "strike": strike,
                                "call_iv": round(call_iv, 1), "put_iv": round(put_iv, 1)})
    return result


def mode_targets(chain, expiry, target_deltas):
    """Find closest strikes to specified target deltas."""
    strikes_data = mode_strikes(chain, expiry, delta_min=0.0, delta_max=1.0)
    results = {}
    for target in target_deltas:
        target = float(target)
        # Find closest call and put
        best_call = min(strikes_data, key=lambda s: abs(s["call_delta"] - target), default=None)
        best_put = min(strikes_data, key=lambda s: abs(abs(s["put_delta"]) - target), default=None)
        results[f"{target:.2f}δ"] = {
            "call": best_call,
            "put": best_put
        }
    return results


def print_strikes_table(strikes):
    print(f"\n{'Strike':>8} {'CΔ':>6} {'PΔ':>6} {'C IV%':>7} {'P IV%':>7} {'C Mid':>7} {'P Mid':>7}")
    print("─" * 58)
    for s in strikes:
        print(f"{s['strike']:>8.1f} {s['call_delta']:>6.3f} {s['put_delta']:>6.3f} "
              f"{s['call_iv_pct']:>6.1f}% {s['put_iv_pct']:>6.1f}% "
              f"{s['call_mid'] or '–':>7} {s['put_mid'] or '–':>7}")


def print_term_table(term):
    print(f"\n{'Expiry':>12} {'DTE':>5} {'ATM IV%':>8}")
    print("─" * 30)
    for row in term:
        print(f"{row['expiry']:>12} {row['dte']:>5} {row['atm_iv']:>7.1f}%")


def main():
    parser = argparse.ArgumentParser(description="Filter tastytrade option chain data")
    parser.add_argument("--input", required=True, help="Path to chain JSON file")
    parser.add_argument("--output", help="Save output JSON to path (optional)")
    parser.add_argument("--mode", choices=["strikes", "term", "surface", "targets"], default="strikes")
    parser.add_argument("--expiry", help="Expiry date YYYY-MM-DD (required for strikes/targets)")
    parser.add_argument("--delta-range", nargs=2, type=float, default=[0.10, 0.50],
                        metavar=("MIN", "MAX"), help="Delta range filter (default: 0.10 0.50)")
    parser.add_argument("--target-deltas", nargs="+", type=float, help="Target delta values for targets mode")
    args = parser.parse_args()

    chain = load_chain(args.input)

    if args.mode == "term":
        result = mode_term(chain)
        print_term_table(result)
    elif args.mode == "strikes":
        if not args.expiry:
            parser.error("--expiry required for strikes mode")
        result = mode_strikes(chain, args.expiry, args.delta_range[0], args.delta_range[1])
        print_strikes_table(result)
    elif args.mode == "surface":
        result = mode_surface(chain)
        print(f"Surface data: {len(result)} data points across {len(set(r['expiry'] for r in result))} expiries")
    elif args.mode == "targets":
        if not args.expiry or not args.target_deltas:
            parser.error("--expiry and --target-deltas required for targets mode")
        result = mode_targets(chain, args.expiry, args.target_deltas)
        for delta_label, hits in result.items():
            print(f"\n{delta_label}:")
            if hits["call"]:
                print(f"  Call: {hits['call']}")
            if hits["put"]:
                print(f"  Put:  {hits['put']}")

    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2)
        print(f"\nSaved to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
