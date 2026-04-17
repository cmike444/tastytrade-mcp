import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";
import { formatApiError } from "./error-utils.js";
import { coerceToArray } from "./schema-utils.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

type DetailTier = "summary" | "standard" | "full";

const OPTION_CHAIN_SUMMARY_FIELDS = [
  "symbol", "expiration-date", "option-type", "strike-price", "root-symbol"
];
const OPTION_CHAIN_STANDARD_FIELDS = [
  "symbol", "root-symbol", "underlying-symbol", "expiration-date", "option-type",
  "strike-price", "expiration-type", "exercise-style", "days-to-expiration",
  "call-streamer-symbol", "put-streamer-symbol", "active", "listed-market"
];

function projectOptionChainItem(item: any, detail: DetailTier): any {
  if (detail === "full") return item;
  const fields = detail === "summary" ? OPTION_CHAIN_SUMMARY_FIELDS : OPTION_CHAIN_STANDARD_FIELDS;
  const result: Record<string, any> = {};
  for (const field of fields) {
    if (item[field] !== undefined) result[field] = item[field];
  }
  return result;
}

function applyOptionChainProjection(data: any, limit: number, detail: DetailTier): any {
  if (detail === "full" && limit === 0) return data;

  let items: any[] = [];

  if (Array.isArray(data)) {
    items = data;
  } else if (data?.data?.items) {
    items = data.data.items;
    const sliced = limit > 0 ? items.slice(0, limit) : items;
    return { data: { items: sliced.map((i: any) => projectOptionChainItem(i, detail)), pagination: data.data.pagination }, context: data.context };
  } else if (data?.items) {
    items = data.items;
    const sliced = limit > 0 ? items.slice(0, limit) : items;
    return { items: sliced.map((i: any) => projectOptionChainItem(i, detail)), pagination: data.pagination };
  } else {
    return detail === "full" ? data : projectOptionChainItem(data, detail);
  }

  const sliced = limit > 0 ? items.slice(0, limit) : items;
  return sliced.map((i: any) => projectOptionChainItem(i, detail));
}

