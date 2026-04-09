import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";

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
  legs: z.array(OrderLegSchema).describe("Array of order legs"),
});

const ReplacementOrderSchema = z.object({
  "time-in-force": z.string().describe("Time in force (e.g. 'Day', 'GTC', 'GTD', 'Ext', 'GTC Ext', 'IOC')"),
  "order-type": z.string().describe("Order type (e.g. 'Limit', 'Market', 'Stop', 'Stop Limit')"),
  price: z.number().optional().describe("Limit price for the replacement order"),
  "price-effect": z.string().optional().describe("Price effect: 'Debit' or 'Credit'"),
  legs: z.array(OrderLegSchema).describe("Array of order legs"),
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

const ComplexOrderSchema = z.object({
  "time-in-force": z.string().describe("Time in force (e.g. 'Day', 'GTC')"),
  "order-type": z.string().describe("Order type (e.g. 'Limit', 'Market', 'Net Credit', 'Net Debit')"),
  price: z.number().optional().describe("Net price for the complex order"),
  "price-effect": z.string().optional().describe("Price effect: 'Debit' or 'Credit'"),
  legs: z.array(ComplexOrderLegSchema).describe("Array of order legs for the complex order"),
  "source": z.string().optional().describe("Optional source identifier"),
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
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "order_dry_run",
    "Validate an order without actually placing it. Returns preflight information including fees, buying power effect, and warnings.",
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
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
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
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
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
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
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
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
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
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
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
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "create_complex_order",
    "Create a complex (multi-leg) order such as spreads, straddles, etc.",
    {
      accountNumber: z.string().describe("The account number"),
      "time-in-force": ComplexOrderSchema.shape["time-in-force"],
      "order-type": ComplexOrderSchema.shape["order-type"],
      price: ComplexOrderSchema.shape.price,
      "price-effect": ComplexOrderSchema.shape["price-effect"],
      legs: ComplexOrderSchema.shape.legs,
      source: ComplexOrderSchema.shape["source"],
    },
    DESTRUCTIVE,
    async ({ accountNumber, ...orderFields }) => {
      try {
        const order = orderFields;
        const result = await getClient().orderService.createComplexOrder(accountNumber, order);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
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
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
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
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
