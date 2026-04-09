export type ToolCategory =
  | "Account"
  | "Orders"
  | "Market Data"
  | "Instruments"
  | "Watchlists"
  | "Risk"
  | "Auth";

export interface ToolEntry {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: Record<string, any>;
  annotations?: Record<string, any>;
}

const TOOL_REGISTRY: ToolEntry[] = [
  // ── Auth ──────────────────────────────────────────────────────────────────
  {
    name: "check_auth_status",
    description: "Check if the TastyTrade client is currently authenticated and reconnect if needed.",
    category: "Auth",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "disconnect",
    description: "Disconnect from TastyTrade and clean up all connections.",
    category: "Auth",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },

  // ── Account ───────────────────────────────────────────────────────────────
  {
    name: "get_account_info",
    description: "Retrieve account and customer information. Supports detail levels: customer_accounts (list all accounts), customer_resource (customer profile), full_account (full account details), account_status (trading status and permissions).",
    category: "Account",
    inputSchema: {
      type: "object",
      properties: {
        detail: {
          type: "string",
          enum: ["customer_accounts", "customer_resource", "full_account", "account_status"],
          description: "Level of account detail to retrieve.",
        },
        accountNumber: {
          type: "string",
          description: "Account number — required for full_account and account_status detail levels.",
        },
      },
      required: ["detail"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_account_balances",
    description: "Get current balance values for an account including cash, equity, and buying power.",
    category: "Account",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number to get balances for" },
      },
      required: ["accountNumber"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_positions",
    description: "Get all current positions for an account. Can be filtered by symbol or underlying symbol.",
    category: "Account",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number to get positions for" },
        symbol: { type: "string", description: "Filter positions by specific symbol" },
        underlyingSymbol: { type: "string", description: "Filter positions by underlying symbol" },
      },
      required: ["accountNumber"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_balance_snapshots",
    description: "Get balance snapshots for an account showing historical balance data.",
    category: "Account",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number to get snapshots for" },
        timeOfDay: { type: "string", description: "Time of day for snapshot (e.g., 'BOD' for beginning of day, 'EOD' for end of day)" },
      },
      required: ["accountNumber"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_transactions",
    description: "Get a paginated list of transactions for an account.",
    category: "Account",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        perPage: { type: "number", description: "Number of transactions per page" },
        pageOffset: { type: "number", description: "Page offset for pagination" },
        sort: { type: "string", description: "Sort direction ('Asc' or 'Desc')" },
        type: { type: "string", description: "Filter by transaction type" },
        subType: { type: "string", description: "Filter by transaction sub-type" },
        startDate: { type: "string", description: "Start date in YYYY-MM-DD format" },
        endDate: { type: "string", description: "End date in YYYY-MM-DD format" },
        symbol: { type: "string", description: "Filter by symbol" },
      },
      required: ["accountNumber"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_transaction",
    description: "Get a specific transaction by ID.",
    category: "Account",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        transactionId: { type: "string", description: "The transaction ID" },
      },
      required: ["accountNumber", "transactionId"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_total_fees",
    description: "Get the total fees for an account for the current day.",
    category: "Account",
    inputSchema: {
      type: "object",
      properties: { accountNumber: { type: "string", description: "The account number" } },
      required: ["accountNumber"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },

  // ── Orders ────────────────────────────────────────────────────────────────
  {
    name: "query_orders",
    description: "Retrieve orders for an account or customer. Scope controls what is returned: account_live (live orders), account_history (order history), account_single (one order by ID), customer_live (live across all accounts), customer_history (all orders for a customer).",
    category: "Orders",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["account_live", "account_history", "account_single", "customer_live", "customer_history"],
          description: "Query scope.",
        },
        accountNumber: { type: "string", description: "Account number — required for account_live, account_history, account_single." },
        orderId: { type: "number", description: "Order ID — required for account_single." },
        customerId: { type: "string", description: "Customer ID — required for customer_live and customer_history." },
        status: { type: "string", description: "Filter by order status (e.g. 'Filled', 'Cancelled', 'Live') — for account_history." },
        perPage: { type: "number", description: "Number of orders per page — for account_history and customer_history." },
        pageOffset: { type: "number", description: "Page offset — for account_history and customer_history." },
      },
      required: ["scope"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "order_dry_run",
    description: "Validate an order without actually placing it. Returns preflight information including fees, buying power effect, and warnings.",
    category: "Orders",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        orderJson: { type: "string", description: "JSON string of the order object to validate" },
      },
      required: ["accountNumber", "orderJson"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "replacement_order_dry_run",
    description: "Run preflight checks for a replacement order without executing it.",
    category: "Orders",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        orderId: { type: "number", description: "The order ID to check replacement for" },
        replacementOrderJson: { type: "string", description: "JSON string of the replacement order" },
      },
      required: ["accountNumber", "orderId", "replacementOrderJson"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "create_order",
    description: "Create and submit a new order. Use order_dry_run first to validate.",
    category: "Orders",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number to place the order in" },
        orderJson: { type: "string", description: "JSON string of the order object with fields like time-in-force, order-type, legs, price, etc." },
      },
      required: ["accountNumber", "orderJson"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "cancel_order",
    description: "Cancel a live order.",
    category: "Orders",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        orderId: { type: "number", description: "The order ID to cancel" },
      },
      required: ["accountNumber", "orderId"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "replace_order",
    description: "Replace a live order with a new one.",
    category: "Orders",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        orderId: { type: "number", description: "The order ID to replace" },
        replacementOrderJson: { type: "string", description: "JSON string of the replacement order" },
      },
      required: ["accountNumber", "orderId", "replacementOrderJson"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "edit_order",
    description: "Edit price and execution properties of a live order.",
    category: "Orders",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        orderId: { type: "number", description: "The order ID to edit" },
        editJson: { type: "string", description: "JSON string with the fields to edit (e.g., price)" },
      },
      required: ["accountNumber", "orderId", "editJson"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "create_complex_order",
    description: "Create a complex (multi-leg) order such as spreads, straddles, etc.",
    category: "Orders",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        orderJson: { type: "string", description: "JSON string of the complex order object" },
      },
      required: ["accountNumber", "orderJson"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "cancel_complex_order",
    description: "Cancel a complex (multi-leg) order.",
    category: "Orders",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        orderId: { type: "number", description: "The complex order ID to cancel" },
      },
      required: ["accountNumber", "orderId"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "reconfirm_order",
    description: "Reconfirm an existing order.",
    category: "Orders",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        orderId: { type: "number", description: "The order ID to reconfirm" },
      },
      required: ["accountNumber", "orderId"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },

  // ── Instruments ───────────────────────────────────────────────────────────
  {
    name: "get_instrument",
    description: "Look up instrument definitions by type. Supports equities, equity options, option chains, futures, future options, future option chains, cryptocurrencies, warrants, and quantity decimal precisions. Use the 'type' parameter to specify which instrument type to retrieve.",
    category: "Instruments",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: [
            "equity", "equity_definitions", "active_equities",
            "equity_option", "equity_options",
            "option_chain", "nested_option_chain", "compact_option_chain",
            "future", "futures", "futures_products", "future_product",
            "future_option", "future_options", "future_option_chain", "nested_future_option_chain",
            "future_option_products", "future_option_product",
            "cryptocurrency", "cryptocurrencies",
            "warrant", "warrants",
            "quantity_decimal_precisions",
          ],
          description: "The instrument type/operation to look up.",
        },
        symbol: {
          type: "string",
          description: "Symbol — required for: equity, equity_option, option_chain, nested_option_chain, compact_option_chain, future, future_option, future_option_chain, nested_future_option_chain, cryptocurrency, warrant.",
        },
        symbols: {
          type: "array",
          items: { type: "string" },
          description: "Array of symbols — used for equity_definitions, equity_options, futures, future_options, cryptocurrencies, warrants.",
        },
        lendability: { type: "string", description: "Lendability filter for equity_definitions: 'Easy To Borrow', 'Locate Required', or 'Preborrow'." },
        active: { type: "boolean", description: "For equity_options: only return active options (default true)." },
        withExpired: { type: "boolean", description: "For equity_options: include expired options (default false)." },
        productCode: { type: "string", description: "Futures product code filter for type 'futures' (e.g. 'ES')." },
        exchange: { type: "string", description: "Exchange for future_product or future_option_product (e.g. 'CME')." },
        code: { type: "string", description: "Product code for future_product (e.g. 'ES')." },
        rootSymbol: { type: "string", description: "Root symbol for future_option_product (e.g. 'ES')." },
        perPage: { type: "number", description: "Results per page — used for active_equities." },
        pageOffset: { type: "number", description: "Page offset for pagination — used for active_equities." },
      },
      required: ["type"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "search_symbols",
    description: "Search for symbols by text query.",
    category: "Instruments",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "The search query text" } },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },

  // ── Market Data ───────────────────────────────────────────────────────────
  {
    name: "get_market_metrics",
    description: "Get market metrics (volatility data, IV rank, IV percentile) for given symbols. Includes options Greeks data like implied volatility.",
    category: "Market Data",
    inputSchema: {
      type: "object",
      properties: {
        symbols: { type: "array", items: { type: "string" }, description: "Array of symbols to get market metrics for (e.g., ['AAPL', 'TSLA'])" },
      },
      required: ["symbols"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_historical_dividends",
    description: "Get historical dividend data for a symbol.",
    category: "Market Data",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string", description: "The symbol to get dividend history for (e.g., 'AAPL')" } },
      required: ["symbol"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_historical_earnings",
    description: "Get historical earnings data for a symbol.",
    category: "Market Data",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "The symbol to get earnings history for (e.g., 'AAPL')" },
        startDate: { type: "string", description: "Start date in YYYY-MM-DD format" },
      },
      required: ["symbol"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_quote",
    description: "Get real-time quote data for one or more symbols using DXLink. Returns bid, ask, last price, volume, and other quote fields.",
    category: "Market Data",
    inputSchema: {
      type: "object",
      properties: {
        symbols: { type: "array", items: { type: "string" }, description: "Array of symbols to get quotes for (e.g., ['AAPL', 'TSLA'])" },
        timeoutMs: { type: "number", description: "Timeout in milliseconds to wait for quotes (default 5000)" },
      },
      required: ["symbols"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_candles",
    description: "Get candlestick chart data for technical analysis. Retrieves OHLCV candle data via DXLink.",
    category: "Market Data",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "The symbol to get candles for (e.g., 'AAPL')" },
        periodMinutes: { type: "number", description: "Candle period in minutes (e.g., 1, 5, 15, 30, 60)" },
        daysBack: { type: "number", description: "Number of days of historical data to fetch" },
        timeoutMs: { type: "number", description: "Timeout in milliseconds to wait for candle data (default 8000)" },
      },
      required: ["symbol"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_options_greeks",
    description: "Get options Greeks (delta, gamma, theta, vega, rho) by subscribing to Greeks events via DXLink for specific option symbols.",
    category: "Market Data",
    inputSchema: {
      type: "object",
      properties: {
        optionSymbols: { type: "array", items: { type: "string" }, description: "Array of option streamer symbols. Use call-streamer-symbol or put-streamer-symbol from option chain endpoints." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds to wait for Greeks data (default 5000)" },
      },
      required: ["optionSymbols"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_api_quote_token",
    description: "Get the quote streamer authentication token and endpoint for DXLink market data access.",
    category: "Market Data",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },

  // ── Watchlists ────────────────────────────────────────────────────────────
  {
    name: "manage_watchlist",
    description: "Manage user account watchlists. Actions: list (get all), get (by name), create (new watchlist), replace (update existing), delete (remove watchlist).",
    category: "Watchlists",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "get", "create", "replace", "delete"],
          description: "Action to perform on user watchlists.",
        },
        watchlistName: { type: "string", description: "Watchlist name — required for get, replace, and delete actions." },
        watchlistJson: { type: "string", description: "JSON string of watchlist object — required for create and replace actions." },
      },
      required: ["action"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "manage_public_watchlist",
    description: "Access TastyTrade public and pairs watchlists. Actions: list_public, get_public (by name), list_pairs, get_pairs (by name).",
    category: "Watchlists",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list_public", "get_public", "list_pairs", "get_pairs"],
          description: "Action: list or get public/pairs watchlists.",
        },
        watchlistName: { type: "string", description: "Watchlist name — required for get_public and get_pairs actions." },
        countsOnly: { type: "boolean", description: "For list_public only — return only counts instead of full data." },
      },
      required: ["action"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },

  // ── Risk ──────────────────────────────────────────────────────────────────
  {
    name: "get_margin_requirements",
    description: "Get margin/capital requirements report for an account.",
    category: "Risk",
    inputSchema: {
      type: "object",
      properties: { accountNumber: { type: "string", description: "The account number" } },
      required: ["accountNumber"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "estimate_margin_requirements",
    description: "Estimate margin requirements for an order (dry run) given an account.",
    category: "Risk",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        orderJson: { type: "string", description: "JSON string of the order to estimate margin for" },
      },
      required: ["accountNumber", "orderJson"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_effective_margin_requirements",
    description: "Get effective margin requirements for a specific underlying symbol in an account.",
    category: "Risk",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        underlyingSymbol: { type: "string", description: "The underlying symbol to get margin requirements for" },
      },
      required: ["accountNumber", "underlyingSymbol"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_position_limit",
    description: "Get the position limit for an account.",
    category: "Risk",
    inputSchema: {
      type: "object",
      properties: { accountNumber: { type: "string", description: "The account number" } },
      required: ["accountNumber"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_net_liq_history",
    description: "Get net liquidating value history for an account over time.",
    category: "Risk",
    inputSchema: {
      type: "object",
      properties: {
        accountNumber: { type: "string", description: "The account number" },
        timeBack: { type: "string", description: "Time period to look back (e.g., '1d', '1m', '3m', '1y', 'all')" },
      },
      required: ["accountNumber"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_net_liq_value",
    description: "Get the current net liquidating value for an account.",
    category: "Risk",
    inputSchema: {
      type: "object",
      properties: { accountNumber: { type: "string", description: "The account number" } },
      required: ["accountNumber"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

export function getAllTools(): ToolEntry[] {
  return TOOL_REGISTRY;
}

export function getToolByName(name: string): ToolEntry | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

export function searchTools(query: string): ToolEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return TOOL_REGISTRY;

  const scored = TOOL_REGISTRY.map((tool) => {
    const haystack = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (tool.name.toLowerCase().includes(term)) score += 3;
      else if (haystack.includes(term)) score += 1;
    }
    return { tool, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.tool);
}

export function getCategoryStats(): Array<{ category: ToolCategory; count: number }> {
  const counts = new Map<ToolCategory, number>();
  for (const tool of TOOL_REGISTRY) {
    counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => a.category.localeCompare(b.category));
}
