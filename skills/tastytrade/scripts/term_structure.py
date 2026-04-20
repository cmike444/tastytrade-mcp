#!/usr/bin/env python3
"""
term_structure.py — IV term structure and forward volatility visualization.
Plots ATM IV across expiry dates and computes forward volatility between adjacent expirations.

Usage:
  python3 term_structure.py --input /tmp/tt_term_SPY.json --symbol SPY
  python3 term_structure.py --input /tmp/tt_term_SPY.json --show-forward-vol --highlight-ff 1.2
  python3 term_structure.py --input /tmp/tt_surface_SPY.json --mode surface --symbol SPY

Input format (from filter_chain.py --mode term):
  [{"expiry": "2024-01-19", "dte": 14, "atm_iv": 18.5}, ...]
"""
import argparse
import json
import math
import sys

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
IV_COLOR = "#58a6ff"
FORWARD_COLOR = "#d29922"
BACKWARDATION_COLOR = "#f85149"
CONTANGO_COLOR = "#3fb950"
FF_ALERT_COLOR = "#ff7b72"
NEUTRAL_COLOR = "#8b949e"


def compute_forward_vol(iv1, t1, iv2, t2):
    """
    Compute forward implied volatility from t1 to t2.
    IVs should be in decimal (e.g., 0.185 for 18.5%).
    t1, t2 in years.
    """
    if t2 <= t1 or t1 <= 0 or iv1 <= 0 or iv2 <= 0:
        return None
    var_total = (iv2 ** 2) * t2
    var_near = (iv1 ** 2) * t1
    var_forward = var_total - var_near
    if var_forward <= 0:
        return None
    return math.sqrt(var_forward / (t2 - t1))


def compute_forward_factor(forward_vol, back_iv):
    """Forward Factor = Forward IV / Back-month IV. >= 1.2 = calendar signal."""
    if back_iv <= 0:
        return None
    return forward_vol / back_iv


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
        ax.grid(True, color=GRID_COLOR, linewidth=0.5, linestyle="--", alpha=0.6)


