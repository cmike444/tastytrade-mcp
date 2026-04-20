#!/usr/bin/env python3
"""
pnl_analytics.py — P&L breakdown by time period, underlying, and strategy type.
Input: tastytrade transactions JSON from get_transactions.

Usage:
  python3 pnl_analytics.py --input /tmp/tt_transactions.json
  python3 pnl_analytics.py --input /tmp/tt_transactions.json --period monthly
  python3 pnl_analytics.py --input /tmp/tt_transactions.json --by-underlying
  python3 pnl_analytics.py --input /tmp/tt_transactions.json --period dow --by-underlying
"""
import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime

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
NEUTRAL_COLOR = "#58a6ff"
ORANGE_COLOR = "#d29922"

DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def load_transactions(path):
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, dict) and "data" in data:
        data = data["data"]
    if isinstance(data, dict) and "items" in data:
        data = data["items"]
    return data if isinstance(data, list) else []


def extract_pnl(transactions):
    """
    Parse transactions into list of dicts with:
    date, pnl, underlying, instrument_type, description
    """
    records = []
    for tx in transactions:
        tx_type = tx.get("transaction-type") or tx.get("type") or ""
        # Only include trade-related transactions (fills, expirations, assignments)
        if tx_type not in ("Trade", "Receive Deliver", "Money Movement"):
            if "fill" not in tx_type.lower() and "expir" not in tx_type.lower():
                continue

        value = tx.get("net-value") or tx.get("value") or tx.get("net-amount") or 0
        try:
            pnl = float(value)
        except (ValueError, TypeError):
            continue

        dt_str = tx.get("executed-at") or tx.get("transaction-date") or tx.get("date")
        if not dt_str:
            continue
        try:
            dt = datetime.fromisoformat(str(dt_str).replace("Z", "+00:00"))
        except Exception:
            try:
                dt = datetime.strptime(str(dt_str)[:10], "%Y-%m-%d")
            except Exception:
                continue

        # Extract underlying symbol
        symbol = tx.get("underlying-symbol") or tx.get("symbol") or ""
        # Simplify futures symbols
        if symbol.startswith("/"):
            symbol = "/" + symbol[1:3]

        inst_type = tx.get("instrument-type") or ""

        records.append({
            "date": dt,
            "pnl": pnl,
            "underlying": symbol,
            "instrument_type": inst_type,
            "description": tx.get("description", ""),
        })

    return records


def group_by_period(records, period):
    """Group records by time period, return sorted dict of {label: total_pnl}."""
    groups = defaultdict(float)
    for r in records:
        dt = r["date"]
        if period == "dow":
            key = dt.weekday()  # 0=Mon
            label = DOW_LABELS[key] if key < 5 else None
        elif period == "weekly":
            label = f"{dt.isocalendar().year}-W{dt.isocalendar().week:02d}"
        elif period == "monthly":
            label = dt.strftime("%Y-%m")
        elif period == "quarterly":
            q = (dt.month - 1) // 3 + 1
            label = f"{dt.year} Q{q}"
        elif period == "yearly":
            label = str(dt.year)
        else:
            label = dt.strftime("%Y-%m")

        if label is not None:
            groups[label] += r["pnl"]

    if period == "dow":
        # Sort by weekday order
        ordered = {DOW_LABELS[i]: groups.get(DOW_LABELS[i], 0) for i in range(5)}
        return ordered
    return dict(sorted(groups.items()))


def group_by_underlying(records, top_n=15):
    groups = defaultdict(float)
    for r in records:
        groups[r["underlying"] or "Unknown"] += r["pnl"]
    sorted_groups = sorted(groups.items(), key=lambda x: abs(x[1]), reverse=True)
    return dict(sorted_groups[:top_n])


def group_by_instrument(records):
    groups = defaultdict(float)
    for r in records:
        groups[r["instrument_type"] or "Unknown"] += r["pnl"]
    return dict(sorted(groups.items(), key=lambda x: abs(x[1]), reverse=True))


