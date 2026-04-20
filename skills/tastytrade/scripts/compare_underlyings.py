#!/usr/bin/env python3
"""
compare_underlyings.py — Side-by-side comparison of 2-4 underlyings.
Shows normalized price performance, IV comparison, and rolling correlation.

Usage:
  python3 compare_underlyings.py \
    --symbols SPY QQQ IWM \
    --candles /tmp/tt_candles_SPY.json /tmp/tt_candles_QQQ.json /tmp/tt_candles_IWM.json \
    --metrics /tmp/tt_metrics.json

  python3 compare_underlyings.py \
    --symbols SPY QQQ \
    --candles /tmp/tt_candles_SPY.json /tmp/tt_candles_QQQ.json \
    --show-iv --show-corr
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
COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#39d353"]


def load_candles(path):
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, dict) and "data" in data:
        data = data["data"]
    if isinstance(data, dict) and "candles" in data:
        data = data["candles"]

    dates, closes = [], []
    for c in data:
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
        return zip(*pairs)
    return [], []


def load_metrics(path):
    """Load market metrics for multiple symbols."""
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, dict) and "data" in data:
        data = data["data"]
    if isinstance(data, dict) and "items" in data:
        data = data["items"]

    result = {}
    items = data if isinstance(data, list) else [data]
    for item in items:
        symbol = item.get("symbol") or item.get("underlying-symbol") or ""
        if symbol:
            result[symbol] = {
                "iv": float(item.get("implied-volatility-index") or 0) * 100,
                "ivr": float(item.get("implied-volatility-index-rank") or 0),
                "ivp": float(item.get("implied-volatility-percentile") or 0),
            }
    return result


def normalize(values, start=100):
    arr = np.array(values, dtype=float)
    if len(arr) == 0 or arr[0] == 0:
        return arr
    return arr / arr[0] * start


def align_series(all_dates, all_values):
    """Align multiple date series to common dates."""
    if len(all_dates) == 0:
        return [], []

    # Find common date range
    start = max(d[0] for d in all_dates if d)
    end = min(d[-1] for d in all_dates if d)

    aligned = []
    common_dates = None
    for dates, values in zip(all_dates, all_values):
        pairs = {d.date(): v for d, v in zip(dates, values)}
        if common_dates is None:
            common_dates = sorted(k for k in pairs if start.date() <= k <= end.date())
        filtered = [pairs.get(d, float("nan")) for d in common_dates]
        aligned.append(filtered)

    return common_dates, aligned


def rolling_corr(a, b, window=20):
    """Compute rolling correlation between two series."""
    a, b = np.array(a, dtype=float), np.array(b, dtype=float)
    result = np.full(len(a), float("nan"))
    for i in range(window - 1, len(a)):
        chunk_a = a[i - window + 1: i + 1]
        chunk_b = b[i - window + 1: i + 1]
        valid = ~(np.isnan(chunk_a) | np.isnan(chunk_b))
        if valid.sum() >= 5:
            result[i] = np.corrcoef(chunk_a[valid], chunk_b[valid])[0, 1]
    return result


def setup_dark_style(fig, axes):
    fig.patch.set_facecolor(DARK_BG)
    ax_list = list(axes.flat) if hasattr(axes, "flat") else [axes]
    for ax in ax_list:
        ax.set_facecolor(DARK_BG)
        ax.tick_params(colors=TEXT_COLOR, labelsize=9)
        ax.xaxis.label.set_color(TEXT_COLOR)
        ax.yaxis.label.set_color(TEXT_COLOR)
        ax.title.set_color(TEXT_COLOR)
        for spine in ax.spines.values():
            spine.set_edgecolor(GRID_COLOR)
        ax.grid(True, color=GRID_COLOR, linewidth=0.5, linestyle="--", alpha=0.5)
        try:
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
            ax.xaxis.set_major_locator(mdates.MonthLocator())
            plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha="right")
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description="Compare multiple underlying assets")
    parser.add_argument("--symbols", nargs="+", required=True, help="Symbol names")
    parser.add_argument("--candles", nargs="+", required=True, help="Candle JSON file paths")
    parser.add_argument("--metrics", help="Market metrics JSON path")
    parser.add_argument("--period", default="90d", help="Lookback period (e.g., 90d)")
    parser.add_argument("--show-iv", action="store_true", help="Show IV comparison panel")
    parser.add_argument("--show-corr", action="store_true", help="Show rolling correlation panel")
    parser.add_argument("--output", help="Output PNG path")
    args = parser.parse_args()

    if len(args.symbols) != len(args.candles):
        parser.error("Number of --symbols must match --candles")

    # Load candle data
    all_dates, all_closes = [], []
    for path in args.candles:
        dates, closes = load_candles(path)
        all_dates.append(list(dates))
        all_closes.append(list(closes))

    # Apply period filter
    days = int(args.period.replace("d", ""))
    cutoff = datetime.now() - timedelta(days=days)
    filtered_dates, filtered_closes = [], []
    for dates, closes in zip(all_dates, all_closes):
        pairs = [(d, c) for d, c in zip(dates, closes) if d >= cutoff]
        if pairs:
            d, c = zip(*pairs)
            filtered_dates.append(list(d))
            filtered_closes.append(list(c))
        else:
            filtered_dates.append([])
            filtered_closes.append([])

    # Load metrics
    metrics = {}
    if args.metrics:
        metrics = load_metrics(args.metrics)

    # Build layout
    nrows = 1 + (1 if args.show_iv else 0) + (1 if args.show_corr else 0)
    height_ratios = [3] + [1.5] * (nrows - 1)
    fig, axes_arr = plt.subplots(nrows, 1, figsize=(14, 4 * nrows),
                                  gridspec_kw={"height_ratios": height_ratios}, sharex=(nrows > 1))
    if nrows == 1:
        axes_arr = [axes_arr]
    else:
        axes_arr = list(axes_arr)

    setup_dark_style(fig, axes_arr)
    ax_idx = 0

    # Panel 1: Normalized price performance
    ax = axes_arr[ax_idx]; ax_idx += 1
    for i, (sym, dates, closes) in enumerate(zip(args.symbols, filtered_dates, filtered_closes)):
        if not dates:
            continue
        norm = normalize(closes)
        from datetime import date as date_type
        plot_dates = [d if isinstance(d, datetime) else datetime.combine(d, datetime.min.time())
                      for d in dates]
        color = COLORS[i % len(COLORS)]
        ax.plot(plot_dates, norm, color=color, linewidth=2, label=sym)
        ax.text(plot_dates[-1], norm[-1], f" {sym}", color=color, fontsize=9, va="center")

    ax.axhline(y=100, color=GRID_COLOR, linewidth=0.8, linestyle="--", alpha=0.7)
    ax.set_ylabel("Normalized Price (base=100)", fontsize=10)
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.0f"))
    symbols_str = " vs ".join(args.symbols)
    ax.set_title(f"{symbols_str} — Relative Performance ({args.period})", fontsize=13, fontweight="bold")
    legend = ax.legend(facecolor="#161b22", edgecolor=GRID_COLOR, labelcolor=TEXT_COLOR)

    # Panel 2: IV comparison
    if args.show_iv and ax_idx < len(axes_arr):
        ax = axes_arr[ax_idx]; ax_idx += 1
        syms_with_iv = [(s, metrics.get(s, {})) for s in args.symbols if metrics.get(s)]
        if syms_with_iv:
            x = np.arange(len(syms_with_iv))
            width = 0.3
            iv_vals = [m.get("iv", 0) for _, m in syms_with_iv]
            ivr_vals = [m.get("ivr", 0) for _, m in syms_with_iv]
            labels_iv = [s for s, _ in syms_with_iv]

            bars1 = ax.bar(x - width / 2, iv_vals, width, label="IV %",
                           color=COLORS[:len(syms_with_iv)], alpha=0.8)
            ax2_twin = ax.twinx()
            ax2_twin.set_facecolor(DARK_BG)
            ax2_twin.tick_params(colors=TEXT_COLOR)
            ax2_twin.bar(x + width / 2, ivr_vals, width, label="IVR",
                         color=COLORS[:len(syms_with_iv)], alpha=0.4, hatch="//")
            ax2_twin.set_ylabel("IV Rank", color=TEXT_COLOR, fontsize=9)
            ax2_twin.set_ylim(0, 100)

            ax.set_xticks(x)
            ax.set_xticklabels(labels_iv)
            ax.set_ylabel("IV (%)", fontsize=10)
            ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.1f%%"))
            ax.set_title("Implied Volatility Comparison", fontsize=11, fontweight="bold")

            for bar, val in zip(bars1, iv_vals):
                ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.3,
                        f"{val:.1f}%", ha="center", va="bottom", color=TEXT_COLOR, fontsize=9)

    # Panel 3: Rolling correlation (first two symbols)
    if args.show_corr and len(args.symbols) >= 2 and ax_idx < len(axes_arr):
        ax = axes_arr[ax_idx]; ax_idx += 1
        sym_a, sym_b = args.symbols[0], args.symbols[1]

        if filtered_dates[0] and filtered_dates[1]:
            common_dates, aligned = align_series(filtered_dates[:2], filtered_closes[:2])
            if common_dates and len(aligned[0]) >= 20:
                ret_a = np.diff(np.log(np.array(aligned[0], dtype=float)))
                ret_b = np.diff(np.log(np.array(aligned[1], dtype=float)))
                corr = rolling_corr(ret_a, ret_b, window=20)
                plot_dates = [datetime.combine(d, datetime.min.time()) for d in common_dates[1:]]

                corr_colors = [COLORS[0] if c >= 0 else COLORS[3] for c in corr[~np.isnan(corr)]]

                ax.plot(plot_dates, corr, color=COLORS[0], linewidth=1.5, label=f"Corr({sym_a},{sym_b})")
                ax.fill_between(plot_dates, corr, 0, where=(corr >= 0),
                                color=COLORS[0], alpha=0.2)
                ax.fill_between(plot_dates, corr, 0, where=(corr < 0),
                                color=COLORS[3], alpha=0.2)
                ax.axhline(y=0, color=TEXT_COLOR, linewidth=0.8, alpha=0.5)
                ax.axhline(y=0.8, color=GRID_COLOR, linewidth=0.5, linestyle="--", alpha=0.5)
                ax.axhline(y=-0.5, color=GRID_COLOR, linewidth=0.5, linestyle="--", alpha=0.5)
                ax.set_ylim(-1, 1)
                ax.set_ylabel(f"20d Rolling Corr", fontsize=10)
                ax.set_title(f"Rolling Correlation: {sym_a} vs {sym_b}", fontsize=11, fontweight="bold")
                ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.2f"))

    output = args.output or f"/tmp/tt_chart_compare_{'_'.join(args.symbols)}.png"
    plt.tight_layout()
    plt.savefig(output, dpi=150, bbox_inches="tight", facecolor=DARK_BG)
    plt.close()
    print(f"Chart saved: {output}")


if __name__ == "__main__":
    main()
