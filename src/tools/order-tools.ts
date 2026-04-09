import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

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
      orderJson: z.string().describe("JSON string of the order object to validate"),
    },
    READ_ONLY,
    async ({ accountNumber, orderJson }) => {
      try {
        const order = JSON.parse(orderJson);
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
      replacementOrderJson: z.string().describe("JSON string of the replacement order"),
    },
    READ_ONLY,
    async ({ accountNumber, orderId, replacementOrderJson }) => {
      try {
        const replacementOrder = JSON.parse(replacementOrderJson);
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
      orderJson: z.string().describe("JSON string of the order object with fields like time-in-force, order-type, legs, price, etc."),
    },
    DESTRUCTIVE,
    async ({ accountNumber, orderJson }) => {
      try {
        const order = JSON.parse(orderJson);
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
      replacementOrderJson: z.string().describe("JSON string of the replacement order"),
    },
    DESTRUCTIVE,
    async ({ accountNumber, orderId, replacementOrderJson }) => {
      try {
        const replacementOrder = JSON.parse(replacementOrderJson);
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
      editJson: z.string().describe("JSON string with the fields to edit (e.g., price)"),
    },
    DESTRUCTIVE,
    async ({ accountNumber, orderId, editJson }) => {
      try {
        const edit = JSON.parse(editJson);
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
      orderJson: z.string().describe("JSON string of the complex order object"),
    },
    DESTRUCTIVE,
    async ({ accountNumber, orderJson }) => {
      try {
        const order = JSON.parse(orderJson);
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