def compute_stats(records):
    if not records:
        return {}
    pnls = [r["pnl"] for r in records]
    total = sum(pnls)
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    win_rate = len(wins) / len(pnls) * 100 if pnls else 0
    avg_win = np.mean(wins) if wins else 0
    avg_loss = np.mean(losses) if losses else 0
    profit_factor = abs(sum(wins) / sum(losses)) if losses else float("inf")

    # Cumulative P&L
    sorted_records = sorted(records, key=lambda r: r["date"])
    cumulative = np.cumsum([r["pnl"] for r in sorted_records])
    max_dd = 0
    peak = 0
    for v in cumulative:
        if v > peak:
            peak = v
        dd = v - peak
        if dd < max_dd:
            max_dd = dd

    return {
        "total": total,
        "n_trades": len(pnls),
        "win_rate": win_rate,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": profit_factor,
        "max_dd": max_dd,
        "sorted_records": sorted_records,
        "cumulative": cumulative,
    }


def bar_colors(values):
    return [PROFIT_COLOR if v >= 0 else LOSS_COLOR for v in values]


def setup_dark_style(fig, axes):
    fig.patch.set_facecolor(DARK_BG)
    for ax in (axes.flat if hasattr(axes, "flat") else [axes]):
        ax.set_facecolor(DARK_BG)
        ax.tick_params(colors=TEXT_COLOR, labelsize=9)
        ax.xaxis.label.set_color(TEXT_COLOR)
        ax.yaxis.label.set_color(TEXT_COLOR)
        ax.title.set_color(TEXT_COLOR)
        for spine in ax.spines.values():
            spine.set_edgecolor(GRID_COLOR)
        ax.grid(True, color=GRID_COLOR, linewidth=0.5, linestyle="--", alpha=0.5, axis="y")
        ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"${x:,.0f}"))