def mode_term_structure(data, symbol, show_forward, highlight_ff, output):
    """Standard term structure plot: IV vs DTE with optional forward vol overlay."""
    # Sort by DTE
    data = sorted(data, key=lambda x: x["dte"])
    dtes = np.array([d["dte"] for d in data])
    ivs = np.array([d["atm_iv"] for d in data])

    # Compute forward vols
    forward_vols = []
    forward_dtes = []
    forward_factors = []
    for i in range(1, len(data)):
        t1 = data[i - 1]["dte"] / 365
        t2 = data[i]["dte"] / 365
        iv1 = data[i - 1]["atm_iv"] / 100
        iv2 = data[i]["atm_iv"] / 100
        fv = compute_forward_vol(iv1, t1, iv2, t2)
        if fv:
            mid_dte = (data[i - 1]["dte"] + data[i]["dte"]) / 2
            ff = compute_forward_factor(fv, iv2)
            forward_vols.append(fv * 100)
            forward_dtes.append(mid_dte)
            forward_factors.append((mid_dte, fv * 100, ff, data[i - 1]["expiry"], data[i]["expiry"]))

    nrows = 2 if show_forward else 1
    height_ratios = [3, 1.5] if show_forward else [1]
    fig, axes = plt.subplots(nrows, 1, figsize=(12, 5 * nrows),
                              gridspec_kw={"height_ratios": height_ratios})
    if nrows == 1:
        axes = [axes]

    setup_dark_style(fig, axes)

    # Panel 1: IV term structure
    ax = axes[0]

    # Color segments by contango/backwardation
    for i in range(1, len(dtes)):
        seg_color = BACKWARDATION_COLOR if ivs[i] < ivs[i - 1] else CONTANGO_COLOR
        ax.plot([dtes[i - 1], dtes[i]], [ivs[i - 1], ivs[i]],
                color=seg_color, linewidth=2.5, zorder=5)

    ax.scatter(dtes, ivs, color=IV_COLOR, zorder=6, s=60)

    # Label each expiry
    for d in data:
        ax.annotate(d["expiry"][5:],  # MM-DD
                    xy=(d["dte"], d["atm_iv"]),
                    xytext=(0, 12), textcoords="offset points",
                    ha="center", color=TEXT_COLOR, fontsize=7, alpha=0.8)

    # Highlight FF alerts
    if highlight_ff and forward_factors:
        for mid_dte, fv_pct, ff, exp1, exp2 in forward_factors:
            if ff and ff >= highlight_ff:
                ax.axvspan(data[next(i for i, d in enumerate(data) if d["expiry"] == exp1)]["dte"],
                           data[next(i for i, d in enumerate(data) if d["expiry"] == exp2)]["dte"],
                           alpha=0.1, color=FF_ALERT_COLOR)

    ax.set_xlabel("Days to Expiration (DTE)", fontsize=11)
    ax.set_ylabel("ATM Implied Volatility (%)", fontsize=11)
    ax.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.1f%%"))

    # Determine shape
    if len(ivs) >= 2:
        if ivs[0] > ivs[-1] * 1.05:
            shape = "Backwardation (inverted) — near-term fear elevated"
            shape_color = BACKWARDATION_COLOR
        elif ivs[-1] > ivs[0] * 1.05:
            shape = "Contango (normal) — vol increases with time"
            shape_color = CONTANGO_COLOR
        else:
            shape = "Flat term structure"
            shape_color = NEUTRAL_COLOR
        ax.text(0.98, 0.04, shape, transform=ax.transAxes, color=shape_color,
                fontsize=9, ha="right", va="bottom", style="italic")

    ax.set_title(f"{symbol} — IV Term Structure", fontsize=13, fontweight="bold")

    # Legend patches
    from matplotlib.patches import Patch
    legend_elements = [
        Patch(facecolor=CONTANGO_COLOR, label="Contango"),
        Patch(facecolor=BACKWARDATION_COLOR, label="Backwardation"),
    ]
    if highlight_ff:
        legend_elements.append(Patch(facecolor=FF_ALERT_COLOR, alpha=0.3, label=f"FF ≥ {highlight_ff} (calendar signal)"))
    ax.legend(handles=legend_elements, facecolor="#161b22", edgecolor=GRID_COLOR, labelcolor=TEXT_COLOR)

    # Panel 2: Forward vols and Forward Factors
    if show_forward and len(axes) > 1:
        ax2 = axes[1]
        if forward_factors:
            fv_dtes = [x[0] for x in forward_factors]
            fv_vals = [x[1] for x in forward_factors]
            ffs = [x[2] or 0 for x in forward_factors]

            ax2.bar(fv_dtes, fv_vals, width=10, color=FORWARD_COLOR, alpha=0.7, label="Forward IV")
            ax2.set_ylabel("Forward IV (%)", fontsize=10, color=FORWARD_COLOR)
            ax2.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.1f%%"))

            ax3 = ax2.twinx()
            ax3.set_facecolor(DARK_BG)
            ax3.tick_params(colors=TEXT_COLOR)
            ax3.plot(fv_dtes, ffs, color=FF_ALERT_COLOR, linewidth=2, marker="o", label="Forward Factor")
            if highlight_ff:
                ax3.axhline(y=highlight_ff, color=FF_ALERT_COLOR, linewidth=1, linestyle="--",
                            alpha=0.7, label=f"FF threshold {highlight_ff}")
            ax3.set_ylabel("Forward Factor", color=FF_ALERT_COLOR, fontsize=10)
            ax3.axhline(y=1.0, color=NEUTRAL_COLOR, linewidth=0.8, linestyle="--", alpha=0.5)

            for i, (dte, ff) in enumerate(zip(fv_dtes, ffs)):
                color = FF_ALERT_COLOR if ff >= (highlight_ff or 1.2) else TEXT_COLOR
                ax3.annotate(f"FF={ff:.2f}", xy=(dte, ff), xytext=(0, 10),
                             textcoords="offset points", ha="center",
                             color=color, fontsize=8)

            ax2.set_xlabel("Mid-DTE", fontsize=10)
            ax2.set_title("Forward Volatility & Forward Factor", fontsize=11, fontweight="bold")

    plt.tight_layout()
    plt.savefig(output, dpi=150, bbox_inches="tight", facecolor=DARK_BG)
    plt.close()
    print(f"Chart saved: {output}")

    # Print summary
    print(f"\nTerm Structure Summary: {symbol}")
    print(f"{'Expiry':>12} {'DTE':>5} {'ATM IV':>8}")
    print("─" * 30)
    for d in data:
        print(f"{d['expiry']:>12} {d['dte']:>5} {d['atm_iv']:>7.1f}%")

    if forward_factors:
        print(f"\nForward Factors:")
        for mid_dte, fv_pct, ff, exp1, exp2 in forward_factors:
            ff_label = " ⚠ CALENDAR SIGNAL" if ff and ff >= (highlight_ff or 1.2) else ""
            print(f"  {exp1} → {exp2}: Fwd IV={fv_pct:.1f}%, FF={ff:.2f}{ff_label}")