export function registerInstrumentTools(server: McpServer) {
  server.tool(
    "get_instrument",
    "Look up instrument definitions from TastyTrade across all supported asset classes. The 'type' enum selects the instrument class and operation to perform. Each parameter's description lists which types require or accept it.",
    {
      type: z.enum([
        "equity",
        "equity_definitions",
        "active_equities",
        "equity_option",
        "equity_options",
        "option_chain",
        "nested_option_chain",
        "compact_option_chain",
        "future",
        "futures",
        "futures_products",
        "future_product",
        "future_option",
        "future_options",
        "future_option_chain",
        "nested_future_option_chain",
        "future_option_products",
        "future_option_product",
        "cryptocurrency",
        "cryptocurrencies",
        "warrant",
        "warrants",
        "quantity_decimal_precisions",
      ]).describe(
        "Instrument class and operation to perform. Each parameter's description lists which types require or accept it."
      ),
      symbol: z.string().optional().describe(
        "Symbol for the instrument. Required for: equity, equity_option, option_chain, nested_option_chain, compact_option_chain, future, future_option, future_option_chain, nested_future_option_chain, cryptocurrency, warrant."
      ),
      symbols: z.preprocess(coerceToArray, z.array(z.string()).optional()).describe(
        "Array of symbols — used for equity_definitions, equity_options, futures, future_options, cryptocurrencies, warrants."
      ),
      lendability: z.string().optional().describe(
        "Lendability filter for equity_definitions: 'Easy To Borrow', 'Locate Required', or 'Preborrow'."
      ),
      active: z.boolean().default(true).describe("For equity_options: only return active options (default true)."),
      withExpired: z.boolean().default(false).describe("For equity_options: include expired options (default false)."),
      productCode: z.string().optional().describe("Futures product code filter for type 'futures' (e.g. 'ES')."),
      exchange: z.string().optional().describe("Exchange for future_product or future_option_product (e.g. 'CME')."),
      code: z.string().optional().describe("Product code for future_product (e.g. 'ES')."),
      rootSymbol: z.string().optional().describe("Root symbol for future_option_product (e.g. 'ES')."),
      perPage: z.number().optional().describe("Results per page — used for active_equities."),
      pageOffset: z.number().optional().describe("Page offset for pagination — used for active_equities."),
      limit: z.number().default(50).describe("For option_chain: maximum number of option records to return (default 50, set to 0 for no limit)."),
      detail: z.enum(["summary", "standard", "full"]).default("standard").describe("For option_chain: response detail level — 'summary' (5 fields), 'standard' (common trading fields, default), 'full' (complete raw payload)."),
    },
    READ_ONLY,
    async ({ type, symbol, symbols, lendability, active, withExpired, productCode, exchange, code, rootSymbol, perPage, pageOffset, limit, detail }) => {
      try {
        const svc = getClient().instrumentsService;
        let result: any;

        if (type === "equity") {
          if (!symbol) throw new Error("symbol is required for type 'equity'");
          result = await svc.getSingleEquity(symbol);
        } else if (type === "equity_definitions") {
          const params: Record<string, any> = {};
          if (symbols) params.symbol = symbols;
          if (lendability) params.lendability = lendability;
          result = await svc.getEquityDefinitions(params);
        } else if (type === "active_equities") {
          const params: Record<string, any> = {};
          if (perPage) params["per-page"] = perPage;
          if (pageOffset) params["page-offset"] = pageOffset;
          result = await svc.getActiveEquities(params);
        } else if (type === "equity_option") {
          if (!symbol) throw new Error("symbol is required for type 'equity_option'");
          result = await svc.getSingleEquityOption(symbol);
        } else if (type === "equity_options") {
          if (!symbols || symbols.length === 0) throw new Error("symbols array is required for type 'equity_options'");
          result = await svc.getEquityOptions(symbols, active, withExpired);
        } else if (type === "option_chain") {
          if (!symbol) throw new Error("symbol is required for type 'option_chain'");
          result = await svc.getOptionChain(symbol);
        } else if (type === "nested_option_chain") {
          if (!symbol) throw new Error("symbol is required for type 'nested_option_chain'");
          result = await svc.getNestedOptionChain(symbol);
        } else if (type === "compact_option_chain") {
          if (!symbol) throw new Error("symbol is required for type 'compact_option_chain'");
          result = await svc.getCompactOptionChain(symbol);
        } else if (type === "future") {
          if (!symbol) throw new Error("symbol is required for type 'future'");
          result = await svc.getSingleFuture(symbol);
        } else if (type === "futures") {
          const params: Record<string, any> = {};
          if (symbols) params.symbol = symbols;
          if (productCode) params["product-code"] = productCode;
          result = await svc.getFutures(params);
        } else if (type === "futures_products") {
          result = await svc.getFuturesProducts();
        } else if (type === "future_product") {
          if (!exchange) throw new Error("exchange is required for type 'future_product'");
          if (!code) throw new Error("code is required for type 'future_product'");
          result = await svc.getSingleFutureProduct(exchange, code);
        } else if (type === "future_option") {
          if (!symbol) throw new Error("symbol is required for type 'future_option'");
          result = await svc.getSingleFutureOption(symbol);
        } else if (type === "future_options") {
          const params: Record<string, any> = {};
          if (symbols) params.symbol = symbols;
          result = await svc.getFutureOptions(params);
        } else if (type === "future_option_chain") {
          if (!symbol) throw new Error("symbol (product code) is required for type 'future_option_chain'");
          result = await svc.getFutureOptionChain(symbol);
        } else if (type === "nested_future_option_chain") {
          if (!symbol) throw new Error("symbol (product code) is required for type 'nested_future_option_chain'");
          result = await svc.getNestedFutureOptionChains(symbol);
        } else if (type === "future_option_products") {
          result = await svc.getFutureOptionsProducts();
        } else if (type === "future_option_product") {
          if (!exchange) throw new Error("exchange is required for type 'future_option_product'");
          if (!rootSymbol) throw new Error("rootSymbol is required for type 'future_option_product'");
          result = await svc.getSingleFutureOptionProduct(exchange, rootSymbol);
        } else if (type === "cryptocurrency") {
          if (!symbol) throw new Error("symbol is required for type 'cryptocurrency'");
          result = await svc.getSingleCryptocurrency(symbol);
        } else if (type === "cryptocurrencies") {
          result = await svc.getCryptocurrencies(symbols || []);
        } else if (type === "warrant") {
          if (!symbol) throw new Error("symbol is required for type 'warrant'");
          result = await svc.getSingleWarrant(symbol);
        } else if (type === "warrants") {
          const params: Record<string, any> = {};
          if (symbols) params.symbol = symbols;
          result = await svc.getWarrants(params);
        } else if (type === "quantity_decimal_precisions") {
          result = await svc.getQuantityDecimalPrecisions();
        }

        if (type === "option_chain") {
          result = applyOptionChainProjection(result, limit, detail);
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
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
        return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );
}
