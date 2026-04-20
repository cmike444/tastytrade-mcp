#!/usr/bin/env python3
"""
equity_curve.py — Net liquidation value history chart.
Plots account equity over time with optional drawdown analysis and benchmark overlay.

Usage:
  python3 equity_curve.py --input /tmp/tt_netliq_history.json
  python3 equity_curve.py --input /tmp/tt_netliq_history.json --drawdown --period 90d
  python3 equity_curve.py --input /tmp/tt_netliq_history.json --benchmark /tmp/tt_candles_SPY.json
"""
import argparse
import json
import sys
from datetime import datetime, timedelta

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mticker
    import matplotlib.dates as mdates
    import numpy as np
except ImportError:
    print("Install matplotlib and numpy: pip install matplotlib numpy", file=sys.stderr)
    sys.exit(1)

DARK_BG = "#0d1117"
GRID_COLOR = "#21262d"
TEXT_COLOR = "#e6edf3"
EQUITY_COLOR = "#58a6ff"
BENCH_COLOR = "#d29922"
DRAWDOWN_COLOR = "#f85149"
FILL_COLOR = "#1f6feb"
ZERO_COLOR = "#8b949e"


def load_netliq(path):
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, dict) and "data" in data:
        data = data["data"]
    if isinstance(data, dict) and "items" in data:
        data = data["items"]

    dates, values = [], []
    for item in (data if isinstance(data, list) else [data]):
        dt_str = (item.get("date") or item.get("time") or
                  item.get("snapshot-date") or item.get("recorded-at"))
        val = (item.get("net-liquidating-value") or item.get("close") or
               item.get("value") or item.get("net-liq"))
        if dt_str and val:
            try:
                dt = datetime.fromisoformat(str(dt_str).replace("Z", "+00:00"))
            except Exception:
                try:
                    dt = datetime.strptime(str(dt_str)[:10], "%Y-%m-%d")
                except Exception:
                    continue
            dates.append(dt)
            values.append(float(val))

    pairs = sorted(zip(dates, values))
    if pairs:
        d, v = zip(*pairs)
        return list(d), list(v)
    return [], []


def load_benchmark(path):
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, dict) and "data" in data:
        data = data["data"]
    if isinstance(data, dict) and "candles" in data:
        data = data["candles"]

    dates, closes = [], []
    for c in (data if isinstance(data, list) else []):
        dt_str = c.get("time") or c.get("date")
        close = c.get("close")
        if dt_str and close:
            try:
                if isinstance(dt_str, (int, float)):
                    dt = datetime.fromtimestamp(float(dt_str) / 1000)
                else:
                    dt = datetime.fromisoformat(str(dt_str).replace("Z", "+00:00"))
            except Exception:
                continue
            dates.append(dt)
            closes.append(float(close))

    pairs = sorted(zip(dates, closes))
    if pairs:
        d, c = zip(*pairs)
        return list(d), list(c)
    return [], []


def compute_drawdown(values):
    vals = np.array(values, dtype=float)
    peak = np.maximum.accumulate(vals)
    with np.errstate(divide="ignore", invalid="ignore"):
        dd = np.where(peak > 0, (vals - peak) / peak * 100, 0.0)
    return dd


def compute_sharpe(values, risk_free_annual=0.05):
    if len(values) < 10:
        return None
    vals = np.array(values, dtype=float)
    daily_returns = np.diff(vals) / vals[:-1]
    daily_rf = risk_free_annual / 252
    excess = daily_returns - daily_rf
    std = excess.std()
    if std == 0:
        return None
    return (excess.mean() / std) * np.sqrt(252)


def normalize(values, start_val):
    arr = np.array(values, dtype=float)
    if arr[0] == 0:
        return arr
    return arr / arr[0] * start_val


def filter_period(dates, values, period_str):
    if not period_str or not dates:
        return dates, values
    days = int(period_str.replace("d", "").replace("D", ""))
    cutoff = datetime.now() - timedelta(days=days)
    pairs = [(d, v) for d, v in zip(dates, values) if d >= cutoff]
    if not pairs:
        return dates, values
    d, v = zip(*pairs)
    return list(d), list(v)


def setup_dark_axes(ax):
    ax.set_facecolor(DARK_BG)
    ax.tick_params(colors=TEXT_COLOR, labelsize=9)
    ax.xaxis.label.set_color(TEXT_COLOR)
    ax.yaxis.label.set_color(TEXT_COLOR)
    ax.title.set_color(TEXT_COLOR)
    for spine in ax.spines.values():
        spine.set_edgecolor(GRID_COLOR)
    ax.grid(True, color=GRID_COLOR, linewidth=0.5, linestyle="--", alpha=0.7)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    ax.xaxis.set_major_locator(mdates.MonthLocator())
    plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha="right")


