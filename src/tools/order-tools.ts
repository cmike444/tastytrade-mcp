import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";
import { formatApiError } from "./error-utils.js";
import { coerceToArray } from "./schema-utils.js";
import { extractItems } from "./render-utils.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

const OrderLegSchema = z.object({
  "instrument-type": z.string().describe("Instrument type (e.g. 'Equity', 'Equity Option', 'Future', 'Future Option')"),
  symbol: z.string().describe("Symbol for the instrument (e.g. 'AAPL', 'AAPL  250117C00200000')"),
  action: z.string().describe("Order action (e.g. 'Buy to Open', 'Sell to Open', 'Buy to Close', 'Sell to Close')"),
  quantity: z.number().describe("Number of contracts or shares"),
  "ratio-quantity": z.number().optional().describe("Ratio quantity for complex orders"),
});

const OrderSchema = z.object({
  "time-in-force": z.string().describe("Time in force (e.g. 'Day', 'GTC', 'GTD', 'Ext', 'GTC Ext', 'IOC')"),
  "order-type": z.string().describe("Order type (e.g. 'Limit', 'Market', 'Stop', 'Stop Limit', 'Notional Market')"),
  price: z.number().optional().describe("Limit price for the order (required for Limit and Stop Limit orders)"),
  "price-effect": z.string().optional().describe("Price effect: 'Debit' (buying) or 'Credit' (selling)"),
  legs: z.preprocess(coerceToArray, z.array(OrderLegSchema)).describe("Array of order legs"),
});

const ReplacementOrderSchema = z.object({
  "time-in-force": z.string().describe("Time in force (e.g. 'Day', 'GTC', 'GTD', 'Ext', 'GTC Ext', 'IOC')"),
  "order-type": z.string().describe("Order type (e.g. 'Limit', 'Market', 'Stop', 'Stop Limit')"),
  price: z.number().optional().describe("Limit price for the replacement order"),
  "price-effect": z.string().optional().describe("Price effect: 'Debit' or 'Credit'"),
  legs: z.preprocess(coerceToArray, z.array(OrderLegSchema)).describe("Array of order legs"),
});

const OrderEditSchema = z.object({
  price: z.number().describe("New limit price for the order"),
  "price-effect": z.string().optional().describe("Price effect: 'Debit' or 'Credit'"),
});

const ComplexOrderLegSchema = z.object({
  "instrument-type": z.string().describe("Instrument type (e.g. 'Equity Option', 'Future Option')"),
  symbol: z.string().describe("Symbol for the instrument"),
  action: z.string().describe("Order action (e.g. 'Buy to Open', 'Sell to Open', 'Buy to Close', 'Sell to Close')"),
  quantity: z.number().describe("Number of contracts"),
  "ratio-quantity": z.number().optional().describe("Ratio quantity for this leg"),
});

const SingleComplexOrderSchema = z.object({
  "time-in-force": z.string().describe("Time in force (e.g. 'Day', 'GTC')"),
  "order-type": z.string().describe("Order type (e.g. 'Limit', 'Market', 'Net Credit', 'Net Debit')"),
  price: z.number().optional().describe("Net price for this order"),
  "price-effect": z.string().optional().describe("Price effect: 'Debit' or 'Credit'"),
  "stop-trigger": z.number().optional().describe("Stop trigger price (for Stop or Stop Limit order-type)"),
  legs: z.preprocess(coerceToArray, z.array(ComplexOrderLegSchema)).describe("Array of order legs"),
});

