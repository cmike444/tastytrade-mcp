#!/usr/bin/env python3
"""
payoff_diagram.py — Payoff at expiration for a single trade or full portfolio.

Usage:
  python3 payoff_diagram.py \
    --legs '[{"type":"short_put","strike":445,"premium":2.50,"qty":1},
             {"type":"long_put","strike":440,"premium":1.00,"qty":1}]' \
    --spot 450 --symbol SPY

  python3 payoff_diagram.py \
    --mode portfolio \
    --positions /tmp/tt_positions.json \
    --spot 450
"""
import argparse
import json
import sys
import os

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
PROFIT_COLOR = "#3fb950"
LOSS_COLOR = "#f85149"
ZERO_COLOR = "#8b949e"
SPOT_COLOR = "#d29922"
BE_COLOR = "#58a6ff"

# Contract multipliers
MULTIPLIERS = {
    "Equity Option": 100,
    "Future Option": 50,   # ES default, override with --multiplier
    "Equity": 1,
    "Future": 50,
}


def option_payoff(spot_prices, leg_type, strike, premium, qty, multiplier=100):
    """Compute P&L array for a single leg at expiration."""
    s = np.array(spot_prices)
    if leg_type == "long_call":
        intrinsic = np.maximum(s - strike, 0)
        pnl = (intrinsic - premium) * qty * multiplier
    elif leg_type == "short_call":
        intrinsic = np.maximum(s - strike, 0)
        pnl = (premium - intrinsic) * qty * multiplier
    elif leg_type == "long_put":
        intrinsic = np.maximum(strike - s, 0)
        pnl = (intrinsic - premium) * qty * multiplier
    elif leg_type == "short_put":
        intrinsic = np.maximum(strike - s, 0)
        pnl = (premium - intrinsic) * qty * multiplier
    elif leg_type in ("long_stock", "long_equity"):
        pnl = (s - premium) * qty * multiplier
    elif leg_type in ("short_stock", "short_equity"):
        pnl = (premium - s) * qty * multiplier
    elif leg_type in ("long_future",):
        pnl = (s - premium) * qty * multiplier
    elif leg_type in ("short_future",):
        pnl = (premium - s) * qty * multiplier
    else:
        pnl = np.zeros_like(s)
    return pnl


def parse_legs(legs_json, multiplier=100):
    """Parse leg list into a structured format."""
    if isinstance(legs_json, str):
        legs_json = json.loads(legs_json)
    parsed = []
    for leg in legs_json:
        parsed.append({
            "type": leg.get("type", "long_call"),
            "strike": float(leg.get("strike", 0)),
            "premium": float(leg.get("premium", 0)),
            "qty": int(leg.get("qty", 1)),
            "multiplier": int(leg.get("multiplier", multiplier)),
        })
    return parsed


def positions_to_legs(positions_data, multiplier=100):
    """Convert tastytrade positions JSON to leg format."""
    if isinstance(positions_data, dict) and "data" in positions_data:
        positions_data = positions_data["data"]
    if isinstance(positions_data, dict) and "items" in positions_data:
        positions_data = positions_data["items"]

    legs = []
    for pos in positions_data:
        inst_type = pos.get("instrument-type", "")
        symbol = pos.get("symbol", "")
        qty = float(pos.get("quantity", 0))
        direction = pos.get("quantity-direction", "Long")
        avg_price = float(pos.get("average-open-price", 0))
        close_price = float(pos.get("close-price") or avg_price)

        if inst_type == "Equity Option":
            # Parse OCC symbol to get strike and type
            parts = symbol.split()
            if len(parts) >= 2:
                option_code = parts[1]  # e.g., 240119C00150000
                if len(option_code) >= 15:
                    opt_type = "call" if option_code[6] == "C" else "put"
                    strike = int(option_code[7:]) / 1000
                    leg_type = f"{'long' if direction == 'Long' else 'short'}_{opt_type}"
                    legs.append({
                        "type": leg_type,
                        "strike": strike,
                        "premium": avg_price,
                        "qty": int(qty),
                        "multiplier": 100,
                        "label": symbol,
                    })
        elif inst_type == "Equity":
            leg_type = "long_stock" if direction == "Long" else "short_stock"
            legs.append({
                "type": leg_type,
                "strike": avg_price,
                "premium": avg_price,
                "qty": int(qty),
                "multiplier": 1,
                "label": symbol,
            })
    return legs


