import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";
import { formatApiError } from "./error-utils.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

type DetailTier = "summary" | "standard" | "full";

const CANDLE_SUMMARY_FIELDS = ["eventSymbol", "time", "open", "high", "low", "close"];
const CANDLE_STANDARD_FIELDS = ["eventSymbol", "time", "sequence", "open", "high", "low", "close", "volume", "vwap"];

function projectCandle(item: any, detail: DetailTier): any {
  if (detail === "full") return item;
  const fields = detail === "summary" ? CANDLE_SUMMARY_FIELDS : CANDLE_STANDARD_FIELDS;
  const result: Record<string, any> = {};
  for (const field of fields) {
    if (item[field] !== undefined) result[field] = item[field];
  }
  return result;
}

const QUOTE_SUMMARY_FIELDS = ["eventSymbol", "bidPrice", "askPrice", "lastPrice"];
const QUOTE_STANDARD_FIELDS = [
  "eventSymbol", "eventType", "bidPrice", "askPrice", "lastPrice",
  "bidSize", "askSize", "lastSize", "openPrice", "highPrice", "lowPrice",
  "closePrice", "dayVolume", "dayTurnover",
];

function projectQuote(item: any, detail: DetailTier): any {
  if (detail === "full") return item;
  const fields = detail === "summary" ? QUOTE_SUMMARY_FIELDS : QUOTE_STANDARD_FIELDS;
  const result: Record<string, any> = {};
  for (const field of fields) {
    if (item[field] !== undefined) result[field] = item[field];
  }
  return result;
}

const GREEKS_SUMMARY_FIELDS = ["eventSymbol", "delta", "gamma", "theta", "vega", "rho"];
const GREEKS_STANDARD_FIELDS = [
  "eventSymbol", "eventType", "delta", "gamma", "theta", "vega", "rho",
  "volatility", "price", "underlyingPrice",
];

function projectGreeks(item: any, detail: DetailTier): any {
  if (detail === "full") return item;
  const fields = detail === "summary" ? GREEKS_SUMMARY_FIELDS : GREEKS_STANDARD_FIELDS;
  const result: Record<string, any> = {};
  for (const field of fields) {
    if (item[field] !== undefined) result[field] = item[field];
  }
  return result;
}

const METRICS_SUMMARY_FIELDS = ["symbol", "iv-rank", "iv-percentile"];
const METRICS_STANDARD_FIELDS = [
  "symbol", "iv-rank", "iv-percentile", "implied-volatility-index",
  "implied-volatility-index-5-day-change", "implied-volatility-30-day",
  "implied-volatility-60-day", "implied-volatility-90-day",
  "implied-volatility-index-rank", "implied-volatility-percentile",
  "liquidity-rank", "lendability",
];

function projectMetrics(item: any, detail: DetailTier): any {
  if (detail === "full") return item;
  const fields = detail === "summary" ? METRICS_SUMMARY_FIELDS : METRICS_STANDARD_FIELDS;
  const result: Record<string, any> = {};
  for (const field of fields) {
    if (item[field] !== undefined) result[field] = item[field];
  }
  return result;
}

function applyMetricsProjection(data: any, detail: DetailTier): any {
  if (detail === "full") return data;
  if (Array.isArray(data)) {
    return data.map(item => projectMetrics(item, detail));
  } else if (data?.data?.items) {
    const items = data.data.items.map((item: any) => projectMetrics(item, detail));
    return { data: { items, pagination: data.data.pagination }, context: data.context };
  } else if (data?.items) {
    const items = data.items.map((item: any) => projectMetrics(item, detail));
    return { items, pagination: data.pagination };
  } else {
    return projectMetrics(data, detail);
  }
}