export function registerOrderTools(server: McpServer) {
  server.tool(
    "query_orders",
    [
      "Retrieve orders for an account or customer. Scope and filter via parameters:",
      "  scope='account_live' — Live (active) orders for a specific account (requires accountNumber).",
      "  scope='account_history' — Paginated order history for an account (requires accountNumber; optional status, perPage, pageOffset).",
      "  scope='account_single' — Single order by ID (requires accountNumber and orderId).",
      "  scope='customer_live' — Live orders across all accounts for a customer (requires customerId).",
      "  scope='customer_history' — Paginated order history for a customer (requires customerId; optional perPage, pageOffset).",
      "Status filter examples: 'Filled', 'Cancelled', 'Live', 'Received', 'Rejected'.",
    ].join("\n"),
    {
      scope: z.enum([
        "account_live",
        "account_history",
        "account_single",
        "customer_live",
        "customer_history",
      ]).describe(
        "Query scope: 'account_live' (live orders for account), 'account_history' (all orders for account), 'account_single' (one order by ID), 'customer_live' (live across all accounts), 'customer_history' (all orders for customer)."
      ),
      accountNumber: z.string().optional().describe("Account number — required for account_live, account_history, account_single scopes."),
      orderId: z.number().optional().describe("Order ID — required for account_single scope."),
      customerId: z.string().optional().describe("Customer ID — required for customer_live and customer_history scopes."),
      status: z.string().optional().describe("Filter by order status (e.g. 'Filled', 'Cancelled', 'Live') — applies to account_history scope."),
      perPage: z.number().optional().describe("Number of orders per page — applies to account_history and customer_history scopes."),
      pageOffset: z.number().optional().describe("Page offset for pagination — applies to account_history and customer_history scopes."),
    },
    READ_ONLY,
    async ({ scope, accountNumber, orderId, customerId, status, perPage, pageOffset }) => {
      try {
        const svc = getClient().orderService;
        let result: any;

        if (scope === "account_live") {
          if (!accountNumber) throw new Error("accountNumber is required for scope 'account_live'");
          result = await svc.getLiveOrders(accountNumber);
        } else if (scope === "account_history") {
          if (!accountNumber) throw new Error("accountNumber is required for scope 'account_history'");
          const params: Record<string, any> = {};
          if (perPage) params["per-page"] = perPage;
          if (pageOffset) params["page-offset"] = pageOffset;
          if (status) params.status = status;
          result = await svc.getOrders(accountNumber, params);
        } else if (scope === "account_single") {
          if (!accountNumber) throw new Error("accountNumber is required for scope 'account_single'");
          if (orderId === undefined) throw new Error("orderId is required for scope 'account_single'");
          result = await svc.getOrder(accountNumber, orderId);
        } else if (scope === "customer_live") {
          if (!customerId) throw new Error("customerId is required for scope 'customer_live'");
          result = await svc.getLiveOrdersForCustomer(customerId);
        } else if (scope === "customer_history") {
          if (!customerId) throw new Error("customerId is required for scope 'customer_history'");
          const params: Record<string, any> = {};
          if (perPage) params["per-page"] = perPage;
          if (pageOffset) params["page-offset"] = pageOffset;
          result = await svc.getCustomerOrders(customerId, params);
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "order_dry_run",
    [
      "Validate a single-leg simple order without actually placing it.",
      "Use ONLY for simple order types: Limit, Market, Stop, Stop Limit, Notional Market.",
      "For multi-leg complex orders (spreads, straddles, condors, calendars) with Net Debit / Net Credit order types,",
      "use complex_order_dry_run instead — this endpoint rejects those order types.",
      "Returns preflight information including fees, buying power effect, and warnings.",
    ].join(" "),
    {
      accountNumber: z.string().describe("The account number"),
      "time-in-force": OrderSchema.shape["time-in-force"],
      "order-type": OrderSchema.shape["order-type"],
      price: OrderSchema.shape.price,
      "price-effect": OrderSchema.shape["price-effect"],
      legs: OrderSchema.shape.legs,
    },
    READ_ONLY,
    async ({ accountNumber, ...orderFields }) => {
      try {
        const order = orderFields;
        const result = await getClient().orderService.postOrderDryRun(accountNumber, order);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "replacement_order_dry_run",
    "Run preflight checks for a replacement order without executing it.",
    {
      accountNumber: z.string().describe("The account number"),
      orderId: z.number().describe("The order ID to check replacement for"),
      "time-in-force": ReplacementOrderSchema.shape["time-in-force"],
      "order-type": ReplacementOrderSchema.shape["order-type"],
      price: ReplacementOrderSchema.shape.price,
      "price-effect": ReplacementOrderSchema.shape["price-effect"],
      legs: ReplacementOrderSchema.shape.legs,
    },
    READ_ONLY,
    async ({ accountNumber, orderId, ...replacementFields }) => {
      try {
        const replacementOrder = replacementFields;
        const result = await getClient().orderService.replacementOrderDryRun(accountNumber, orderId, replacementOrder);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "create_order",
    "Create and submit a new order. Use order_dry_run first to validate.",
    {
      accountNumber: z.string().describe("The account number to place the order in"),
      "time-in-force": OrderSchema.shape["time-in-force"],
      "order-type": OrderSchema.shape["order-type"],
      price: OrderSchema.shape.price,
      "price-effect": OrderSchema.shape["price-effect"],
      legs: OrderSchema.shape.legs,
    },
    DESTRUCTIVE,
    async ({ accountNumber, ...orderFields }) => {
      try {
        const order = orderFields;
        const result = await getClient().orderService.createOrder(accountNumber, order);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "cancel_order",
    "Cancel a live order.",
    {
      accountNumber: z.string().describe("The account number"),
      orderId: z.number().describe("The order ID to cancel"),
    },
    DESTRUCTIVE,
    async ({ accountNumber, orderId }) => {
      try {
        const result = await getClient().orderService.cancelOrder(accountNumber, orderId);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "replace_order",
    "Replace a live order with a new one.",
    {
      accountNumber: z.string().describe("The account number"),
      orderId: z.number().describe("The order ID to replace"),
      "time-in-force": ReplacementOrderSchema.shape["time-in-force"],
      "order-type": ReplacementOrderSchema.shape["order-type"],
      price: ReplacementOrderSchema.shape.price,
      "price-effect": ReplacementOrderSchema.shape["price-effect"],
      legs: ReplacementOrderSchema.shape.legs,
    },
    DESTRUCTIVE,
    async ({ accountNumber, orderId, ...replacementFields }) => {
      try {
        const replacementOrder = replacementFields;
        const result = await getClient().orderService.replaceOrder(accountNumber, orderId, replacementOrder);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "edit_order",
    "Edit price and execution properties of a live order.",
    {
      accountNumber: z.string().describe("The account number"),
      orderId: z.number().describe("The order ID to edit"),
      price: OrderEditSchema.shape.price,
      "price-effect": OrderEditSchema.shape["price-effect"],
    },
    DESTRUCTIVE,
    async ({ accountNumber, orderId, ...editFields }) => {
      try {
        const edit = editFields;
        const result = await getClient().orderService.editOrder(accountNumber, orderId, edit);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "complex_order_dry_run",
    [
      "Validate an OCO, OTOCO, or OTO bracket order without placing it.",
      "Returns preflight information including fees, buying power effect, and warnings.",
      "",
      "ROUTING NOTE: This tool is ONLY for bracket order types (OCO / OTOCO / OTO).",
      "Multi-leg spreads, straddles, strangles, condors, and calendars are NOT complex orders —",
      "submit them via order_dry_run or create_order with multiple legs in a single order.",
      "",
      "  type='OCO'   — two closing orders; first fill cancels the other (profit target + stop)",
      "  type='OTOCO' — entry order (in trigger-order) triggers a bracket (orders array)",
      "  type='OTO'   — one order triggers another when filled",
      "",
      "Example (OCO bracket for an existing short strangle):",
      '  { "type": "OCO", "orders": [',
      '    { "time-in-force": "GTC", "order-type": "Limit", "price": -2.75, "legs": [...close legs...] },',
      '    { "time-in-force": "GTC", "order-type": "Limit", "price": -11.00, "legs": [...same close legs...] }',
      '  ] }',
    ].join("\n"),
    {
      accountNumber: z.string().describe("The account number"),
      type: z.enum(["OCO", "OTOCO", "OTO"]).describe(
        "Bracket order type: 'OCO' (two closing orders, first fill cancels the other), " +
        "'OTOCO' (entry order in trigger-order triggers a bracket in orders array), " +
        "'OTO' (one order triggers another on fill). " +
        "NOT for spreads/straddles/condors/calendars — those use create_order with multiple legs."
      ),
      orders: z.preprocess(coerceToArray, z.array(SingleComplexOrderSchema)).describe(
        "For OCO/OTO: two orders (profit target + stop loss). For OTOCO: the bracket child orders."
      ),
      "trigger-order": SingleComplexOrderSchema.optional().describe(
        "Entry order for OTOCO type (the opening order that triggers the bracket). Required for OTOCO, omit for OCO/OTO."
      ),
      source: z.string().optional().describe("Optional source identifier"),
    },
    READ_ONLY,
    async ({ accountNumber, type, orders, "trigger-order": triggerOrder, source }) => {
      try {
        if (type === "OTOCO" && !triggerOrder) {
          return { content: [{ type: "text" as const, text: "Error: trigger-order is required when type is 'OTOCO'" }], isError: true };
        }
        const body: Record<string, any> = { type, orders };
        if (triggerOrder) body["trigger-order"] = triggerOrder;
        if (source) body.source = source;
        const svc = getClient().orderService as any;
        const raw = await svc.httpClient.postData(`/accounts/${accountNumber}/complex-orders/dry-run`, body, {});
        const result = raw?.data ?? raw;
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "create_complex_order",
    [
      "Place an OCO, OTOCO, or OTO bracket order.",
      "Always run complex_order_dry_run first to validate the order before submitting.",
      "",
      "ROUTING NOTE: This tool is ONLY for bracket order types (OCO / OTOCO / OTO).",
      "Multi-leg spreads, straddles, strangles, condors, and calendars are NOT complex orders —",
      "submit them via create_order with multiple legs in a single order (use order_dry_run to preflight).",
      "",
      "  type='OCO'   — two closing orders; first fill cancels the other (profit target + stop)",
      "  type='OTOCO' — entry order (in trigger-order) triggers a bracket (orders array)",
      "  type='OTO'   — one order triggers another when filled",
    ].join("\n"),
    {
      accountNumber: z.string().describe("The account number"),
      type: z.enum(["OCO", "OTOCO", "OTO"]).describe(
        "Bracket order type: 'OCO' (two closing orders, first fill cancels the other), " +
        "'OTOCO' (entry order in trigger-order triggers a bracket in orders array), " +
        "'OTO' (one order triggers another on fill). " +
        "NOT for spreads/straddles/condors/calendars — those use create_order with multiple legs."
      ),
      orders: z.preprocess(coerceToArray, z.array(SingleComplexOrderSchema)).describe(
        "For OCO/OTO: two orders (profit target + stop loss). For OTOCO: the bracket child orders."
      ),
      "trigger-order": SingleComplexOrderSchema.optional().describe(
        "Entry order for OTOCO type (the opening order that triggers the bracket). Required for OTOCO, omit for OCO/OTO."
      ),
      source: z.string().optional().describe("Optional source identifier"),
    },
    DESTRUCTIVE,
    async ({ accountNumber, type, orders, "trigger-order": triggerOrder, source }) => {
      try {
        if (type === "OTOCO" && !triggerOrder) {
          return { content: [{ type: "text" as const, text: "Error: trigger-order is required when type is 'OTOCO'" }], isError: true };
        }
        const body: Record<string, any> = { type, orders };
        if (triggerOrder) body["trigger-order"] = triggerOrder;
        if (source) body.source = source;
        const result = await getClient().orderService.createComplexOrder(accountNumber, body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "cancel_complex_order",
    "Cancel a complex (multi-leg) order.",
    {
      accountNumber: z.string().describe("The account number"),
      orderId: z.number().describe("The complex order ID to cancel"),
    },
    DESTRUCTIVE,
    async ({ accountNumber, orderId }) => {
      try {
        const result = await getClient().orderService.cancelComplexOrder(accountNumber, orderId);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "reconfirm_order",
    "Reconfirm an existing order.",
    {
      accountNumber: z.string().describe("The account number"),
      orderId: z.number().describe("The order ID to reconfirm"),
    },
    DESTRUCTIVE,
    async ({ accountNumber, orderId }) => {
      try {
        const result = await getClient().orderService.postReconfirmOrder(accountNumber, orderId);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "check_bracket_violations",
    [
      "Scan an account's short option positions for missing GTC bracket orders.",
      "A violation is any short Equity Option position with no live GTC 'Buy to Close' order covering its symbol.",
      "Returns each violation with the average open price (credit received), suggested profit target (50% of credit),",
      "and suggested stop loss (2× credit). Use submit_oco_bracket to fix violations.",
    ].join(" "),
    {
      accountNumber: z.string().describe("Account number to scan for bracket violations"),
    },
    READ_ONLY,
    async ({ accountNumber }) => {
      try {
        const client = getClient();

        const posRaw = await client.balancesAndPositionsService.getPositionsList(accountNumber, {});
        const positions: any[] = extractItems(posRaw);

        const shortOptions = positions.filter(
          (p: any) =>
            p["instrument-type"] === "Equity Option" &&
            p["quantity-direction"] === "Short"
        );

        if (shortOptions.length === 0) {
          return { content: [{ type: "text" as const, text: "No short option positions found — no violations." }] };
        }

        const liveRaw = await client.orderService.getLiveOrders(accountNumber);
        const liveOrders: any[] = extractItems(liveRaw);

        const coveredSymbols = new Set<string>();
        for (const order of liveOrders) {
          const tif: string = (order["time-in-force"] ?? "").toUpperCase();
          if (tif === "GTC") {
            const legs: any[] = order.legs ?? [];
            for (const leg of legs) {
              if (leg.action === "Buy to Close") {
                coveredSymbols.add(leg.symbol);
              }
            }
          }
        }

        const violations = shortOptions
          .filter((p: any) => !coveredSymbols.has(p.symbol))
          .map((p: any) => {
            const credit = Math.abs(parseFloat(p["average-open-price"] ?? "0"));
            const quantity = Math.abs(parseFloat(p["quantity"] ?? "1"));
            const profitTarget = Math.round(credit * 0.50 * 20) / 20;
            const stopLoss = Math.round(credit * 2.00 * 20) / 20;
            return {
              symbol: p.symbol,
              "underlying-symbol": p["underlying-symbol"],
              "instrument-type": p["instrument-type"],
              quantity,
              "average-open-price": credit,
              "suggested-profit-target": profitTarget,
              "suggested-stop-loss": stopLoss,
            };
          });

        if (violations.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `All ${shortOptions.length} short option position(s) have GTC bracket orders. No violations.`,
            }],
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ violations, totalViolations: violations.length }),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  const OcoBracketLegSchema = z.object({
    symbol: z.string().describe("OCC option symbol (e.g. 'SPY   250117C00450000')"),
    "instrument-type": z.string().describe("Instrument type (e.g. 'Equity Option')"),
    quantity: z.number().describe("Number of contracts"),
  });

  server.tool(
    "submit_oco_bracket",
    [
      "Submit an OCO (One Cancels Other) bracket for one or more short option legs that are already open.",
      "Constructs a GTC profit-target order at 50% of credit and a GTC stop order at 2× credit,",
      "linked as OCO so the first fill cancels the other.",
      "Pass dryRun: true to preview the OCO JSON without submitting.",
      "For a strangle/straddle/iron condor, include all legs in the legs array — both orders will mirror the same legs.",
    ].join(" "),
    {
      accountNumber: z.string().describe("Account number to place the bracket in"),
      legs: z.preprocess(
        coerceToArray,
        z.array(OcoBracketLegSchema)
      ).describe("Array of position legs to bracket — each needs symbol, instrument-type, quantity"),
      credit: z.number().describe(
        "Total net credit per unit received for the position (e.g. 5.50 for a $5.50 strangle). " +
        "Used to compute profit target (50%) and stop loss (2×)."
      ),
      dryRun: z.boolean().optional().default(false).describe(
        "If true, return the OCO JSON that would be submitted without actually placing the order (default: false)"
      ),
    },
    DESTRUCTIVE,
    async ({ accountNumber, legs, credit, dryRun }) => {
      try {
        const round5 = (n: number) => Math.round(n * 20) / 20;
        const profitPrice = round5(credit * 0.50);
        const stopPrice = round5(credit * 2.00);

        const closingLegs = legs.map((leg) => ({
          "instrument-type": leg["instrument-type"],
          symbol: leg.symbol,
          action: "Buy to Close",
          quantity: leg.quantity,
        }));

        const ocoOrder = {
          type: "OCO",
          orders: [
            {
              "time-in-force": "GTC",
              "order-type": "Limit",
              price: profitPrice,
              "price-effect": "Debit",
              legs: closingLegs,
            },
            {
              "time-in-force": "GTC",
              "order-type": "Limit",
              price: stopPrice,
              "price-effect": "Debit",
              legs: closingLegs,
            },
          ],
        };

        if (dryRun) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                dryRun: true,
                message: "OCO bracket JSON (not submitted). Set dryRun: false to place the order.",
                profitTarget: profitPrice,
                stopLoss: stopPrice,
                ocoOrder,
              }),
            }],
          };
        }

        const result = await getClient().orderService.createComplexOrder(accountNumber, ocoOrder);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              submitted: true,
              profitTarget: profitPrice,
              stopLoss: stopPrice,
              result,
            }),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );
}
