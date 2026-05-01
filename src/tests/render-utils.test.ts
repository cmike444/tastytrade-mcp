/**
 * Edge-case unit tests for all render-utils.ts renderers.
 *
 * Run with:
 *   npx tsx src/tests/render-utils.test.ts
 *
 * Each test asserts:
 *   - The renderer does not throw
 *   - The output is a non-empty string
 *   - The output contains the opening <!DOCTYPE html> tag (valid HTML wrapper)
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  renderQuote,
  renderGreeks,
  renderPositions,
  renderNetLiqHistory,
  renderMarketMetrics,
  renderBacktestResults,
  renderCandlestick,
} from "../tools/render-utils.js";

function assertValidHtml(html: string, label: string): void {
  assert.ok(typeof html === "string" && html.length > 0, `${label}: output is non-empty string`);
  assert.ok(html.includes("<!DOCTYPE html>"), `${label}: output contains <!DOCTYPE html>`);
}

// ── renderQuote ──────────────────────────────────────────────────────────────

test("renderQuote — empty array does not throw, returns valid HTML", () => {
  assertValidHtml(renderQuote([]), "renderQuote(empty)");
});

test("renderQuote — single quote with all fields", () => {
  const html = renderQuote([{
    eventSymbol: "AAPL",
    bidPrice: 182.5,
    askPrice: 182.55,
    lastPrice: 182.52,
    openPrice: 180.0,
    highPrice: 183.0,
    lowPrice: 179.5,
    closePrice: 181.0,
    dayVolume: 55_000_000,
  }]);
  assertValidHtml(html, "renderQuote(single full)");
  assert.ok(html.includes("AAPL"), "renderQuote: symbol is present");
});

test("renderQuote — null/missing optional fields do not throw", () => {
  assertValidHtml(renderQuote([{ eventSymbol: "XYZ" }]), "renderQuote(minimal)");
});

// ── renderGreeks ─────────────────────────────────────────────────────────────

test("renderGreeks — empty array does not throw, returns valid HTML", () => {
  assertValidHtml(renderGreeks([]), "renderGreeks(empty)");
});

test("renderGreeks — single entry with all Greeks", () => {
  const html = renderGreeks([{
    eventSymbol: ".AAPL240119C185",
    delta: 0.45,
    gamma: 0.02,
    theta: -0.08,
    vega: 0.15,
    rho: 0.03,
    volatility: 0.25,
    underlyingPrice: 182.5,
  }]);
  assertValidHtml(html, "renderGreeks(single full)");
  assert.ok(html.includes("Delta"), "renderGreeks: Delta label present");
});

test("renderGreeks — null volatility and underlyingPrice do not throw", () => {
  assertValidHtml(
    renderGreeks([{ eventSymbol: ".OPT", delta: null, gamma: null, theta: null, vega: null, rho: null }]),
    "renderGreeks(all null)"
  );
});

// ── renderPositions ──────────────────────────────────────────────────────────

test("renderPositions — empty positions list returns valid HTML", () => {
  const html = renderPositions([]);
  assertValidHtml(html, "renderPositions(empty)");
  assert.ok(html.includes("No positions"), "renderPositions(empty): shows empty message");
});

test("renderPositions — single long equity position", () => {
  const html = renderPositions([{
    symbol: "SPY",
    "instrument-type": "Equity",
    quantity: 100,
    "quantity-direction": "Long",
    "average-open-price": "450.00",
    "close-price": "455.00",
    "market-value": "45500.00",
    multiplier: 1,
  }]);
  assertValidHtml(html, "renderPositions(single)");
  assert.ok(html.includes("SPY"), "renderPositions: symbol present");
});

test("renderPositions — short position with missing market-value does not throw", () => {
  assertValidHtml(renderPositions([{
    symbol: "TSLA",
    "instrument-type": "Equity",
    quantity: 50,
    "quantity-direction": "Short",
    "average-open-price": "200",
    "close-price": "190",
  }]), "renderPositions(short no mv)");
});

// ── renderNetLiqHistory ──────────────────────────────────────────────────────

test("renderNetLiqHistory — empty array returns valid HTML", () => {
  const html = renderNetLiqHistory([]);
  assertValidHtml(html, "renderNetLiqHistory(empty)");
  assert.ok(html.includes("Insufficient data"), "renderNetLiqHistory(empty): shows insufficient data");
});

test("renderNetLiqHistory — single data point returns valid HTML (insufficient)", () => {
  const html = renderNetLiqHistory([{ time: "2024-01-01T00:00:00Z", open: 100000 }]);
  assertValidHtml(html, "renderNetLiqHistory(single)");
  assert.ok(html.includes("Insufficient data"), "renderNetLiqHistory(single): shows insufficient data");
});

test("renderNetLiqHistory — two data points renders chart", () => {
  const html = renderNetLiqHistory([
    { time: "2024-01-01T00:00:00Z", open: 100000 },
    { time: "2024-01-02T00:00:00Z", open: 105000 },
  ]);
  assertValidHtml(html, "renderNetLiqHistory(two points)");
});

// ── renderMarketMetrics ──────────────────────────────────────────────────────

test("renderMarketMetrics — empty array returns valid HTML", () => {
  assertValidHtml(renderMarketMetrics([]), "renderMarketMetrics(empty)");
});

test("renderMarketMetrics — null IV rank does not throw", () => {
  const html = renderMarketMetrics([{
    symbol: "SPY",
    "iv-rank": null,
    "iv-percentile": null,
  }]);
  assertValidHtml(html, "renderMarketMetrics(null iv-rank)");
  assert.ok(html.includes("SPY"), "renderMarketMetrics: symbol present");
});

test("renderMarketMetrics — high IV rank (>70) shows red gauge", () => {
  const html = renderMarketMetrics([{
    symbol: "VIX",
    "iv-rank": 0.85,
    "iv-percentile": 0.9,
    "implied-volatility-30-day": 0.4,
  }]);
  assertValidHtml(html, "renderMarketMetrics(high iv)");
  assert.ok(html.includes("#ef5350"), "renderMarketMetrics: high IV uses red color");
});

test("renderMarketMetrics — low IV rank (<40) shows green gauge", () => {
  const html = renderMarketMetrics([{
    symbol: "AAPL",
    "iv-rank": 0.20,
    "iv-percentile": 0.18,
  }]);
  assertValidHtml(html, "renderMarketMetrics(low iv)");
  assert.ok(html.includes("#26a69a"), "renderMarketMetrics: low IV uses green color");
});

// ── renderBacktestResults ────────────────────────────────────────────────────

test("renderBacktestResults — zero trials returns valid HTML", () => {
  const html = renderBacktestResults({
    status: "COMPLETE",
    statistics: { winRate: 0, averageProfitLoss: 0, totalProfitLoss: 0, maxDrawdown: 0, sharpeRatio: 0 },
    trials: [],
    snapshots: [],
  });
  assertValidHtml(html, "renderBacktestResults(zero trials)");
  assert.ok(html.includes("COMPLETE"), "renderBacktestResults: status present");
});

test("renderBacktestResults — single snapshot (no chart) returns valid HTML", () => {
  const html = renderBacktestResults({
    status: "COMPLETE",
    statistics: { winRate: 0.6, averageProfitLoss: 150, totalProfitLoss: 9000, maxDrawdown: -3000, sharpeRatio: 1.2 },
    trials: [{ openDateTime: "2024-01-02T09:30:00Z", closeDateTime: "2024-01-05T16:00:00Z", profitLoss: 200 }],
    snapshots: [{ dateTime: "2024-01-05T16:00:00Z", cumulativeProfitLoss: 200 }],
  });
  assertValidHtml(html, "renderBacktestResults(single snapshot)");
});

test("renderBacktestResults — null statistics fields do not throw", () => {
  assertValidHtml(renderBacktestResults({
    status: "IN_PROGRESS",
    statistics: {},
    trials: [],
    snapshots: [],
  }), "renderBacktestResults(null stats)");
});

// ── renderCandlestick ────────────────────────────────────────────────────────

test("renderCandlestick — empty candles returns valid HTML", () => {
  const html = renderCandlestick([], "AAPL");
  assertValidHtml(html, "renderCandlestick(empty)");
  assert.ok(html.includes("No candle data"), "renderCandlestick(empty): shows no data message");
});

test("renderCandlestick — single candle returns valid HTML", () => {
  const html = renderCandlestick([{
    time: Date.now(),
    open: 180, high: 185, low: 178, close: 183, volume: 1_000_000,
  }], "AAPL");
  assertValidHtml(html, "renderCandlestick(single)");
  assert.ok(html.includes("AAPL"), "renderCandlestick: symbol present");
});

test("renderCandlestick — multiple candles with bearish and bullish", () => {
  const now = Date.now();
  const candles = Array.from({ length: 10 }, (_, i) => ({
    time: now - (10 - i) * 5 * 60_000,
    open: 180 + i,
    high: 182 + i,
    low: 179 + i,
    close: i % 2 === 0 ? 181 + i : 179.5 + i,
    volume: 500_000 + i * 10_000,
  }));
  const html = renderCandlestick(candles, "/ES");
  assertValidHtml(html, "renderCandlestick(10 candles)");
  assert.ok(html.includes("svg"), "renderCandlestick: SVG element present");
});

test("renderCandlestick — missing volume/time fields do not throw", () => {
  assertValidHtml(
    renderCandlestick([{ open: 100, high: 105, low: 98, close: 102 }], "XYZ"),
    "renderCandlestick(no vol/time)"
  );
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log("\nAll render-utils tests completed.");