export function registerMarketDataTools(server: McpServer) {
  server.tool(
    "get_market_metrics",
    "Get market metrics (volatility data, IV rank, IV percentile) for given symbols. Includes options Greeks data like implied volatility. Use 'detail' to control response size: 'summary' returns symbol, IV rank, IV percentile; 'standard' returns common volatility fields (default); 'full' returns the complete API payload.",
    {
      symbols: z.array(z.string()).describe("Array of symbols to get market metrics for (e.g., ['AAPL', 'TSLA'])"),
      detail: z.enum(["summary", "standard", "full"]).default("standard").describe("Response detail level: 'summary' (symbol, IV rank, IV percentile), 'standard' (common volatility fields, default), 'full' (complete raw payload)"),
    },
    READ_ONLY,
    async ({ symbols, detail }) => {
      try {
        const queryParams = { symbols: symbols.join(",") };
        const metrics = await getClient().marketMetricsService.getMarketMetrics(queryParams);
        const result = applyMetricsProjection(metrics, detail);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_historical_dividends",
    "Get historical dividend data for a symbol. Use 'limit' to cap the number of records returned (default 10).",
    {
      symbol: z.string().describe("The symbol to get dividend history for (e.g., 'AAPL')"),
      limit: z.number().default(10).describe("Maximum number of historical records to return (default 10; set to 0 for no limit)"),
    },
    READ_ONLY,
    async ({ symbol, limit }) => {
      try {
        const dividends = await getClient().marketMetricsService.getHistoricalDividendData(symbol);
        let result = dividends;
        if (limit > 0) {
          if (Array.isArray(result)) {
            result = result.slice(0, limit);
          } else if (result?.data?.items) {
            result = { ...result, data: { ...result.data, items: result.data.items.slice(0, limit) } };
          } else if (result?.items) {
            result = { ...result, items: result.items.slice(0, limit) };
          }
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_historical_earnings",
    "Get historical earnings data for a symbol. Use 'limit' to cap the number of records returned (default 10).",
    {
      symbol: z.string().describe("The symbol to get earnings history for (e.g., 'AAPL')"),
      startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
      limit: z.number().default(10).describe("Maximum number of historical records to return (default 10; set to 0 for no limit)"),
    },
    READ_ONLY,
    async ({ symbol, startDate, limit }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (startDate) queryParams["start-date"] = startDate;
        const earnings = await getClient().marketMetricsService.getHistoricalEarningsData(symbol, queryParams);
        let result = earnings;
        if (limit > 0) {
          if (Array.isArray(result)) {
            result = result.slice(0, limit);
          } else if (result?.data?.items) {
            result = { ...result, data: { ...result.data, items: result.data.items.slice(0, limit) } };
          } else if (result?.items) {
            result = { ...result, items: result.items.slice(0, limit) };
          }
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_quote",
    "Get real-time quote data for one or more symbols using DXLink. Use 'detail' to control response size: 'summary' returns only bid, ask, last, and symbol; 'standard' returns common quote fields (default); 'full' returns the raw DXLink event.",
    {
      symbols: z.array(z.string()).describe("Array of symbols to get quotes for (e.g., ['AAPL', 'TSLA'])"),
      timeoutMs: z.number().default(5000).describe("Timeout in milliseconds to wait for quotes (default 5000)"),
      detail: z.enum(["summary", "standard", "full"]).default("standard").describe("Response detail level: 'summary' (bid, ask, last, symbol), 'standard' (common quote fields, default), 'full' (complete raw DXLink event)"),
    },
    READ_ONLY,
    async ({ symbols, timeoutMs, detail }) => {
      try {
        const client = getClient();
        const collectedEvents: any[] = [];

        const listener = (events: any[]) => {
          for (const event of events) {
            collectedEvents.push(event);
          }
        };

        client.quoteStreamer.addEventListener(listener);

        const wasConnected = (client.quoteStreamer as any).isConnected;
        if (!wasConnected) {
          await client.quoteStreamer.connect();
        }

        client.quoteStreamer.subscribe(symbols);

        await new Promise(resolve => setTimeout(resolve, timeoutMs));

        client.quoteStreamer.removeEventListener(listener);

        if (collectedEvents.length === 0) {
          return { content: [{ type: "text" as const, text: `No quote data received for ${symbols.join(', ')} within ${timeoutMs}ms. Market may be closed or symbols may be invalid.` }] };
        }

        const projected = collectedEvents.map(e => projectQuote(e, detail));
        return { content: [{ type: "text" as const, text: JSON.stringify(projected) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_candles",
    "Get candlestick chart data for technical analysis. Retrieves OHLCV candle data via DXLink. Use 'limit' to cap the number of candles returned (default 100, most-recent candles kept). Use 'detail' to control response size: 'summary' returns 6 OHLC fields, 'standard' returns OHLCV+vwap (default), 'full' returns the complete raw payload.",
    {
      symbol: z.string().describe("The symbol to get candles for (e.g., 'AAPL')"),
      periodMinutes: z.number().default(5).describe("Candle period in minutes (e.g., 1, 5, 15, 30, 60)"),
      daysBack: z.number().default(1).describe("Number of days of historical data to fetch"),
      timeoutMs: z.number().default(8000).describe("Timeout in milliseconds to wait for candle data (default 8000)"),
      limit: z.number().default(100).describe("Maximum number of candles to return (default 100, most-recent candles kept; set to 0 for no limit)"),
      detail: z.enum(["summary", "standard", "full"]).default("standard").describe("Response detail level: 'summary' (6 fields: symbol, time, open, high, low, close), 'standard' (OHLCV+vwap, default), 'full' (complete raw payload)"),
    },
    READ_ONLY,
    async ({ symbol, periodMinutes, daysBack, timeoutMs, limit, detail }) => {
      try {
        const client = getClient();
        const collectedEvents: any[] = [];

        const listener = (events: any[]) => {
          for (const event of events) {
            collectedEvents.push(event);
          }
        };

        client.quoteStreamer.addEventListener(listener);

        const wasConnected = (client.quoteStreamer as any).isConnected;
        if (!wasConnected) {
          await client.quoteStreamer.connect();
        }

        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - daysBack);

        const { CandleType } = await import("@tastytrade/api");
        client.quoteStreamer.subscribeCandles(symbol, fromDate.getTime(), periodMinutes, CandleType.Minute);

        await new Promise(resolve => setTimeout(resolve, timeoutMs));

        client.quoteStreamer.removeEventListener(listener);

        if (collectedEvents.length === 0) {
          return { content: [{ type: "text" as const, text: `No candle data received for ${symbol} within ${timeoutMs}ms. Market may be closed.` }] };
        }

        let candles = collectedEvents;
        if (limit > 0 && candles.length > limit) {
          candles = candles.slice(candles.length - limit);
        }

        const projected = candles.map(c => projectCandle(c, detail));
        return { content: [{ type: "text" as const, text: JSON.stringify(projected) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_options_greeks",
    "Get options Greeks (delta, gamma, theta, vega, rho) by subscribing to Greeks events via DXLink for specific option symbols. Use 'detail' to control response size: 'summary' returns only symbol + the 5 Greek values; 'standard' returns Greeks plus implied volatility and underlying price (default); 'full' returns the raw DXLink event.",
    {
      optionSymbols: z.array(z.string()).describe("Array of option streamer symbols. Use call-streamer-symbol or put-streamer-symbol from option chain endpoints."),
      timeoutMs: z.number().default(5000).describe("Timeout in milliseconds to wait for Greeks data (default 5000)"),
      detail: z.enum(["summary", "standard", "full"]).default("standard").describe("Response detail level: 'summary' (symbol + delta, gamma, theta, vega, rho), 'standard' (Greeks + implied volatility + underlying price, default), 'full' (complete raw DXLink event)"),
    },
    READ_ONLY,
    async ({ optionSymbols, timeoutMs, detail }) => {
      try {
        const client = getClient();
        const collectedEvents: any[] = [];

        const listener = (events: any[]) => {
          for (const event of events) {
            collectedEvents.push(event);
          }
        };

        client.quoteStreamer.addEventListener(listener);

        const wasConnected = (client.quoteStreamer as any).isConnected;
        if (!wasConnected) {
          await client.quoteStreamer.connect();
        }

        client.quoteStreamer.subscribe(optionSymbols);

        await new Promise(resolve => setTimeout(resolve, timeoutMs));

        client.quoteStreamer.removeEventListener(listener);

        const greeksData = collectedEvents.filter((e: any) =>
          e.eventType === 'Greeks' ||
          e.eventType === 'TheoPrice' ||
          e.greeks ||
          e.delta !== undefined ||
          e.gamma !== undefined ||
          e.theta !== undefined ||
          e.vega !== undefined ||
          e.rho !== undefined
        );

        const resultData = greeksData.length > 0 ? greeksData : collectedEvents;

        if (resultData.length === 0) {
          return { content: [{ type: "text" as const, text: `No Greeks/quote data received for the provided option symbols within ${timeoutMs}ms. Verify the option symbols are valid streamer symbols.` }] };
        }

        const projected = resultData.map((e: any) => projectGreeks(e, detail));
        return { content: [{ type: "text" as const, text: JSON.stringify(projected) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_api_quote_token",
    "Get the quote streamer authentication token and endpoint for DXLink market data access.",
    {},
    READ_ONLY,
    async () => {
      try {
        const token = await getClient().accountsAndCustomersService.getApiQuoteToken();
        return { content: [{ type: "text" as const, text: JSON.stringify(token) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );
}
