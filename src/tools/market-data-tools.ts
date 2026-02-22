import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerMarketDataTools(server: McpServer) {
  server.tool(
    "get_market_metrics",
    "Get market metrics (volatility data, IV rank, IV percentile) for given symbols. Includes options Greeks data like implied volatility.",
    {
      symbols: z.array(z.string()).describe("Array of symbols to get market metrics for (e.g., ['AAPL', 'TSLA'])"),
    },
    READ_ONLY,
    async ({ symbols }) => {
      try {
        const queryParams = { symbols: symbols.join(",") };
        const metrics = await getClient().marketMetricsService.getMarketMetrics(queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(metrics, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_historical_dividends",
    "Get historical dividend data for a symbol.",
    {
      symbol: z.string().describe("The symbol to get dividend history for (e.g., 'AAPL')"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const dividends = await getClient().marketMetricsService.getHistoricalDividendData(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(dividends, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_historical_earnings",
    "Get historical earnings data for a symbol.",
    {
      symbol: z.string().describe("The symbol to get earnings history for (e.g., 'AAPL')"),
      startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
    },
    READ_ONLY,
    async ({ symbol, startDate }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (startDate) queryParams["start-date"] = startDate;
        const earnings = await getClient().marketMetricsService.getHistoricalEarningsData(symbol, queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(earnings, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_quote",
    "Get real-time quote data for one or more symbols using DXLink. Returns bid, ask, last price, volume, and other quote fields.",
    {
      symbols: z.array(z.string()).describe("Array of symbols to get quotes for (e.g., ['AAPL', 'TSLA'])"),
      timeoutMs: z.number().default(5000).describe("Timeout in milliseconds to wait for quotes (default 5000)"),
    },
    READ_ONLY,
    async ({ symbols, timeoutMs }) => {
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

        return { content: [{ type: "text" as const, text: JSON.stringify(collectedEvents, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_candles",
    "Get candlestick chart data for technical analysis. Retrieves OHLCV candle data via DXLink.",
    {
      symbol: z.string().describe("The symbol to get candles for (e.g., 'AAPL')"),
      periodMinutes: z.number().default(5).describe("Candle period in minutes (e.g., 1, 5, 15, 30, 60)"),
      daysBack: z.number().default(1).describe("Number of days of historical data to fetch"),
      timeoutMs: z.number().default(8000).describe("Timeout in milliseconds to wait for candle data (default 8000)"),
    },
    READ_ONLY,
    async ({ symbol, periodMinutes, daysBack, timeoutMs }) => {
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

        return { content: [{ type: "text" as const, text: JSON.stringify(collectedEvents, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_options_greeks",
    "Get options Greeks (delta, gamma, theta, vega, rho) by subscribing to Greeks events via DXLink for specific option symbols.",
    {
      optionSymbols: z.array(z.string()).describe("Array of option streamer symbols. Use call-streamer-symbol or put-streamer-symbol from option chain endpoints."),
      timeoutMs: z.number().default(5000).describe("Timeout in milliseconds to wait for Greeks data (default 5000)"),
    },
    READ_ONLY,
    async ({ optionSymbols, timeoutMs }) => {
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

        return { content: [{ type: "text" as const, text: JSON.stringify(resultData, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
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
        return { content: [{ type: "text" as const, text: JSON.stringify(token, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