def main():
    parser = argparse.ArgumentParser(description="P&L analytics from tastytrade transactions")
    parser.add_argument("--input", required=True, help="Path to transactions JSON")
    parser.add_argument("--period", choices=["dow", "weekly", "monthly", "quarterly", "yearly"],
                        default="monthly", help="Time period grouping")
    parser.add_argument("--by-underlying", action="store_true", help="Add underlying breakdown")
    parser.add_argument("--by-strategy", action="store_true", help="Add instrument type breakdown")
    parser.add_argument("--output", help="Output PNG path")
    args = parser.parse_args()

    transactions = load_transactions(args.input)
    records = extract_pnl(transactions)

    if not records:
        print("No P&L records found in transaction data.", file=sys.stderr)
        sys.exit(1)

    stats = compute_stats(records)
    period_pnl = group_by_period(records, args.period)
    output = args.output or "/tmp/tt_chart_pnl_analytics.png"

    # Determine layout
    ncols = 2
    nrows = 2 + (1 if args.by_underlying else 0) + (1 if args.by_strategy else 0)
    nrows = min(nrows, 3)  # cap at 3 rows for readability
    fig, axes = plt.subplots(nrows, ncols, figsize=(16, 5 * nrows))

    setup_dark_style(fig, axes)
    axes_flat = list(axes.flat)
    ax_idx = 0

    # Panel 1: P&L by period
    ax = axes_flat[ax_idx]; ax_idx += 1
    labels = list(period_pnl.keys())
    values = list(period_pnl.values())
    colors = bar_colors(values)
    bars = ax.bar(range(len(labels)), values, color=colors, edgecolor=DARK_BG, linewidth=0.5)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)
    period_label = args.period.replace("dow", "Day of Week").replace("monthly", "Monthly").title()
    ax.set_title(f"P&L by {period_label}", fontsize=11, fontweight="bold")
    ax.axhline(y=0, color=TEXT_COLOR, linewidth=0.8, alpha=0.5)

    # Panel 2: Cumulative P&L
    ax = axes_flat[ax_idx]; ax_idx += 1
    sorted_records = stats["sorted_records"]
    cumulative = stats["cumulative"]
    cum_dates = [r["date"] for r in sorted_records]
    ax.plot(cum_dates, cumulative, color=NEUTRAL_COLOR, linewidth=2)
    ax.fill_between(cum_dates, cumulative, 0,
                    where=[v >= 0 for v in cumulative], color=PROFIT_COLOR, alpha=0.2)
    ax.fill_between(cum_dates, cumulative, 0,
                    where=[v < 0 for v in cumulative], color=LOSS_COLOR, alpha=0.2)
    ax.axhline(y=0, color=TEXT_COLOR, linewidth=0.8, alpha=0.5)
    ax.set_title("Cumulative P&L", fontsize=11, fontweight="bold")
    try:
        import matplotlib.dates as mdates
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
        ax.xaxis.set_major_locator(mdates.MonthLocator())
        plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha="right")
    except Exception:
        pass

    # Panel 3: P&L distribution histogram
    ax = axes_flat[ax_idx]; ax_idx += 1
    all_pnls = [r["pnl"] for r in records]
    n_bins = min(50, max(10, len(all_pnls) // 5))
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%d"))
    pos_pnls = [p for p in all_pnls if p >= 0]
    neg_pnls = [p for p in all_pnls if p < 0]
    if pos_pnls:
        ax.hist(pos_pnls, bins=n_bins // 2, color=PROFIT_COLOR, alpha=0.7, label="Wins")
    if neg_pnls:
        ax.hist(neg_pnls, bins=n_bins // 2, color=LOSS_COLOR, alpha=0.7, label="Losses")
    ax.axvline(x=0, color=TEXT_COLOR, linewidth=0.8, alpha=0.5)
    ax.set_title("P&L Distribution", fontsize=11, fontweight="bold")
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%d"))
    ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"${x:,.0f}"))
    legend = ax.legend(facecolor="#161b22", edgecolor=GRID_COLOR, labelcolor=TEXT_COLOR)

    # Panel 4: Underlying or DoW breakdown
    ax = axes_flat[ax_idx]; ax_idx += 1
    if args.by_underlying or True:  # always show underlying breakdown
        under_pnl = group_by_underlying(records)
        u_labels = list(under_pnl.keys())
        u_values = list(under_pnl.values())
        u_colors = bar_colors(u_values)
        ax.barh(range(len(u_labels)), u_values, color=u_colors, edgecolor=DARK_BG)
        ax.set_yticks(range(len(u_labels)))
        ax.set_yticklabels(u_labels, fontsize=9)
        ax.axvline(x=0, color=TEXT_COLOR, linewidth=0.8, alpha=0.5)
        ax.set_title("P&L by Underlying (Top 15)", fontsize=11, fontweight="bold")
        ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"${x:,.0f}"))
        ax.yaxis.set_major_formatter(mticker.NullFormatter())

    # Remaining panels for instrument type if requested
    if args.by_strategy and ax_idx < len(axes_flat):
        ax = axes_flat[ax_idx]; ax_idx += 1
        inst_pnl = group_by_instrument(records)
        i_labels = list(inst_pnl.keys())
        i_values = list(inst_pnl.values())
        ax.bar(range(len(i_labels)), i_values, color=bar_colors(i_values), edgecolor=DARK_BG)
        ax.set_xticks(range(len(i_labels)))
        ax.set_xticklabels(i_labels, rotation=30, ha="right", fontsize=9)
        ax.axhline(y=0, color=TEXT_COLOR, linewidth=0.8, alpha=0.5)
        ax.set_title("P&L by Instrument Type", fontsize=11, fontweight="bold")

    # Hide unused panels
    for i in range(ax_idx, len(axes_flat)):
        axes_flat[i].set_visible(False)

    # Overall title with stats
    total = stats["total"]
    wr = stats["win_rate"]
    pf = stats["profit_factor"]
    n = stats["n_trades"]
    suptitle = (f"P&L Analytics  |  Total: ${total:,.0f}  |  "
                f"Trades: {n}  |  Win Rate: {wr:.0f}%  |  Profit Factor: {pf:.2f}")
    fig.suptitle(suptitle, fontsize=12, fontweight="bold", color=TEXT_COLOR, y=1.01)

    plt.tight_layout()
    plt.savefig(output, dpi=150, bbox_inches="tight", facecolor=DARK_BG)
    plt.close()
    print(f"Chart saved: {output}")
    print(f"Stats: Total ${total:,.0f} | {n} trades | Win Rate {wr:.0f}% | Profit Factor {pf:.2f} | Max DD ${stats['max_dd']:,.0f}")


if __name__ == "__main__":
    main()
