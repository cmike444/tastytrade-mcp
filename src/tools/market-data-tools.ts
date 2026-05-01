import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getClient,
  registerQuoteSubscriptions,
  unregisterQuoteSubscriptions,
  registerCandleSubscription,
  unregisterCandleSubscription,
  getOrCreateInflightQuote,
  onReconnect,
} from "../tastytrade-client.js";
import { formatApiError } from "./error-utils.js";
import { coerceToArray } from "./schema-utils.js";
import { renderQuote, renderGreeks, renderMarketMetrics, renderCandlestick, extractItems } from "./render-utils.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

interface FuturesContract {
  "active-month"?: boolean;
  active?: boolean;
  "streamer-symbol"?: string;
  streamerSymbol?: string;
  [key: string]: unknown;
}

/**
 * Resolve a futures root symbol (e.g. /CL) to its active front-month
 * streamer symbol (e.g. /CLM26:XNYM) using the TastyTrade instruments API.
 *
 * `getSingleFuture` expects a fully-qualified contract symbol (e.g. /CLM5),
 * not a root symbol, so it returns 404 for roots.  Instead we call
 * `getFutures` filtered by product-code and select the active-month contract.
 *
 * Returns the streamer symbol string, or throws on failure.
 */
async function resolveFuturesStreamerSymbol(client: ReturnType<typeof getClient>, rootSymbol: string): Promise<string> {
  const productCode = rootSymbol.replace(/^\//, "");
  let raw: unknown;
  try {
    raw = await client.instrumentsService.getFutures({ "product-code": productCode });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not fetch futures contracts for ${rootSymbol}: ${msg}`);
  }
  // The SDK unwraps the response, but defensively accept both an array and a
  // wrapped shape ({ items: [...] } or { data: { items: [...] } }).
  let contracts: FuturesContract[];
  if (Array.isArray(raw)) {
    contracts = raw as FuturesContract[];
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const items = Array.isArray(obj["items"]) ? obj["items"] :
                  Array.isArray((obj["data"] as Record<string, unknown> | undefined)?.["items"])
                    ? (obj["data"] as Record<string, unknown>)["items"] as unknown[]
                    : null;
    if (items) {
      contracts = items as FuturesContract[];
    } else {
      throw new Error(`Unexpected response shape from getFutures for ${rootSymbol}: ${JSON.stringify(raw).slice(0, 200)}`);
    }
  } else {
    throw new Error(`No futures contracts returned for product code ${productCode} (symbol ${rootSymbol})`);
  }
  if (contracts.length === 0) {
    throw new Error(`No futures contracts returned for product code ${productCode} (symbol ${rootSymbol})`);
  }
  // Prefer the active front-month contract
  const frontMonth = contracts.find(c => c["active-month"] === true);
  const contract = frontMonth ?? contracts.find(c => c["active"] === true) ?? contracts[0];
  const resolved: string | undefined = contract?.["streamer-symbol"] ?? contract?.streamerSymbol;
  if (!resolved) {
    throw new Error(`No streamer-symbol field found for ${rootSymbol} (product code ${productCode})`);
  }
  return resolved;
}

/**
 * Resolve a futures option symbol (e.g. ./ESM6 EW1M6 250516C5000) to its
 * DXLink streamer symbol via `getSingleFutureOption`.
 *
 * Futures option symbols begin with "./" and are distinct from outright
 * futures ("/CL") which are handled by resolveFuturesStreamerSymbol.
 */
async function resolveFuturesOptionStreamerSymbol(
  client: ReturnType<typeof getClient>,
  symbol: string
): Promise<string> {
  let raw: unknown;
  try {
    raw = await client.instrumentsService.getSingleFutureOption(symbol);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not fetch futures option for ${symbol}: ${msg}`);
  }
  const item: Record<string, unknown> = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const resolved =
    (item["streamer-symbol"] ?? item["streamerSymbol"]) as string | undefined;
  if (!resolved) {
    throw new Error(
      `No streamer-symbol field found for futures option ${symbol}: ${JSON.stringify(raw).slice(0, 200)}`
    );
  }
  return resolved;
}

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

