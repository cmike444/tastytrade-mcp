import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";

export function registerOrderTools(server: McpServer) {
  server.tool(
    "get_live_orders",
    "Get all currently live (active) orders for an account.",
    {
      accountNumber: z.string().describe("The account number to get live orders for"),
    },
    async ({ accountNumber }) => {
      try {
        const orders = await getClient().orderService.getLiveOrders(accountNumber);
        return { content: [{ type: "text" as const, text: JSON.stringify(orders, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_orders",
    "Get a paginated list of orders for an account. Returns orders sorted by date descending.",
    {
      accountNumber: z.string().describe("The account number to get orders for"),
      perPage: z.number().optional().describe("Number of orders per page"),
      pageOffset: z.number().optional().describe("Page offset for pagination"),
      status: z.string().optional().describe("Filter by order status (e.g., 'Filled', 'Cancelled', 'Live')"),
    },
    async ({ accountNumber, perPage, pageOffset, status }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (perPage) queryParams["per-page"] = perPage;
        if (pageOffset) queryParams["page-offset"] = pageOffset;
        if (status) queryParams.status = status;
        const orders = await getClient().orderService.getOrders(accountNumber, queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(orders, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_order",
    "Get details of a specific order by its ID.",
    {
      accountNumber: z.string().describe("The account number"),
      orderId: z.number().describe("The order ID to retrieve"),
    },
    async ({ accountNumber, orderId }) => {
      try {
        const order = await getClient().orderService.getOrder(accountNumber, orderId);
        return { content: [{ type: "text" as const, text: JSON.stringify(order, null, 2) }] };
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
    async ({ accountNumber, orderJson }) => {
      try {
        const order = JSON.parse(orderJson);
        const result = await getClient().orderService.createOrder(accountNumber, order);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
    async ({ accountNumber, orderJson }) => {
      try {
        const order = JSON.parse(orderJson);
        const result = await getClient().orderService.postOrderDryRun(accountNumber, order);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
    async ({ accountNumber, orderId }) => {
      try {
        const result = await getClient().orderService.cancelOrder(accountNumber, orderId);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
    async ({ accountNumber, orderId, replacementOrderJson }) => {
      try {
        const replacementOrder = JSON.parse(replacementOrderJson);
        const result = await getClient().orderService.replaceOrder(accountNumber, orderId, replacementOrder);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
    async ({ accountNumber, orderId, editJson }) => {
      try {
        const edit = JSON.parse(editJson);
        const result = await getClient().orderService.editOrder(accountNumber, orderId, edit);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
    async ({ accountNumber, orderJson }) => {
      try {
        const order = JSON.parse(orderJson);
        const result = await getClient().orderService.createComplexOrder(accountNumber, order);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
    async ({ accountNumber, orderId }) => {
      try {
        const result = await getClient().orderService.cancelComplexOrder(accountNumber, orderId);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
    async ({ accountNumber, orderId }) => {
      try {
        const result = await getClient().orderService.postReconfirmOrder(accountNumber, orderId);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
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
    async ({ accountNumber, orderId, replacementOrderJson }) => {
      try {
        const replacementOrder = JSON.parse(replacementOrderJson);
        const result = await getClient().orderService.replacementOrderDryRun(accountNumber, orderId, replacementOrder);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_customer_live_orders",
    "Get all live orders across all accounts for a customer.",
    {
      customerId: z.string().describe("The customer ID"),
    },
    async ({ customerId }) => {
      try {
        const orders = await getClient().orderService.getLiveOrdersForCustomer(customerId);
        return { content: [{ type: "text" as const, text: JSON.stringify(orders, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_customer_orders",
    "Get a paginated list of orders across all accounts for a customer.",
    {
      customerId: z.string().describe("The customer ID"),
      perPage: z.number().optional().describe("Number of orders per page"),
      pageOffset: z.number().optional().describe("Page offset for pagination"),
    },
    async ({ customerId, perPage, pageOffset }) => {
      try {
        const queryParams: Record<string, any> = {};
        if (perPage) queryParams["per-page"] = perPage;
        if (pageOffset) queryParams["page-offset"] = pageOffset;
        const orders = await getClient().orderService.getCustomerOrders(customerId, queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(orders, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
