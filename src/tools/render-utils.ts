const CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f1117;color:#e0e2ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.5;padding:16px}
  :root{--bg:#0f1117;--surface:#1a1d27;--border:#2a2d3a;--gain:#26a69a;--loss:#ef5350;--blue:#5c9eff;--muted:#8a8f9e;--r:8px;--shadow:0 2px 8px rgba(0,0,0,.4)}
  .cards{display:flex;flex-wrap:wrap;gap:12px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:16px;box-shadow:var(--shadow);min-width:220px;flex:1}
  .card-title{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
  .card-symbol{font-size:22px;font-weight:700;letter-spacing:-.02em;margin-bottom:10px}
  .price-row{display:flex;gap:20px;align-items:baseline;margin-bottom:8px}
  .price-big{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}
  .change{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
  .gain{color:var(--gain)}.loss{color:var(--loss)}.neutral{color:var(--blue)}
  .meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 12px;margin-top:8px}
  .meta-item{display:flex;flex-direction:column}
  .meta-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  .meta-value{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
  .greeks-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
  .greek-cell{background:#0f1117;border-radius:6px;padding:8px;display:flex;flex-direction:column;align-items:center}
  .greek-label{font-size:10px;color:var(--muted);margin-bottom:2px}
  .greek-value{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:13px}
  thead th{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);padding:6px 10px;text-align:right;border-bottom:1px solid var(--border)}
  thead th:first-child{text-align:left}
  tbody td{padding:7px 10px;text-align:right;border-bottom:1px solid rgba(255,255,255,.04)}
  tbody td:first-child{text-align:left}
  tbody tr:last-child td{border-bottom:none}
  .pnl-pos{color:var(--gain)}.pnl-neg{color:var(--loss)}
  .row-pos{background:rgba(38,166,154,.06)}.row-neg{background:rgba(239,83,80,.06)}
  .totals-row td{font-weight:700;border-top:1px solid var(--border);border-bottom:none}
  .stats-bar{display:flex;flex-wrap:wrap;gap:1px;background:var(--border);border-radius:var(--r);overflow:hidden;margin-bottom:16px}
  .stat-cell{background:var(--surface);flex:1;min-width:100px;padding:12px 16px;display:flex;flex-direction:column}
  .stat-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px}
  .stat-value{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
  .chart-wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:16px;margin-bottom:16px}
  .chart-header{display:flex;gap:24px;margin-bottom:12px}
  .chart-stat{display:flex;flex-direction:column}
  .chart-stat-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  .chart-stat-value{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
  svg text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
  .table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
  .table-header{padding:10px 16px;font-size:11px;color:var(--muted);border-bottom:1px solid var(--border)}
  .gauge-wrap{display:flex;flex-direction:column;align-items:center;margin:8px 0}
  .gauge-label{font-size:10px;color:var(--muted);margin-top:4px}
  .gauge-value{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px}
  .iv-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
`;

function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrap(body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>${body}</body></html>`;
}

function fmt(val: any, decimals = 2): string {
  if (val == null || val === "" || isNaN(Number(val))) return "—";
  return Number(val).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(val: any, decimals = 2): string {
  if (val == null || isNaN(Number(val))) return "—";
  return `${Number(val).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

function fmtDollar(val: any): string {
  if (val == null || isNaN(Number(val))) return "—";
  const n = Number(val);
  const prefix = n < 0 ? "-$" : "$";
  return `${prefix}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function changeClass(val: any): string {
  const n = Number(val);
  if (isNaN(n) || n === 0) return "neutral";
  return n > 0 ? "gain" : "loss";
}

function arrow(val: any): string {
  const n = Number(val);
  if (isNaN(n) || n === 0) return "";
  return n > 0 ? "▲ " : "▼ ";
}

function svgLineChart(
  values: number[],
  labels: string[],
  width = 700,
  height = 200,
  color = "#26a69a"
): string {
  if (values.length < 2) return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><text x="${width / 2}" y="${height / 2}" fill="#8a8f9e" text-anchor="middle" font-size="13">Insufficient data</text></svg>`;

  const padL = 70, padR = 16, padT = 12, padB = 36;
  const W = width - padL - padR;
  const H = height - padT - padB;

  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const xOf = (i: number) => padL + (i / (values.length - 1)) * W;
  const yOf = (v: number) => padT + H - ((v - minV) / range) * H;

  const pts = values.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ");
  const areaPath = `M ${xOf(0)},${yOf(values[0])} ` +
    values.slice(1).map((v, i) => `L ${xOf(i + 1)},${yOf(v)}`).join(" ") +
    ` L ${xOf(values.length - 1)},${padT + H} L ${xOf(0)},${padT + H} Z`;

  const gridLines = 4;
  const gridSvg = Array.from({ length: gridLines + 1 }, (_, k) => {
    const y = padT + (k / gridLines) * H;
    const v = maxV - (k / gridLines) * range;
    return `<line x1="${padL}" y1="${y}" x2="${padL + W}" y2="${y}" stroke="#2a2d3a" stroke-width="1"/>
<text x="${padL - 6}" y="${y + 4}" fill="#8a8f9e" font-size="10" text-anchor="end">${fmtDollar(v)}</text>`;
  }).join("\n");

  const xStep = Math.max(1, Math.floor(values.length / 6));
  const xLabelsSvg = labels
    .filter((_, i) => i % xStep === 0 || i === labels.length - 1)
    .map((lbl, idx, arr) => {
      const origIdx = idx === arr.length - 1 ? labels.length - 1 : idx * xStep;
      const x = xOf(origIdx);
      return `<text x="${x}" y="${padT + H + 18}" fill="#8a8f9e" font-size="10" text-anchor="middle">${lbl}</text>`;
    }).join("\n");

  return `<svg width="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
  <defs>
    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  ${gridSvg}
  <path d="${areaPath}" fill="url(#areaGrad)"/>
  <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  ${xLabelsSvg}
</svg>`;
}

function ivArcGauge(rank: number, size = 80): string {
  const pct = Math.max(0, Math.min(100, Number(rank) || 0));
  const r = 32;
  const cx = size / 2;
  const cy = size / 2 + 8;
  const startAngle = -200;
  const sweepTotal = 220;
  const sweepFill = (pct / 100) * sweepTotal;

  function polarToXY(angle: number): { x: number; y: number } {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(startDeg: number, sweepDeg: number): string {
    const start = polarToXY(startDeg);
    const end = polarToXY(startDeg + sweepDeg);
    const large = sweepDeg > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
  }

  const color = pct >= 70 ? "#ef5350" : pct >= 40 ? "#ffb300" : "#26a69a";

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <path d="${arcPath(startAngle, sweepTotal)}" fill="none" stroke="#2a2d3a" stroke-width="6" stroke-linecap="round"/>
  ${pct > 0 ? `<path d="${arcPath(startAngle, sweepFill)}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"/>` : ""}
  <text x="${cx}" y="${cy + 5}" fill="${color}" font-size="13" font-weight="700" text-anchor="middle" font-variant-numeric="tabular-nums">${Math.round(pct)}</text>
</svg>`;
}

export function renderQuote(quotes: any[]): string {
  const bySymbol = new Map<string, any>();
  for (const q of quotes) {
    const sym = q.eventSymbol ?? q.symbol;
    if (!bySymbol.has(sym)) bySymbol.set(sym, q);
    else Object.assign(bySymbol.get(sym)!, q);
  }

  const cards = [...bySymbol.values()].map(q => {
    const sym = q.eventSymbol ?? q.symbol ?? "?";
    const last = q.lastPrice ?? q.last;
    const bid = q.bidPrice ?? q.bid;
    const ask = q.askPrice ?? q.ask;
    const open = q.openPrice ?? q.open;
    const high = q.highPrice ?? q.high;
    const low = q.lowPrice ?? q.low;
    const close = q.closePrice ?? q.close ?? q.prevClose;
    const volume = q.dayVolume ?? q.volume;
    const chg = last != null && close != null ? Number(last) - Number(close) : null;
    const chgPct = chg != null && close != null && Number(close) !== 0 ? (chg / Number(close)) * 100 : null;
    const cls = changeClass(chg);

    return `<div class="card">
  <div class="card-title">Quote</div>
  <div class="card-symbol">${esc(sym)}</div>
  <div class="price-row">
    <span class="price-big">${fmt(last)}</span>
    ${chg != null ? `<span class="change ${cls}">${arrow(chg)}${fmt(Math.abs(chg))} (${fmtPct(chgPct)})</span>` : ""}
  </div>
  <div class="meta-grid">
    <div class="meta-item"><span class="meta-label">Bid</span><span class="meta-value">${fmt(bid)}</span></div>
    <div class="meta-item"><span class="meta-label">Ask</span><span class="meta-value">${fmt(ask)}</span></div>
    <div class="meta-item"><span class="meta-label">Open</span><span class="meta-value">${fmt(open)}</span></div>
    <div class="meta-item"><span class="meta-label">High</span><span class="meta-value">${fmt(high)}</span></div>
    <div class="meta-item"><span class="meta-label">Low</span><span class="meta-value">${fmt(low)}</span></div>
    <div class="meta-item"><span class="meta-label">Close</span><span class="meta-value">${fmt(close)}</span></div>
    <div class="meta-item"><span class="meta-label">Volume</span><span class="meta-value">${volume != null ? Number(volume).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</span></div>
  </div>
</div>`;
  }).join("\n");

  return wrap(`<div class="cards">${cards}</div>`);
}

export function renderGreeks(greeksList: any[]): string {
  const cards = greeksList.map(g => {
    const sym = g.eventSymbol ?? g.symbol ?? "?";
    const underlying = g.underlyingPrice ?? g.underlying;
    const iv = g.volatility ?? g.impliedVolatility ?? g.iv;
    const thetaClass = g.theta != null && Number(g.theta) < 0 ? "loss" : "neutral";

    return `<div class="card">
  <div class="card-title">Greeks</div>
  <div class="card-symbol" style="font-size:14px;word-break:break-all">${esc(sym)}</div>
  ${underlying != null ? `<div style="font-size:12px;color:var(--muted);margin-bottom:6px">Underlying: <span style="color:#e0e2ea;font-weight:600">${fmt(underlying)}</span></div>` : ""}
  <div class="greeks-grid">
    <div class="greek-cell"><span class="greek-label">Δ Delta</span><span class="greek-value">${fmt(g.delta, 4)}</span></div>
    <div class="greek-cell"><span class="greek-label">Γ Gamma</span><span class="greek-value">${fmt(g.gamma, 4)}</span></div>
    <div class="greek-cell"><span class="greek-label" style="color:#ef5350">Θ Theta</span><span class="greek-value ${thetaClass}">${fmt(g.theta, 4)}</span></div>
    <div class="greek-cell"><span class="greek-label">ν Vega</span><span class="greek-value">${fmt(g.vega, 4)}</span></div>
    <div class="greek-cell"><span class="greek-label">ρ Rho</span><span class="greek-value">${fmt(g.rho, 4)}</span></div>
    <div class="greek-cell"><span class="greek-label">IV</span><span class="greek-value">${iv != null ? fmtPct(Number(iv) * 100) : "—"}</span></div>
  </div>
</div>`;
  }).join("\n");

  return wrap(`<div class="cards">${cards}</div>`);
}

export function renderPositions(positions: any[]): string {
  if (positions.length === 0) {
    return wrap(`<div class="card"><div class="card-title">Positions</div><p style="color:var(--muted);margin-top:8px">No positions found.</p></div>`);
  }

  let totalMv = 0, totalPnl = 0;

  const rows = positions.map(p => {
    const sym = p.symbol ?? "?";
    const type = p["instrument-type"] ?? p.instrumentType ?? "";
    const qty = p.quantity ?? p.qty ?? 0;
    const dir = (p["quantity-direction"] ?? p.quantityDirection ?? "") as string;
    const avgOpen = p["average-open-price"] ?? p.averageOpenPrice;
    const closePrice = p["close-price"] ?? p.closePrice;
    const mv = p["market-value"] ?? p.marketValue;
    const multiplier = p.multiplier ?? 1;
    const isShort = dir.toLowerCase() === "short";

    let pnl: number | null = null;
    if (avgOpen != null && closePrice != null && qty != null) {
      const rawPnl = (Number(closePrice) - Number(avgOpen)) * Number(qty) * Number(multiplier);
      pnl = isShort ? -rawPnl : rawPnl;
    }

    if (mv != null) totalMv += Number(mv);
    if (pnl != null) totalPnl += pnl;

    const pnlClass = pnl == null ? "" : pnl >= 0 ? "pnl-pos" : "pnl-neg";
    const rowClass = pnl == null ? "" : pnl >= 0 ? "row-pos" : "row-neg";

    return `<tr class="${rowClass}">
  <td><strong>${esc(sym)}</strong></td>
  <td style="text-align:left">${esc(type)}</td>
  <td>${esc(qty)}${dir ? ` <span style="color:var(--muted)">${esc(dir)}</span>` : ""}</td>
  <td>${fmt(avgOpen)}</td>
  <td>${fmt(closePrice)}</td>
  <td>${mv != null ? fmtDollar(mv) : "—"}</td>
  <td class="${pnlClass}">${pnl != null ? fmtDollar(pnl) : "—"}</td>
</tr>`;
  }).join("\n");

  const totalPnlClass = totalPnl >= 0 ? "pnl-pos" : "pnl-neg";

  return wrap(`<div class="table-wrap">
  <div class="table-header">Positions &mdash; ${positions.length} position${positions.length !== 1 ? "s" : ""}</div>
  <div style="overflow-x:auto;padding:0 0 4px">
    <table>
      <thead><tr>
        <th style="text-align:left">Symbol</th>
        <th style="text-align:left">Type</th>
        <th>Qty</th>
        <th>Avg Open</th>
        <th>Price</th>
        <th>Mkt Value</th>
        <th>Unr. P&amp;L</th>
      </tr></thead>
      <tbody>
        ${rows}
        <tr class="totals-row">
          <td colspan="5"><strong>Total</strong></td>
          <td>${fmtDollar(totalMv)}</td>
          <td class="${totalPnlClass}">${fmtDollar(totalPnl)}</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>`);
}

export function renderNetLiqHistory(snapshots: any[]): string {
  const items = snapshots
    .map(s => ({
      date: s["time"] ?? s.time ?? s.date ?? s.dateTime ?? "",
      value: Number(s["open"] ?? s.netLiquidatingValue ?? s.value ?? s.close ?? 0),
    }))
    .filter(s => s.date !== "");

  if (items.length < 2) {
    return wrap(`<div class="card"><div class="card-title">Net Liq History</div><p style="color:var(--muted);margin-top:8px">Insufficient data to render chart.</p></div>`);
  }

  const values = items.map(s => s.value);
  const labels = items.map(s => {
    const d = new Date(typeof s.date === "number" ? s.date : s.date);
    return isNaN(d.getTime()) ? String(s.date).slice(0, 10) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });

  const startVal = values[0];
  const endVal = values[values.length - 1];
  const chg = endVal - startVal;
  const chgPct = startVal !== 0 ? (chg / Math.abs(startVal)) * 100 : 0;
  const color = chg >= 0 ? "#26a69a" : "#ef5350";
  const cls = chg >= 0 ? "gain" : "loss";

  return wrap(`<div class="chart-wrap">
  <div class="chart-header">
    <div class="chart-stat"><span class="chart-stat-label">Start</span><span class="chart-stat-value">${fmtDollar(startVal)}</span></div>
    <div class="chart-stat"><span class="chart-stat-label">End</span><span class="chart-stat-value">${fmtDollar(endVal)}</span></div>
    <div class="chart-stat"><span class="chart-stat-label">Change</span><span class="chart-stat-value ${cls}">${arrow(chg)}${fmtDollar(Math.abs(chg))} (${fmtPct(Math.abs(chgPct))})</span></div>
  </div>
  ${svgLineChart(values, labels, 700, 220, color)}
</div>`);
}

export function renderMarketMetrics(metrics: any[]): string {
  const cards = metrics.map(m => {
    const sym = m.symbol ?? "?";
    const ivRank = m["iv-rank"] ?? m.ivRank ?? m["implied-volatility-index-rank"];
    const ivPct = m["iv-percentile"] ?? m.ivPercentile ?? m["implied-volatility-percentile"];
    const iv30 = m["implied-volatility-30-day"] ?? m["implied-volatility-index"];
    const hv30 = m["historical-volatility-30-day"] ?? m["hv-30"];

    const rankNum = Number(ivRank) * 100;

    return `<div class="card" style="min-width:200px;max-width:280px">
  <div class="card-title">Market Metrics</div>
  <div class="card-symbol">${esc(sym)}</div>
  <div class="gauge-wrap">
    ${ivArcGauge(rankNum)}
    <div class="gauge-label">IV Rank</div>
    <div class="gauge-value">${ivRank != null ? fmtPct(rankNum) : "—"}</div>
  </div>
  <div class="iv-row">
    <div class="meta-item"><span class="meta-label">IV Percentile</span><span class="meta-value">${ivPct != null ? fmtPct(Number(ivPct) * 100) : "—"}</span></div>
    <div class="meta-item"><span class="meta-label">IV 30-Day</span><span class="meta-value">${iv30 != null ? fmtPct(Number(iv30) * 100) : "—"}</span></div>
    ${hv30 != null ? `<div class="meta-item"><span class="meta-label">HV 30-Day</span><span class="meta-value">${fmtPct(Number(hv30) * 100)}</span></div>` : ""}
  </div>
</div>`;
  }).join("\n");

  return wrap(`<div class="cards">${cards}</div>`);
}

export function renderBacktestResults(result: {
  status: string;
  statistics: Record<string, any>;
  trials: Array<{ openDateTime: string; closeDateTime: string; profitLoss: number }>;
  snapshots: Array<{ dateTime: string; cumulativeProfitLoss: number }>;
}): string {
  const { status, statistics, trials, snapshots } = result;

  const winRate = statistics.winRate != null ? fmtPct(Number(statistics.winRate) * 100) : "—";
  const avgPnL = statistics.averageProfitLoss != null ? fmtDollar(statistics.averageProfitLoss) : "—";
  const totalPnL = statistics.totalProfitLoss != null ? fmtDollar(statistics.totalProfitLoss) : "—";
  const maxDD = statistics.maxDrawdown != null ? fmtDollar(statistics.maxDrawdown) : "—";
  const sharpe = statistics.sharpeRatio != null ? fmt(statistics.sharpeRatio, 2) : "—";
  const totalTrades = statistics.totalTrades != null ? String(statistics.totalTrades) : String(trials.length);

  const totalPnlNum = statistics.totalProfitLoss ?? 0;
  const totalPnlClass = Number(totalPnlNum) >= 0 ? "gain" : "loss";
  const avgPnlClass = Number(statistics.averageProfitLoss ?? 0) >= 0 ? "gain" : "loss";

  const statsBar = `<div class="stats-bar">
  <div class="stat-cell"><span class="stat-label">Total Trades</span><span class="stat-value">${totalTrades}</span></div>
  <div class="stat-cell"><span class="stat-label">Win Rate</span><span class="stat-value">${winRate}</span></div>
  <div class="stat-cell"><span class="stat-label">Avg P&amp;L</span><span class="stat-value ${avgPnlClass}">${avgPnL}</span></div>
  <div class="stat-cell"><span class="stat-label">Total P&amp;L</span><span class="stat-value ${totalPnlClass}">${totalPnL}</span></div>
  <div class="stat-cell"><span class="stat-label">Max Drawdown</span><span class="stat-value loss">${maxDD}</span></div>
  <div class="stat-cell"><span class="stat-label">Sharpe Ratio</span><span class="stat-value">${sharpe}</span></div>
</div>`;

  let chartHtml = "";
  if (snapshots.length >= 2) {
    const values = snapshots.map(s => s.cumulativeProfitLoss);
    const labels = snapshots.map(s => {
      const d = new Date(s.dateTime);
      return isNaN(d.getTime()) ? s.dateTime.slice(0, 10) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });
    const lastVal = values[values.length - 1];
    const color = lastVal >= 0 ? "#26a69a" : "#ef5350";
    chartHtml = `<div class="chart-wrap">${svgLineChart(values, labels, 700, 220, color)}</div>`;
  }

  const PAGE = 50;
  const displayTrials = trials.slice(0, PAGE);
  const trialRows = displayTrials.map(t => {
    const pnl = t.profitLoss;
    const pnlClass = pnl >= 0 ? "pnl-pos" : "pnl-neg";
    const rowClass = pnl >= 0 ? "row-pos" : "row-neg";
    const openDate = t.openDateTime ? new Date(t.openDateTime).toLocaleDateString("en-US", { year: "2-digit", month: "short", day: "numeric" }) : "—";
    const closeDate = t.closeDateTime ? new Date(t.closeDateTime).toLocaleDateString("en-US", { year: "2-digit", month: "short", day: "numeric" }) : "—";
    return `<tr class="${rowClass}"><td>${openDate}</td><td>${closeDate}</td><td class="${pnlClass}">${fmtDollar(pnl)}</td></tr>`;
  }).join("\n");

  const tableHtml = trials.length > 0 ? `<div class="table-wrap">
  <div class="table-header">Trials — showing ${displayTrials.length} of ${trials.length} &mdash; Status: ${esc(status)}</div>
  <div style="overflow-x:auto;max-height:400px;overflow-y:auto">
    <table>
      <thead><tr><th style="text-align:left">Open</th><th style="text-align:left">Close</th><th>P&amp;L</th></tr></thead>
      <tbody>${trialRows}</tbody>
    </table>
  </div>
</div>` : `<div class="card" style="color:var(--muted)">Status: ${esc(status)} — no trials yet.</div>`;

  return wrap(statsBar + chartHtml + tableHtml);
}

export function extractItems(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data?.data?.items) return data.data.items;
  if (data?.items) return data.items;
  if (data != null && typeof data === "object") return [data];
  return [];
}
