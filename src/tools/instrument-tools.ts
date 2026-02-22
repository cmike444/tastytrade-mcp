import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerInstrumentTools(server: McpServer) {
  server.tool(
    "get_equity",
    "Get equity instrument definition for a single symbol.",
    {
      symbol: z.string().describe("The equity symbol (e.g., 'AAPL', 'TSLA')"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const equity = await getClient().instrumentsService.getSingleEquity(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(equity, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_equity_definitions",
    "Get equity definitions for one or more symbols.",
    {
      symbols: z.array(z.string()).optional().describe("Array of equity symbols to look up"),
      lendability: z.string().optional().describe("Filter by lendability ('Easy To Borrow', 'Locate Required', 'Preborrow')"),
    },
    READ_ONLY,
    async ({ symbols, lendability }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (symbols) queryParams.symbol = symbols;
        if (lendability) queryParams.lendability = lendability;
        const equities = await getClient().instrumentsService.getEquityDefinitions(queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(equities, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_active_equities",
    "Get all active equities in a paginated fashion.",
    {
      perPage: z.number().optional().describe("Number of results per page"),
      pageOffset: z.number().optional().describe("Page offset for pagination"),
    },
    READ_ONLY,
    async ({ perPage, pageOffset }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (perPage) queryParams["per-page"] = perPage;
        if (pageOffset) queryParams["page-offset"] = pageOffset;
        const equities = await getClient().instrumentsService.getActiveEquities(queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(equities, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_equity_options",
    "Get equity option instruments for given symbols.",
    {
      symbols: z.array(z.string()).describe("Array of option symbols to look up"),
      active: z.boolean().default(true).describe("Only return active options"),
      withExpired: z.boolean().default(false).describe("Include expired options"),
    },
    READ_ONLY,
    async ({ symbols, active, withExpired }) => {
      try {
        const options = await getClient().instrumentsService.getEquityOptions(symbols, active, withExpired);
        return { content: [{ type: "text" as const, text: JSON.stringify(options, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_single_equity_option",
    "Get a single equity option instrument by its symbol.",
    {
      symbol: z.string().describe("The option symbol (OCC format)"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const option = await getClient().instrumentsService.getSingleEquityOption(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(option, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_option_chain",
    "Get the full option chain for an underlying symbol with all expirations and strikes.",
    {
      symbol: z.string().describe("The underlying symbol (e.g., 'AAPL')"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const chain = await getClient().instrumentsService.getOptionChain(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(chain, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_nested_option_chain",
    "Get the option chain in a nested format (grouped by expiration then strike) to reduce processing.",
    {
      symbol: z.string().describe("The underlying symbol (e.g., 'AAPL')"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const chain = await getClient().instrumentsService.getNestedOptionChain(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(chain, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_compact_option_chain",
    "Get the option chain in a compact format to minimize response size.",
    {
      symbol: z.string().describe("The underlying symbol (e.g., 'AAPL')"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const chain = await getClient().instrumentsService.getCompactOptionChain(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(chain, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_futures",
    "Get futures instrument definitions.",
    {
      symbols: z.array(z.string()).optional().describe("Array of futures symbols to look up"),
      productCode: z.string().optional().describe("Product code to filter by (e.g., 'ES')"),
    },
    READ_ONLY,
    async ({ symbols, productCode }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (symbols) queryParams.symbol = symbols;
        if (productCode) queryParams["product-code"] = productCode;
        const futures = await getClient().instrumentsService.getFutures(queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(futures, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_single_future",
    "Get a single futures instrument definition by symbol.",
    {
      symbol: z.string().describe("The futures symbol (e.g., '/ESZ4')"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const future = await getClient().instrumentsService.getSingleFuture(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(future, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_future_option_chain",
    "Get the futures option chain for a product code.",
    {
      symbol: z.string().describe("The futures product code (e.g., 'ES')"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const chain = await getClient().instrumentsService.getFutureOptionChain(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(chain, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_nested_future_option_chain",
    "Get futures option chain in nested format for a product code. Use call-streamer-symbol/put-streamer-symbol for market data subscriptions.",
    {
      symbol: z.string().describe("The futures product code (e.g., 'ES')"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const chain = await getClient().instrumentsService.getNestedFutureOptionChains(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(chain, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_future_options",
    "Get future option instruments. Uses TW symbology.",
    {
      symbols: z.array(z.string()).optional().describe("Array of future option symbols in TW format"),
    },
    READ_ONLY,
    async ({ symbols }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (symbols) queryParams.symbol = symbols;
        const options = await getClient().instrumentsService.getFutureOptions(queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(options, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_single_future_option",
    "Get a single future option by symbol (TW symbology).",
    {
      symbol: z.string().describe("The future option symbol in TW format"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const option = await getClient().instrumentsService.getSingleFutureOption(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(option, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_futures_products",
    "Get metadata for all supported futures products.",
    {},
    READ_ONLY,
    async () => {
      try {
        const products = await getClient().instrumentsService.getFuturesProducts();
        return { content: [{ type: "text" as const, text: JSON.stringify(products, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_single_future_product",
    "Get a single futures product by exchange and code.",
    {
      exchange: z.string().describe("The exchange (e.g., 'CME')"),
      code: z.string().describe("The product code (e.g., 'ES')"),
    },
    READ_ONLY,
    async ({ exchange, code }) => {
      try {
        const product = await getClient().instrumentsService.getSingleFutureProduct(exchange, code);
        return { content: [{ type: "text" as const, text: JSON.stringify(product, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_future_option_products",
    "Get metadata for all supported future option products.",
    {},
    READ_ONLY,
    async () => {
      try {
        const products = await getClient().instrumentsService.getFutureOptionsProducts();
        return { content: [{ type: "text" as const, text: JSON.stringify(products, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_single_future_option_product",
    "Get a future option product by exchange and root symbol.",
    {
      exchange: z.string().describe("The exchange (e.g., 'CME')"),
      rootSymbol: z.string().describe("The root symbol (e.g., 'ES')"),
    },
    READ_ONLY,
    async ({ exchange, rootSymbol }) => {
      try {
        const product = await getClient().instrumentsService.getSingleFutureOptionProduct(exchange, rootSymbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(product, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_cryptocurrencies",
    "Get cryptocurrency instrument definitions.",
    {
      symbols: z.array(z.string()).optional().describe("Array of cryptocurrency symbols to look up"),
    },
    READ_ONLY,
    async ({ symbols }) => {
      try {
        const cryptos = await getClient().instrumentsService.getCryptocurrencies(symbols || []);
        return { content: [{ type: "text" as const, text: JSON.stringify(cryptos, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_single_cryptocurrency",
    "Get a single cryptocurrency instrument by symbol.",
    {
      symbol: z.string().describe("The cryptocurrency symbol (e.g., 'BTC/USD')"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const crypto = await getClient().instrumentsService.getSingleCryptocurrency(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(crypto, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_warrants",
    "Get warrant instrument definitions.",
    {
      symbols: z.array(z.string()).optional().describe("Array of warrant symbols to look up"),
    },
    READ_ONLY,
    async ({ symbols }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (symbols) queryParams.symbol = symbols;
        const warrants = await getClient().instrumentsService.getWarrants(queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(warrants, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_single_warrant",
    "Get a single warrant instrument by symbol.",
    {
      symbol: z.string().describe("The warrant symbol"),
    },
    READ_ONLY,
    async ({ symbol }) => {
      try {
        const warrant = await getClient().instrumentsService.getSingleWarrant(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(warrant, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_quantity_decimal_precisions",
    "Get all quantity decimal precisions for instruments.",
    {},
    READ_ONLY,
    async () => {
      try {
        const precisions = await getClient().instrumentsService.getQuantityDecimalPrecisions();
        return { content: [{ type: "text" as const, text: JSON.stringify(precisions, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "search_symbols",
    "Search for symbols by text query.",
    {
      query: z.string().describe("The search query text"),
    },
    READ_ONLY,
    async ({ query }) => {
      try {
        const results = await getClient().symbolSearchService.getSymbolData(query);
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