def main():
    parser = argparse.ArgumentParser(description="Plot account equity curve")
    parser.add_argument("--input", required=True, help="Path to net liq history JSON")
    parser.add_argument("--benchmark", help="Path to benchmark candle JSON")
    parser.add_argument("--benchmark-label", default="SPY", help="Benchmark label for legend")
    parser.add_argument("--drawdown", action="store_true", help="Add drawdown subplot")
    parser.add_argument("--period", help="Limit to last N days (e.g., 90d, 365d)")
    parser.add_argument("--output", help="Output PNG path")
    args = parser.parse_args()

    dates, values = load_netliq(args.input)
    if not dates:
        print("No net liq data found in input file.", file=sys.stderr)
        sys.exit(1)

    if args.period:
        dates, values = filter_period(dates, values, args.period)

    if len(dates) < 2:
        print("Not enough data points to plot.", file=sys.stderr)
        sys.exit(1)

    output = args.output or "/tmp/tt_chart_equity_curve.png"

    sharpe = compute_sharpe(values)
    dd = compute_drawdown(values)
    max_dd = float(np.min(dd))
    total_return = (values[-1] / values[0] - 1) * 100

    nrows = 2 if args.drawdown else 1
    height_ratios = [3, 1] if args.drawdown else [1]
    fig, axes = plt.subplots(nrows, 1, figsize=(14, 8 if args.drawdown else 5),
                              gridspec_kw={"height_ratios": height_ratios}, sharex=True)
    fig.patch.set_facecolor(DARK_BG)

    if nrows == 1:
        axes = [axes]
    else:
        axes = list(axes)

    # Panel 1: equity curve
    ax = axes[0]
    setup_dark_axes(ax)

    ax.plot(dates, values, color=EQUITY_COLOR, linewidth=2, label="Net Liq", zorder=5)
    ax.fill_between(dates, values, values[0], alpha=0.15, color=FILL_COLOR, zorder=3)

    # Benchmark overlay
    if args.benchmark:
        bdates, bcloses = load_benchmark(args.benchmark)
        if bdates:
            cutoff = dates[0]
            pairs = [(d, c) for d, c in zip(bdates, bcloses) if d >= cutoff]
            if pairs:
                bd, bc = zip(*pairs)
                bnorm = normalize(bc, values[0])
                ax.plot(list(bd), list(bnorm), color=BENCH_COLOR, linewidth=1.5,
                        linestyle="--", alpha=0.85, label=f"{args.benchmark_label} (normalized)")

    subtitle_parts = [f"Return: {total_return:+.1f}%", f"Max DD: {max_dd:.1f}%"]
    if sharpe is not None:
        subtitle_parts.append(f"Sharpe: {sharpe:.2f}")
    subtitle = "  |  ".join(subtitle_parts)

    ax.set_ylabel("Net Liq ($)", fontsize=11)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"${x:,.0f}"))
    ax.set_title(f"Account Equity Curve\n{subtitle}", fontsize=13, fontweight="bold")
    legend = ax.legend(facecolor="#161b22", edgecolor=GRID_COLOR, labelcolor=TEXT_COLOR)

    # Panel 2: drawdown
    if args.drawdown:
        ax2 = axes[1]
        setup_dark_axes(ax2)
        ax2.fill_between(dates, dd, 0, color=DRAWDOWN_COLOR, alpha=0.55)
        ax2.plot(dates, dd, color=DRAWDOWN_COLOR, linewidth=1)
        ax2.axhline(y=0, color=ZERO_COLOR, linewidth=0.8)
        ax2.set_ylabel("Drawdown (%)", fontsize=10)
        ax2.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.1f%%"))
        ax2.set_xlabel("Date", fontsize=11)
    else:
        axes[-1].set_xlabel("Date", fontsize=11)

    plt.tight_layout()
    plt.savefig(output, dpi=150, bbox_inches="tight", facecolor=DARK_BG)
    plt.close()
    print(f"Chart saved: {output}")
    sharpe_str = f"{sharpe:.2f}" if sharpe is not None else "N/A"
    print(f"Stats — Return: {total_return:+.1f}% | Max DD: {max_dd:.1f}% | Sharpe: {sharpe_str}")


if __name__ == "__main__":
    main()
