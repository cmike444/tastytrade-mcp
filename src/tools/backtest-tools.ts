import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient, requireSessionToken, registerCandleSubscription, unregisterCandleSubscription } from "../tastytrade-client.js";
import { formatApiError } from "./error-utils.js";

const BACKTEST_BASE_URL = "https://backtester.vast.tastyworks.com";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const SIDE_EFFECT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

async function backtestFetch(path: string, options: RequestInit = {}): Promise<any> {
  const token = await requireSessionToken();
  const url = `${BACKTEST_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401) {
    throw new Error("Session token rejected by backtesting API — try re-authenticating.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`HTTP ${res.status}: ${body}`), {
      response: { status: res.status, data: body, config: { url } },
    });
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

const StrikeSelectionSchema = z.discriminatedUnion("strikeSelection", [
  z.object({
    strikeSelection: z.literal("delta"),
    delta: z.number().min(1).max(100).describe("Delta value (1–100)"),
  }),
  z.object({
    strikeSelection: z.literal("percentageOTM"),
    percentageOTM: z.number().describe("Percentage OTM (e.g. 0.10 = 10%)"),
  }),
  z.object({
    strikeSelection: z.literal("percentageOTMRelative"),
    percentageOTMRelative: z.number().describe("Relative percentage OTM (negative = put side, positive = call side)"),
    strikeRelativeLeg: z.number().int().describe("Zero-indexed reference leg index"),
  }),
  z.object({
    strikeSelection: z.literal("currentPriceOffset"),
    currentPriceOffset: z.number().describe("Dollar offset from current price"),
  }),
  z.object({
    strikeSelection: z.literal("currentPriceOffsetRelative"),
    currentPriceOffsetRelative: z.number().describe("Dollar offset relative to another leg"),
    strikeRelativeLeg: z.number().int().describe("Zero-indexed reference leg index"),
  }),
  z.object({
    strikeSelection: z.literal("currentPriceExactOffsetRelative"),
    currentPriceExactOffsetRelative: z.number().describe("Exact offset relative to another leg (0 = same strike)"),
    strikeRelativeLeg: z.number().int().describe("Zero-indexed reference leg index"),
  }),
  z.object({
    strikeSelection: z.literal("premium"),
    premium: z.number().describe("Target credit in dollars"),
  }),
]);

const BacktestLegSchema = z.intersection(
  z.object({
    type: z.literal("equity-option").describe("Instrument type"),
    direction: z.enum(["long", "short"]).describe("Long or short"),
    side: z.enum(["call", "put"]).describe("Call or put"),
    quantity: z.number().int().min(1).max(10).describe("Number of contracts (1–10)"),
    daysUntilExpiration: z.number().int().describe("Days until expiration at entry"),
  }),
  StrikeSelectionSchema
);

const EntryConditionsSchema = z.object({
  frequency: z.enum(["every day", "on specific days of the week", "on exact days to expiration match"]).describe("How often to enter"),
  specificDays: z.array(z.number()).optional().describe("Specific days (e.g. day-of-week indices or DTE values)"),
  maximumActiveTrials: z.number().optional().describe("Maximum concurrent open trials"),
  maximumActiveTrialsBehavior: z.enum(["don't enter", "close oldest"]).optional().describe("Behavior when max active trials is reached"),
  minimumVIX: z.number().optional().describe("Minimum VIX level for entry"),
  maximumVIX: z.number().optional().describe("Maximum VIX level for entry"),
});

const ExitConditionsSchema = z.object({
  takeProfitPercentage: z.number().optional().describe("Close when P&L reaches this % of max profit"),
  stopLossPercentage: z.number().optional().describe("Close when loss reaches this % of max loss"),
  atDaysToExpiration: z.number().optional().describe("Close at this many DTE"),
  afterDaysInTrade: z.number().optional().describe("Close after this many calendar days"),
  minimumVIX: z.number().optional().describe("Close when VIX drops below this value"),
});

function computeTrialStats(trials: Array<{ profitLoss: number }>): {
  trialCount: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
  expectancy: number;
} {
  if (trials.length === 0) {
    return { trialCount: 0, winRate: 0, avgPnL: 0, totalPnL: 0, expectancy: 0 };
  }
  const wins = trials.filter(t => t.profitLoss > 0).length;
  const totalPnL = trials.reduce((sum, t) => sum + t.profitLoss, 0);
  const winRate = wins / trials.length;
  const avgPnL = totalPnL / trials.length;
  const avgWin = wins > 0
    ? trials.filter(t => t.profitLoss > 0).reduce((s, t) => s + t.profitLoss, 0) / wins
    : 0;
  const losses = trials.length - wins;
  const avgLoss = losses > 0
    ? Math.abs(trials.filter(t => t.profitLoss <= 0).reduce((s, t) => s + t.profitLoss, 0) / losses)
    : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
  return { trialCount: trials.length, winRate, avgPnL, totalPnL, expectancy };
}

export function registerBacktestTools(server: McpServer) {
  server.tool(
    "get_available_backtest_dates",
    "List symbols available for backtesting along with their historical date ranges. Optionally filter by a specific symbol.",
    {
      symbol: z.string().optional().describe("Optional symbol to filter results (e.g. 'SPY')"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const path = symbol ? `/available-dates?symbol=${encodeURIComponent(symbol)}` : "/available-dates";
        const data = await backtestFetch(path);
        const items: Array<{ symbol: string; earliestDate: string; latestDate: string }> =
          Array.isArray(data) ? data : (data?.data ?? data?.items ?? [data]);
        return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "run_backtest",
    [
      "Submit a multi-leg options backtest. Returns a backtestId and initial status immediately — does NOT wait for completion.",
      "Poll get_backtest_results with the returned backtestId to retrieve statistics, trials, and equity snapshots.",
      "strikeSelection methods: 'delta' (delta field 1-100), 'percentageOTM' (percentageOTM field), 'percentageOTMRelative' (percentageOTMRelative + strikeRelativeLeg), 'currentPriceOffset' (currentPriceOffset field), 'currentPriceOffsetRelative' (currentPriceOffsetRelative + strikeRelativeLeg), 'currentPriceExactOffsetRelative' (currentPriceExactOffsetRelative + strikeRelativeLeg), 'premium' (premium field in dollars).",
    ].join("\n"),
    {
      symbol: z.string().describe("Underlying symbol (e.g. 'SPY')"),
      startDate: z.string().describe("Start date in YYYY-MM-DD format"),
      endDate: z.string().describe("End date in YYYY-MM-DD format"),
      legs: z.array(BacktestLegSchema).describe("Array of option legs"),
      entryConditions: EntryConditionsSchema.describe("Entry conditions for each trial"),
      exitConditions: ExitConditionsSchema.optional().describe("Exit conditions for each trial"),
    },
    SIDE_EFFECT,
    async ({ symbol, startDate, endDate, legs, entryConditions, exitConditions }) => {
      try {
        const body: Record<string, any> = { symbol, startDate, endDate, legs, entryConditions };
        if (exitConditions) body.exitConditions = exitConditions;
        const data = await backtestFetch("/backtests", {
          method: "POST",
          body: JSON.stringify(body),
        });
        const backtestId = data?.id ?? data?.backtestId ?? data?.data?.id;
        const status = data?.status ?? data?.data?.status ?? "submitted";
        return { content: [{ type: "text" as const, text: JSON.stringify({ backtestId, status }) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_backtest_results",
    "Poll a previously submitted backtest for status, statistics, full trial-by-trial P&L, and equity curve snapshots. Trials and snapshots are returned in full without truncation.",
    {
      backtestId: z.string().describe("The backtest ID returned by run_backtest"),
    },
    READ_ONLY,
    async ({ backtestId }) => {
      try {
        const data = await backtestFetch(`/backtests/${encodeURIComponent(backtestId)}`);
        const raw = data?.data ?? data;
        const status: string = raw?.status ?? "unknown";
        const progress: number | undefined = raw?.progress;

        const rawStats = raw?.statistics ?? raw?.stats ?? {};
        const statistics = {
          totalTrades: rawStats?.totalTrades ?? rawStats?.["total-trades"] ?? null,
          winRate: rawStats?.winRate ?? rawStats?.["win-rate"] ?? null,
          averageProfitLoss: rawStats?.averageProfitLoss ?? rawStats?.["average-profit-loss"] ?? null,
          totalProfitLoss: rawStats?.totalProfitLoss ?? rawStats?.["total-profit-loss"] ?? null,
          maxDrawdown: rawStats?.maxDrawdown ?? rawStats?.["max-drawdown"] ?? null,
          sharpeRatio: rawStats?.sharpeRatio ?? rawStats?.["sharpe-ratio"] ?? null,
        };

        const rawTrials: any[] = raw?.trials ?? [];
        const trials = rawTrials.map((t: any) => ({
          openDateTime: t.openDateTime ?? t["open-date-time"] ?? t.openDate,
          closeDateTime: t.closeDateTime ?? t["close-date-time"] ?? t.closeDate,
          profitLoss: t.profitLoss ?? t["profit-loss"] ?? t.pnl ?? 0,
        }));

        const rawSnapshots: any[] = raw?.snapshots ?? raw?.equityCurve ?? [];
        const snapshots = rawSnapshots.map((s: any) => ({
          dateTime: s.dateTime ?? s["date-time"] ?? s.date,
          cumulativeProfitLoss: s.cumulativeProfitLoss ?? s["cumulative-profit-loss"] ?? s.cumPnl ?? 0,
          underlyingPrice: s.underlyingPrice ?? s["underlying-price"] ?? null,
        }));

        const result: Record<string, any> = { status };
        if (progress !== undefined) result.progress = progress;
        result.statistics = statistics;
        result.trials = trials;
        result.snapshots = snapshots;

        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "simulate_trade",
    "One-shot historical price lookup for an option structure on specific dates. Provide OCC-format option symbols and an optional time window to get historical prices, effects, and greeks.",
    {
      underlying: z.string().describe("Underlying symbol (e.g. 'SPY')"),
      startTime: z.string().optional().describe("Start time in ISO 8601 format (e.g. '2024-01-15T09:30:00Z')"),
      endTime: z.string().optional().describe("End time in ISO 8601 format (e.g. '2024-01-15T16:00:00Z')"),
      legs: z.array(z.object({
        symbol: z.string().describe("OCC-format option symbol (e.g. 'SPY   250117C00500000')"),
      })).describe("Option legs to simulate"),
    },
    READ_ONLY,
    async ({ underlying, startTime, endTime, legs }) => {
      try {
        const body: Record<string, any> = { underlying, legs };
        if (startTime) body.startTime = startTime;
        if (endTime) body.endTime = endTime;
        const data = await backtestFetch("/simulate-trade", {
          method: "POST",
          body: JSON.stringify(body),
        });
        const items: Array<{ dateTime: string; price: number; effect: string; underlyingPrice: number; delta: number }> =
          Array.isArray(data) ? data : (data?.data ?? data?.items ?? [data]);
        return { content: [{ type: "text" as const, text: JSON.stringify(items) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "analyze_earnings_backtest",
    "Filter backtest results by proximity to historical earnings dates and return filtered vs. baseline statistics side-by-side. Uses cached backtest results — no new backtest is submitted.",
    {
      symbol: z.string().describe("Underlying symbol (e.g. 'SPY')"),
      backtestId: z.string().describe("A completed backtest ID from run_backtest"),
      daysBeforeMin: z.number().int().default(10).describe("Minimum days before earnings date to include a trial (default 10)"),
      daysBeforeMax: z.number().int().default(21).describe("Maximum days before earnings date to include a trial (default 21)"),
      earningsLimit: z.number().int().default(20).describe("Maximum number of historical earnings dates to fetch (default 20)"),
    },
    READ_ONLY,
    async ({ symbol, backtestId, daysBeforeMin, daysBeforeMax, earningsLimit }) => {
      try {
        const [earningsRaw, backtestRaw] = await Promise.all([
          getClient().marketMetricsService.getHistoricalEarningsData(symbol, { limit: earningsLimit }),
          backtestFetch(`/backtests/${encodeURIComponent(backtestId)}`),
        ]);

        const earningsItems: any[] = Array.isArray(earningsRaw)
          ? earningsRaw
          : (earningsRaw as any)?.data?.items ?? (earningsRaw as any)?.items ?? [];

        const earningsDates: Date[] = earningsItems
          .map((e: any) => {
            const raw = e["occurred-date"] ?? e.occurredDate ?? e.date ?? e["earnings-date"] ?? e.earningsDate;
            return raw ? new Date(raw) : null;
          })
          .filter((d): d is Date => d !== null && !isNaN(d.getTime()));

        const raw = backtestRaw?.data ?? backtestRaw;
        const rawTrials: any[] = raw?.trials ?? [];
        const allTrials = rawTrials.map((t: any) => ({
          openDateTime: t.openDateTime ?? t["open-date-time"] ?? t.openDate ?? "",
          closeDateTime: t.closeDateTime ?? t["close-date-time"] ?? t.closeDate ?? "",
          profitLoss: t.profitLoss ?? t["profit-loss"] ?? t.pnl ?? 0,
        }));

        const matchedTrials: Array<{
          openDateTime: string;
          closeDateTime: string;
          profitLoss: number;
          daysBeforeEarnings: number;
        }> = [];

        for (const trial of allTrials) {
          if (!trial.openDateTime) continue;
          const trialDate = new Date(trial.openDateTime);
          if (isNaN(trialDate.getTime())) continue;

          for (const earningsDate of earningsDates) {
            const diffMs = earningsDate.getTime() - trialDate.getTime();
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            if (diffDays >= daysBeforeMin && diffDays <= daysBeforeMax) {
              matchedTrials.push({ ...trial, daysBeforeEarnings: diffDays });
              break;
            }
          }
        }

        const filteredStats = computeTrialStats(matchedTrials);
        const baselineStats = computeTrialStats(allTrials);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              filteredStats,
              baselineStats,
              earningsDatesUsed: earningsDates.map(d => d.toISOString().slice(0, 10)),
              matchedTrials,
            }),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "analyze_zone_backtest",
    "Find historical price touches of a supply/demand zone via candle data and simulate the specified option trade at each touch. Returns aggregate win rate, average P&L, and per-touch results.",
    {
      symbol: z.string().describe("Underlying symbol (e.g. 'SPY')"),
      zonePrice: z.number().describe("The central price level of the zone"),
      zoneTolerance: z.number().default(0.005).describe("Fractional tolerance around zone (default 0.005 = ±0.5%)"),
      direction: z.enum(["long", "short"]).describe("Trade direction at zone touch"),
      legs: z.array(z.object({
        symbol: z.string().describe("OCC-format option symbol"),
      })).describe("Option legs to simulate at each touch"),
      lookbackDays: z.number().int().default(504).describe("Calendar days of candle history to search (default 504 ≈ 2 years)"),
      holdingPeriodDays: z.number().int().describe("Number of days to hold the position after entry"),
    },
    SIDE_EFFECT,
    async ({ symbol, zonePrice, zoneTolerance, direction, legs, lookbackDays, holdingPeriodDays }) => {
      try {
        const { CandleType } = await import("@tastytrade/api");
        const client = getClient();

        const collectedCandles: any[] = [];
        const listener = (events: any[]) => {
          for (const e of events) collectedCandles.push(e);
        };

        client.quoteStreamer.addEventListener(listener);
        const wasConnected = (client.quoteStreamer as any).isConnected;
        if (!wasConnected) {
          await client.quoteStreamer.connect();
        }

        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - lookbackDays);

        const candleEntry = { symbol, fromTime: fromDate.getTime(), periodMinutes: 1440, candleType: CandleType.Minute };
        registerCandleSubscription(candleEntry);
        try {
          client.quoteStreamer.subscribeCandles(symbol, fromDate.getTime(), 1440, CandleType.Minute);
          await new Promise(resolve => setTimeout(resolve, 10000));
        } finally {
          unregisterCandleSubscription(candleEntry);
          client.quoteStreamer.removeEventListener(listener);
        }

        const dailyCandles = collectedCandles.filter(
          (c: any) => c.eventSymbol === symbol && c.close != null
        );

        const lower = zonePrice * (1 - zoneTolerance);
        const upper = zonePrice * (1 + zoneTolerance);

        const touchCandles = dailyCandles.filter(
          (c: any) => c.low <= upper && c.high >= lower
        );

        const touches: Array<{
          date: string;
          entryPrice: number;
          exitPrice: number | null;
          profitLoss: number;
          won: boolean;
          simError?: string;
        }> = [];

        for (const candle of touchCandles) {
          const candleDate = new Date(typeof candle.time === "number" ? candle.time : Number(candle.time));
          if (isNaN(candleDate.getTime())) continue;

          const startTime = candleDate.toISOString();
          const endDate = new Date(candleDate.getTime() + holdingPeriodDays * 24 * 60 * 60 * 1000);
          const endTime = endDate.toISOString();

          let pnl: number | null = null;
          let exitPrice: number | null = null;
          let simError: string | undefined;

          try {
            const simResult = await backtestFetch("/simulate-trade", {
              method: "POST",
              body: JSON.stringify({ underlying: symbol, startTime, endTime, legs }),
            });

            const simItems: any[] = Array.isArray(simResult) ? simResult : (simResult?.data ?? simResult?.items ?? []);
            if (simItems.length >= 2) {
              const entry = simItems[0];
              const exit = simItems[simItems.length - 1];
              const entryEffect = entry.effect ?? "debit";
              const exitEffect = exit.effect ?? "credit";
              const sign = (direction === "long")
                ? (entryEffect === "debit" ? -1 : 1)
                : (entryEffect === "credit" ? 1 : -1);
              pnl = sign * entry.price + (exitEffect === "credit" ? exit.price : -exit.price);
              exitPrice = exit.underlyingPrice ?? null;
            } else if (simItems.length === 1) {
              pnl = simItems[0].price ?? 0;
            } else {
              simError = "No simulation data returned";
            }
          } catch (err: any) {
            simError = formatApiError(err);
          }

          if (pnl !== null) {
            touches.push({
              date: candleDate.toISOString().slice(0, 10),
              entryPrice: candle.close ?? zonePrice,
              exitPrice,
              profitLoss: pnl,
              won: pnl > 0,
            });
          } else {
            touches.push({
              date: candleDate.toISOString().slice(0, 10),
              entryPrice: candle.close ?? zonePrice,
              exitPrice: null,
              profitLoss: 0,
              won: false,
              simError,
            });
          }
        }

        const successfulTouches = touches.filter(t => t.simError === undefined);
        const failedCount = touches.length - successfulTouches.length;
        const stats = computeTrialStats(successfulTouches);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              zonePrice,
              touchCount: touches.length,
              successfulSimulations: successfulTouches.length,
              failedSimulations: failedCount,
              winRate: stats.winRate,
              avgPnL: stats.avgPnL,
              expectancy: stats.expectancy,
              touches,
            }),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );
}