def find_breakevens(spots, total_pnl):
    """Find x-axis crossings (breakeven points)."""
    breakevens = []
    for i in range(len(total_pnl) - 1):
        if (total_pnl[i] <= 0 and total_pnl[i + 1] > 0) or \
           (total_pnl[i] >= 0 and total_pnl[i + 1] < 0):
            # Linear interpolation
            be = spots[i] + (spots[i + 1] - spots[i]) * (-total_pnl[i]) / (total_pnl[i + 1] - total_pnl[i])
            breakevens.append(be)
    return breakevens


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
    parser = argparse.ArgumentParser(description="Payoff diagram at expiration")
    parser.add_argument("--legs", help="JSON array of legs")
    parser.add_argument("--positions", help="Path to tastytrade positions JSON (portfolio mode)")
    parser.add_argument("--mode", choices=["trade", "portfolio"], default="trade")
    parser.add_argument("--spot", type=float, required=True, help="Current spot price")
    parser.add_argument("--spot-range", type=float, default=0.15,
                        help="Fraction of spot to show on each side (default: 0.15 = ±15%%)")
    parser.add_argument("--multiplier", type=int, default=100, help="Contract multiplier (default: 100)")
    parser.add_argument("--symbol", default="", help="Underlying symbol for title")
    parser.add_argument("--output", help="Output PNG path")
    args = parser.parse_args()

    if args.mode == "portfolio":
        if not args.positions:
            parser.error("--positions required for portfolio mode")
        with open(args.positions) as f:
            pos_data = json.load(f)
        legs = positions_to_legs(pos_data, args.multiplier)
        title_suffix = "Portfolio Payoff"
    else:
        if not args.legs:
            parser.error("--legs required for trade mode")
        legs = parse_legs(args.legs, args.multiplier)
        title_suffix = "Trade Payoff"

    if not legs:
        print("No legs to plot.", file=sys.stderr)
        sys.exit(1)

    # Build price range
    spot = args.spot
    lo = spot * (1 - args.spot_range)
    hi = spot * (1 + args.spot_range)
    spots = np.linspace(lo, hi, 500)

    # Compute total P&L
    total_pnl = np.zeros(len(spots))
    for leg in legs:
        total_pnl += option_payoff(spots, leg["type"], leg["strike"],
                                   leg["premium"], leg["qty"], leg["multiplier"])

    max_profit = float(np.max(total_pnl))
    max_loss = float(np.min(total_pnl))
    breakevens = find_breakevens(spots, total_pnl)

    symbol = args.symbol or ""
    output = args.output or f"/tmp/tt_chart_payoff_{symbol or 'trade'}.png"

    fig, ax = plt.subplots(figsize=(12, 6))
    setup_dark_style(fig, ax)

    # Fill profit / loss regions
    ax.fill_between(spots, total_pnl, 0, where=(total_pnl > 0),
                    color=PROFIT_COLOR, alpha=0.25, label="Profit")
    ax.fill_between(spots, total_pnl, 0, where=(total_pnl <= 0),
                    color=LOSS_COLOR, alpha=0.25, label="Loss")

    # Main P&L line
    ax.plot(spots, total_pnl, color=TEXT_COLOR, linewidth=2.5, zorder=5)

    # Zero line
    ax.axhline(y=0, color=ZERO_COLOR, linewidth=1, linestyle="-", alpha=0.8)

    # Spot price
    ax.axvline(x=spot, color=SPOT_COLOR, linewidth=1.5, linestyle="--", alpha=0.9, label=f"Spot {spot:.2f}")
    spot_pnl = float(np.interp(spot, spots, total_pnl))
    ax.scatter([spot], [spot_pnl], color=SPOT_COLOR, zorder=6, s=60)

    # Break-even lines
    for be in breakevens:
        ax.axvline(x=be, color=BE_COLOR, linewidth=1, linestyle=":", alpha=0.9)
        ax.text(be, max_loss * 0.9 if max_loss < 0 else -50,
                f"BE\n{be:.2f}", color=BE_COLOR, ha="center", fontsize=8)

    # Strike markers
    for leg in legs:
        if leg.get("strike") and leg["type"] not in ("long_stock", "short_stock"):
            ax.axvline(x=leg["strike"], color=ZERO_COLOR, linewidth=0.5, linestyle="--", alpha=0.4)

    # Annotations
    ax.text(0.02, 0.97, f"Max Profit: ${max_profit:,.0f}" if max_profit < 1e6 else "Max Profit: Unlimited",
            transform=ax.transAxes, color=PROFIT_COLOR, fontsize=10, va="top")
    ax.text(0.02, 0.90, f"Max Loss: ${max_loss:,.0f}" if max_loss > -1e6 else "Max Loss: Unlimited",
            transform=ax.transAxes, color=LOSS_COLOR, fontsize=10, va="top")
    if breakevens:
        be_str = ", ".join(f"{be:.2f}" for be in breakevens)
        ax.text(0.02, 0.83, f"Break-even: {be_str}",
                transform=ax.transAxes, color=BE_COLOR, fontsize=10, va="top")

    ax.set_xlabel("Underlying Price at Expiration", fontsize=11)
    ax.set_ylabel("Profit / Loss ($)", fontsize=11)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"${x:,.0f}"))
    ax.set_title(f"{symbol} — {title_suffix}", fontsize=13, fontweight="bold")

    legend = ax.legend(facecolor="#161b22", edgecolor=GRID_COLOR, labelcolor=TEXT_COLOR)
    plt.tight_layout()
    plt.savefig(output, dpi=150, bbox_inches="tight", facecolor=DARK_BG)
    plt.close()
    print(f"Chart saved: {output}")


if __name__ == "__main__":
    main()