const QUOTE_SUMMARY_FIELDS = ["eventSymbol", "resolvedStreamerSymbol", "bidPrice", "askPrice", "lastPrice"];
const QUOTE_STANDARD_FIELDS = [
  "eventSymbol", "resolvedStreamerSymbol", "eventType", "bidPrice", "askPrice", "lastPrice",
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

const METRICS_SUMMARY_FIELDS = ["symbol", "iv-rank", "iv-percentile", "implied-volatility-index-rank", "implied-volatility-percentile"];
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
    "Get market metrics (volatility data, IV rank, IV percentile) for given symbols. Includes options Greeks data like implied volatility. Use 'detail' to control response size: 'summary' returns symbol, IV rank, IV percentile; 'standard' returns common volatility fields (default); 'full' returns the complete API payload. Use 'format: html' for a visual card with IV rank gauge.",
    {
      symbols: z.preprocess(coerceToArray, z.array(z.string())).describe("Array of symbols to get market metrics for (e.g., ['AAPL', 'TSLA'])"),
      detail: z.enum(["summary", "standard", "full"]).default("standard").describe("Response detail level: 'summary' (symbol, IV rank, IV percentile), 'standard' (common volatility fields, default), 'full' (complete raw payload)"),
      format: z.enum(["json", "html"]).default("json").describe("Output format: 'json' (default) or 'html' for a visual artifact with IV rank gauge cards"),
    },
    READ_ONLY,
    async ({ symbols, detail, format }) => {
      try {
        const queryParams = { symbols: symbols.join(",") };
        const metrics = await getClient().marketMetricsService.getMarketMetrics(queryParams);
        const result = applyMetricsProjection(metrics, detail);
        if (format === "html") {
          const items = extractItems(metrics);
          return { content: [{ type: "text" as const, text: renderMarketMetrics(items) }] };
        }
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
    "Get real-time quote data for one or more symbols using DXLink. Futures root symbols (e.g. /CL, /ES) are accepted and automatically resolved to the active front-month contract — you do not need to supply the streamer symbol manually. Use 'detail' to control response size: 'summary' returns only bid, ask, last, and symbol; 'standard' returns common quote fields (default); 'full' returns the raw DXLink event. Use 'format: html' for a visual ticker card.",
    {
      symbols: z.preprocess(coerceToArray, z.array(z.string())).describe("Array of symbols to get quotes for (e.g., ['AAPL', 'TSLA', '/CL', '/ES'])"),
      timeoutMs: z.number().default(5000).describe("Timeout in milliseconds to wait for quotes (default 5000)"),
      detail: z.enum(["summary", "standard", "full"]).default("standard").describe("Response detail level: 'summary' (bid, ask, last, symbol), 'standard' (common quote fields, default), 'full' (complete raw DXLink event)"),
      format: z.enum(["json", "html"]).default("json").describe("Output format: 'json' (default) or 'html' for a visual ticker card artifact"),
    },
    READ_ONLY,
    async ({ symbols, timeoutMs, detail, format }) => {
      try {
        const client = getClient();

        // Resolve futures root symbols (e.g. /CL) to their active streamer symbol (e.g. /CLM26:XNYM)
        const symbolMap = new Map<string, string>(); // streamerSymbol -> originalSymbol
        const streamerSymbols: string[] = [];
        for (const sym of symbols) {
          if (sym.startsWith("/")) {
            let resolved: string;
            try {
              resolved = await resolveFuturesStreamerSymbol(client, sym);
            } catch (err: any) {
              return {
                content: [{ type: "text" as const, text: `Error: Could not look up futures instrument for ${sym}: ${err?.message ?? err}` }],
                isError: true,
              };
            }
            symbolMap.set(resolved, sym);
            streamerSymbols.push(resolved);
          } else {
            symbolMap.set(sym, sym);
            streamerSymbols.push(sym);
          }
        }

        const wasConnected = (client.quoteStreamer as any).isConnected;
        if (!wasConnected) {
          await client.quoteStreamer.connect();
        }

        // Per-symbol coalescing: if a concurrent request is already fetching
        // the same streamer symbol we attach to its promise instead of opening
        // a redundant subscription.
        const perSymbolPromises = streamerSymbols.map((sym) => {
          const { promise, isNew } = getOrCreateInflightQuote(sym, timeoutMs, client.quoteStreamer);
          if (isNew) {
            registerQuoteSubscriptions([sym]);
            try {
              client.quoteStreamer.subscribe([sym]);
            } catch (err) {
              // subscribe() failed before the streamer could register the
              // symbol — clean up the refcount immediately so it doesn't leak.
              unregisterQuoteSubscriptions([sym]);
              throw err;
            }
            return promise.then((events: any[]) => {
              unregisterQuoteSubscriptions([sym]);
              return events;
            });
          }
          return promise;
        });

        const collectedEvents = (await Promise.all(perSymbolPromises)).flat();

        if (collectedEvents.length === 0) {
          return { content: [{ type: "text" as const, text: `No quote data received for ${symbols.join(', ')} within ${timeoutMs}ms. Market may be closed or symbols may be invalid.` }] };
        }

        // Re-map streamer symbols back to the original user-supplied symbols,
        // and annotate futures events with the resolved streamer symbol.
        // For Trade events, also expose price as lastPrice for a consistent "last" field.
        const remappedEvents = collectedEvents.map(e => {
          const streamer = e.eventSymbol;
          const original = symbolMap.get(streamer);
          const isTrade = e.eventType === "Trade";
          const lastPrice = isTrade && typeof e.price === "number" ? { lastPrice: e.price } : {};
          if (original && original !== streamer) {
            return { ...e, ...lastPrice, eventSymbol: original, resolvedStreamerSymbol: streamer };
          }
          return isTrade ? { ...e, ...lastPrice } : e;
        });

        if (format === "html") {
          return { content: [{ type: "text" as const, text: renderQuote(remappedEvents) }] };
        }

        const projected = remappedEvents.map(e => projectQuote(e, detail));
        return { content: [{ type: "text" as const, text: JSON.stringify(projected) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_candles",
    "Get candlestick chart data for technical analysis. Retrieves OHLCV candle data via DXLink. Accepts equity symbols (e.g. 'AAPL'), outright futures root symbols (e.g. '/GCM6', '/ES'), and futures options symbols (e.g. './ESM6 EW1M6 250516C5000'). Use 'limit' to cap the number of candles returned (default 100, most-recent candles kept). Use 'detail' to control response size: 'summary' returns 6 OHLC fields, 'standard' returns OHLCV+vwap (default), 'full' returns the complete raw payload. Use 'format: html' for a visual SVG candlestick chart.",
    {
      symbol: z.string().describe("Symbol to get candles for. Equities: 'AAPL'. Futures root: '/GCM6', '/ES'. Futures options: './ESM6 EW1M6 250516C5000'."),
      periodMinutes: z.number().default(5).describe("Candle period in minutes (e.g., 1, 5, 15, 30, 60)"),
      daysBack: z.number().default(1).describe("Number of days of historical data to fetch"),
      timeoutMs: z.number().default(8000).describe("Timeout in milliseconds to wait for candle data (default 8000)"),
      limit: z.number().default(100).describe("Maximum number of candles to return (default 100, most-recent candles kept; set to 0 for no limit)"),
      detail: z.enum(["summary", "standard", "full"]).default("standard").describe("Response detail level: 'summary' (6 fields: symbol, time, open, high, low, close), 'standard' (OHLCV+vwap, default), 'full' (complete raw payload)"),
      format: z.enum(["json", "html"]).default("json").describe("Output format: 'json' (default) or 'html' for a visual SVG candlestick chart artifact"),
    },
    READ_ONLY,
    async ({ symbol, periodMinutes, daysBack, timeoutMs, limit, detail, format }) => {
      try {
        const client = getClient();

        let streamerSymbol = symbol;
        if (symbol.startsWith("./")) {
          // Futures option symbol (e.g. ./ESM6 EW1M6 250516C5000)
          try {
            streamerSymbol = await resolveFuturesOptionStreamerSymbol(client, symbol);
          } catch (err: any) {
            return {
              content: [{ type: "text" as const, text: `Error: Could not look up futures option for ${symbol}: ${err?.message ?? err}` }],
              isError: true,
            };
          }
        } else if (symbol.startsWith("/")) {
          // Outright futures root symbol (e.g. /CL, /ES)
          try {
            streamerSymbol = await resolveFuturesStreamerSymbol(client, symbol);
          } catch (err: any) {
            return {
              content: [{ type: "text" as const, text: `Error: Could not look up futures instrument for ${symbol}: ${err?.message ?? err}` }],
              isError: true,
            };
          }
        }

        const collectedEvents: any[] = [];

        const listener = (events: any[]) => {
          for (const event of events) {
            collectedEvents.push(event);
          }
        };

        client.quoteStreamer.addEventListener(listener);

        // Clear stale pre-reconnect candles if the WebSocket reconnects during
        // the collection window.  replaySubscriptions() will re-subscribe and
        // fresh candles will arrive into the now-empty buffer.
        const unsubReconnect = onReconnect(() => {
          collectedEvents.length = 0;
        });

        const wasConnected = (client.quoteStreamer as any).isConnected;
        if (!wasConnected) {
          await client.quoteStreamer.connect();
        }

        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - daysBack);

        const { CandleType } = await import("@tastytrade/api");
        const candleEntry = { symbol: streamerSymbol, fromTime: fromDate.getTime(), periodMinutes, candleType: CandleType.Minute };
        registerCandleSubscription(candleEntry);
        try {
          client.quoteStreamer.subscribeCandles(streamerSymbol, fromDate.getTime(), periodMinutes, CandleType.Minute);
          await new Promise(resolve => setTimeout(resolve, timeoutMs));
        } finally {
          unsubReconnect();
          unregisterCandleSubscription(candleEntry);
          client.quoteStreamer.removeEventListener(listener);
        }

        if (collectedEvents.length === 0) {
          return { content: [{ type: "text" as const, text: `No candle data received for ${symbol} (streamer: ${streamerSymbol}) within ${timeoutMs}ms. Market may be closed.` }] };
        }

        let candles = collectedEvents;
        if (streamerSymbol !== symbol) {
          candles = candles.map(c =>
            c.eventSymbol === streamerSymbol ? { ...c, eventSymbol: symbol } : c
          );
        }
        if (limit > 0 && candles.length > limit) {
          candles = candles.slice(candles.length - limit);
        }

        if (format === "html") {
          return { content: [{ type: "text" as const, text: renderCandlestick(candles, symbol) }] };
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
    "Get options Greeks (delta, gamma, theta, vega, rho) by subscribing to Greeks events via DXLink for specific option symbols. This tool accepts fully-qualified option streamer symbols only (e.g. '.AAPL240119C185'); futures root symbols are not applicable here. Use 'detail' to control response size: 'summary' returns only symbol + the 5 Greek values; 'standard' returns Greeks plus implied volatility and underlying price (default); 'full' returns the raw DXLink event. Use 'format: html' for a visual Greeks card.",
    {
      optionSymbols: z.preprocess(coerceToArray, z.array(z.string())).describe("Array of option streamer symbols. Use call-streamer-symbol or put-streamer-symbol from option chain endpoints."),
      timeoutMs: z.number().default(5000).describe("Timeout in milliseconds to wait for Greeks data (default 5000)"),
      detail: z.enum(["summary", "standard", "full"]).default("standard").describe("Response detail level: 'summary' (symbol + delta, gamma, theta, vega, rho), 'standard' (Greeks + implied volatility + underlying price, default), 'full' (complete raw DXLink event)"),
      format: z.enum(["json", "html"]).default("json").describe("Output format: 'json' (default) or 'html' for a visual Greeks card artifact"),
    },
    READ_ONLY,
    async ({ optionSymbols, timeoutMs, detail, format }) => {
      try {
        const client = getClient();

        const wasConnected = (client.quoteStreamer as any).isConnected;
        if (!wasConnected) {
          await client.quoteStreamer.connect();
        }

        // Per-symbol coalescing: attach to an existing in-flight subscription
        // when a concurrent caller is already fetching the same option symbol.
        const perSymbolPromises = optionSymbols.map((sym) => {
          const { promise, isNew } = getOrCreateInflightQuote(sym, timeoutMs, client.quoteStreamer);
          if (isNew) {
            registerQuoteSubscriptions([sym]);
            try {
              client.quoteStreamer.subscribe([sym]);
            } catch (err) {
              unregisterQuoteSubscriptions([sym]);
              throw err;
            }
            return promise.then((events: any[]) => {
              unregisterQuoteSubscriptions([sym]);
              return events;
            });
          }
          return promise;
        });

        const collectedEvents = (await Promise.all(perSymbolPromises)).flat();

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

        if (format === "html") {
          return { content: [{ type: "text" as const, text: renderGreeks(resultData) }] };
        }

        const projected = resultData.map((e: any) => projectGreeks(e, detail));
        return { content: [{ type: "text" as const, text: JSON.stringify(projected) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

}