def mode_surface(data, symbol, output):
    """3D IV surface plot: strike × expiry × IV."""
    if not data:
        print("No surface data.", file=sys.stderr)
        sys.exit(1)

    expiries = sorted(set(d["expiry"] for d in data))
    strikes = sorted(set(d["strike"] for d in data))

    # Build matrix
    iv_matrix = np.full((len(expiries), len(strikes)), float("nan"))
    exp_idx = {e: i for i, e in enumerate(expiries)}
    str_idx = {s: i for i, s in enumerate(strikes)}
    for d in data:
        i = exp_idx[d["expiry"]]
        j = str_idx[d["strike"]]
        iv = d.get("call_iv") or d.get("put_iv") or 0
        iv_matrix[i, j] = iv

    # Use DTE as y-axis instead of date strings
    from datetime import date
    today = date.today()
    dtes = []
    for e in expiries:
        try:
            dtes.append((date.fromisoformat(e) - today).days)
        except Exception:
            dtes.append(0)

    X, Y = np.meshgrid(strikes, dtes)

    try:
        from mpl_toolkits.mplot3d import Axes3D
        fig = plt.figure(figsize=(14, 8))
        fig.patch.set_facecolor(DARK_BG)
        ax = fig.add_subplot(111, projection="3d")
        ax.set_facecolor(DARK_BG)
        ax.tick_params(colors=TEXT_COLOR, labelsize=8)

        surf = ax.plot_surface(X, Y, iv_matrix, cmap="RdYlGn_r", alpha=0.85,
                               linewidth=0, antialiased=True)

        ax.set_xlabel("Strike", color=TEXT_COLOR, fontsize=10)
        ax.set_ylabel("DTE", color=TEXT_COLOR, fontsize=10)
        ax.set_zlabel("IV (%)", color=TEXT_COLOR, fontsize=10)
        ax.set_title(f"{symbol} — IV Surface", color=TEXT_COLOR, fontsize=13, fontweight="bold")

        cbar = fig.colorbar(surf, ax=ax, shrink=0.5, aspect=10, pad=0.1)
        cbar.ax.tick_params(colors=TEXT_COLOR)
        cbar.set_label("IV (%)", color=TEXT_COLOR)

        ax.xaxis.pane.fill = False
        ax.yaxis.pane.fill = False
        ax.zaxis.pane.fill = False
        ax.xaxis.pane.set_edgecolor(GRID_COLOR)
        ax.yaxis.pane.set_edgecolor(GRID_COLOR)
        ax.zaxis.pane.set_edgecolor(GRID_COLOR)

    except ImportError:
        # Fallback: heatmap
        fig, ax = plt.subplots(figsize=(14, 8))
        fig.patch.set_facecolor(DARK_BG)
        ax.set_facecolor(DARK_BG)
        im = ax.imshow(iv_matrix, aspect="auto", cmap="RdYlGn_r", origin="lower")
        ax.set_xticks(range(0, len(strikes), max(1, len(strikes) // 10)))
        ax.set_xticklabels([f"{strikes[i]:.0f}" for i in range(0, len(strikes), max(1, len(strikes) // 10))],
                           color=TEXT_COLOR, rotation=45)
        ax.set_yticks(range(len(dtes)))
        ax.set_yticklabels([f"{d}d" for d in dtes], color=TEXT_COLOR, fontsize=8)
        ax.set_xlabel("Strike", color=TEXT_COLOR, fontsize=11)
        ax.set_ylabel("DTE", color=TEXT_COLOR, fontsize=11)
        ax.set_title(f"{symbol} — IV Surface (Heatmap)", color=TEXT_COLOR, fontsize=13, fontweight="bold")
        cbar = fig.colorbar(im, ax=ax)
        cbar.set_label("IV (%)", color=TEXT_COLOR)
        cbar.ax.tick_params(colors=TEXT_COLOR)

    plt.tight_layout()
    plt.savefig(output, dpi=150, bbox_inches="tight", facecolor=DARK_BG)
    plt.close()
    print(f"Chart saved: {output}")


def main():
    parser = argparse.ArgumentParser(description="IV term structure and forward volatility")
    parser.add_argument("--input", required=True, help="Path to term structure JSON (from filter_chain.py)")
    parser.add_argument("--symbol", default="", help="Symbol name for title")
    parser.add_argument("--mode", choices=["term", "surface"], default="term")
    parser.add_argument("--show-forward-vol", action="store_true", help="Show forward vol subplot")
    parser.add_argument("--highlight-ff", type=float, default=None,
                        help="Highlight calendar zones where FF >= threshold (default: 1.2)")
    parser.add_argument("--output", help="Output PNG path")
    args = parser.parse_args()

    with open(args.input) as f:
        data = json.load(f)

    symbol = args.symbol or ""
    output = args.output or f"/tmp/tt_chart_term_structure_{symbol or 'unknown'}.png"
    highlight_ff = args.highlight_ff if args.highlight_ff is not None else (1.2 if args.show_forward_vol else None)

    if args.mode == "surface":
        mode_surface(data, symbol, output)
    else:
        mode_term_structure(data, symbol, args.show_forward_vol, highlight_ff, output)


if __name__ == "__main__":
    main()
