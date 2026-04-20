#!/usr/bin/env python3
"""
iv_curve.py — IV smile / skew curve for a single expiration.
Plots implied volatility vs strike (or delta) to visualize skew structure.

Usage:
  python3 iv_curve.py --input /tmp/tt_filtered_SPY_0119.json --expiry 2024-01-19
  python3 iv_curve.py --input /tmp/tt_chain_SPY.json --expiry 2024-01-19 --x-axis delta
  python3 iv_curve.py --input /tmp/tt_chain_SPY.json --expiry 2024-01-19 --compare-expiry 2024-02-16
"""
import argparse
import json
import sys
import os
from datetime import date

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mticker
    import numpy as np
except ImportError:
    print("Install matplotlib and numpy: pip install matplotlib numpy", file=sys.stderr)
    sys.exit(1)

DARK_BG = "#0d1117"
GRID_COLOR = "#21262d"
TEXT_COLOR = "#e6edf3"
CALL_COLOR = "#3fb950"
PUT_COLOR = "#f85149"
ATM_COLOR = "#d29922"
COMPARE_COLOR = "#58a6ff"


def load_data(path):
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, dict) and "data" in data:
        data = data["data"]
    if isinstance(data, dict) and "items" in data:
        data = data["items"]
    return data


def extract_strikes_for_expiry(chain, expiry):
    """Find strikes for a specific expiry from chain data or pre-filtered data."""
    # If already pre-filtered (list of strike dicts)
    if isinstance(chain, list) and chain and "call_iv_pct" in chain[0]:
        return chain

    # Raw chain format
    for item in chain:
        exp_date = item.get("expiration-date") or item.get("expiry")
        if exp_date and (exp_date == expiry or exp_date.startswith(expiry)):
            return item.get("strikes") or item.get("options") or []
    return []


def parse_strikes(raw_strikes, x_axis="strike"):
    """Parse raw or pre-filtered strike data into plottable arrays."""
    calls_x, calls_iv = [], []
    puts_x, puts_iv = [], []

    for s in raw_strikes:
        if "call_iv_pct" in s:
            # Pre-filtered format
            strike = s["strike"]
            call_iv = s.get("call_iv_pct")
            put_iv = s.get("put_iv_pct")
            call_delta = s.get("call_delta", 0.5)
            put_delta = abs(s.get("put_delta", 0.5))
            x_c = call_delta if x_axis == "delta" else strike
            x_p = put_delta if x_axis == "delta" else strike
        else:
            # Raw chain format
            strike = float(s.get("strike-price", 0))
            call_iv = float(s.get("call-implied-volatility") or 0) * 100
            put_iv = float(s.get("put-implied-volatility") or call_iv / 100) * 100
            call_delta = abs(float(s.get("call-delta", 0.5) or 0.5))
            put_delta = abs(float(s.get("put-delta", 0.5) or 0.5))
            x_c = call_delta if x_axis == "delta" else strike
            x_p = put_delta if x_axis == "delta" else strike

        if call_iv and call_iv > 0:
            calls_x.append(x_c)
            calls_iv.append(call_iv)
        if put_iv and put_iv > 0:
            puts_x.append(x_p)
            puts_iv.append(put_iv)

    # Sort
    if calls_x:
        c_sorted = sorted(zip(calls_x, calls_iv))
        calls_x, calls_iv = zip(*c_sorted)
    if puts_x:
        p_sorted = sorted(zip(puts_x, puts_iv))
        puts_x, puts_iv = zip(*p_sorted)

    return list(calls_x), list(calls_iv), list(puts_x), list(puts_iv)


def setup_dark_style(fig, ax):
    fig.patch.set_facecolor(DARK_BG)
    ax.set_facecolor(DARK_BG)
    ax.tick_params(colors=TEXT_COLOR)
    ax.xaxis.label.set_color(TEXT_COLOR)
    ax.yaxis.label.set_color(TEXT_COLOR)
    ax.title.set_color(TEXT_COLOR)
    for spine in ax.spines.values():
        spine.set_edgecolor(GRID_COLOR)
    ax.grid(True, color=GRID_COLOR, linewidth=0.5, linestyle="--", alpha=0.7)


def main():
    parser = argparse.ArgumentParser(description="Plot IV smile / skew curve")
    parser.add_argument("--input", required=True, help="Path to chain JSON (raw or filtered)")
    parser.add_argument("--expiry", required=True, help="Expiry date YYYY-MM-DD")
    parser.add_argument("--output", help="Output PNG path (default: /tmp/tt_chart_iv_curve_<sym>.png)")
    parser.add_argument("--x-axis", choices=["strike", "delta"], default="strike")
    parser.add_argument("--compare-expiry", help="Second expiry to overlay")
    parser.add_argument("--mark-strikes", nargs="+", type=float, help="Strikes to highlight")
    parser.add_argument("--symbol", default="", help="Symbol name for title")
    args = parser.parse_args()

    symbol = args.symbol or os.path.basename(args.input).replace(".json", "").replace("tt_chain_", "").upper()
    output = args.output or f"/tmp/tt_chart_iv_curve_{symbol}.png"

    chain = load_data(args.input)
    raw = extract_strikes_for_expiry(chain, args.expiry)
    if not raw:
        print(f"No strikes found for expiry {args.expiry}", file=sys.stderr)
        sys.exit(1)

    calls_x, calls_iv, puts_x, puts_iv = parse_strikes(raw, args.x_axis)

    fig, ax = plt.subplots(figsize=(12, 6))
    setup_dark_style(fig, ax)

    if calls_x:
        ax.plot(calls_x, calls_iv, color=CALL_COLOR, linewidth=2, label="Call IV", marker="o", markersize=3)
    if puts_x:
        ax.plot(puts_x, puts_iv, color=PUT_COLOR, linewidth=2, label="Put IV", marker="o", markersize=3)

    # Compare second expiry
    if args.compare_expiry:
        raw2 = extract_strikes_for_expiry(chain, args.compare_expiry)
        if raw2:
            cx2, civ2, px2, piv2 = parse_strikes(raw2, args.x_axis)
            if cx2:
                ax.plot(cx2, civ2, color=COMPARE_COLOR, linewidth=1.5, linestyle="--",
                        label=f"Call IV {args.compare_expiry}", alpha=0.8)
            if px2:
                ax.plot(px2, piv2, color=COMPARE_COLOR, linewidth=1.5, linestyle=":",
                        label=f"Put IV {args.compare_expiry}", alpha=0.8)

    # Mark specific strikes
    if args.mark_strikes and args.x_axis == "strike":
        for strike in args.mark_strikes:
            ax.axvline(x=strike, color=ATM_COLOR, linewidth=1, linestyle="--", alpha=0.8)
            ax.text(strike, ax.get_ylim()[1] * 0.95 if ax.get_ylim()[1] > 0 else 30,
                    f"{strike:.0f}", color=ATM_COLOR, ha="center", fontsize=8)

    xlabel = "Strike" if args.x_axis == "strike" else "Delta"
    ax.set_xlabel(xlabel, fontsize=11)
    ax.set_ylabel("Implied Volatility (%)", fontsize=11)
    ax.set_title(f"{symbol} — IV Skew / Smile  |  Expiry: {args.expiry}", fontsize=13, fontweight="bold")
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.1f%%"))

    legend = ax.legend(facecolor="#161b22", edgecolor=GRID_COLOR, labelcolor=TEXT_COLOR)
    plt.tight_layout()
    plt.savefig(output, dpi=150, bbox_inches="tight", facecolor=DARK_BG)
    plt.close()
    print(f"Chart saved: {output}")


if __name__ == "__main__":
    main()
