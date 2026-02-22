import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

export function registerWatchlistTools(server: McpServer) {
  server.tool(
    "get_all_watchlists",
    "Get all user watchlists.",
    {},
    READ_ONLY,
    async () => {
      try {
        const watchlists = await getClient().watchlistsService.getAllWatchlists();
        return { content: [{ type: "text" as const, text: JSON.stringify(watchlists, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_watchlist",
    "Get a specific watchlist by name.",
    {
      watchlistName: z.string().describe("The name of the watchlist"),
    },
    READ_ONLY,
    async ({ watchlistName }) => {
      try {
        const watchlist = await getClient().watchlistsService.getSingleWatchlist(watchlistName);
        return { content: [{ type: "text" as const, text: JSON.stringify(watchlist, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "create_watchlist",
    "Create a new account watchlist.",
    {
      watchlistJson: z.string().describe("JSON string of the watchlist object with name and watchlist-entries"),
    },
    DESTRUCTIVE,
    async ({ watchlistJson }) => {
      try {
        const watchlist = JSON.parse(watchlistJson);
        const result = await getClient().watchlistsService.createAccountWatchlist(watchlist);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "replace_watchlist",
    "Replace all properties of an existing watchlist.",
    {
      watchlistName: z.string().describe("The name of the watchlist to replace"),
      watchlistJson: z.string().describe("JSON string of the replacement watchlist object"),
    },
    DESTRUCTIVE,
    async ({ watchlistName, watchlistJson }) => {
      try {
        const watchlist = JSON.parse(watchlistJson);
        const result = await getClient().watchlistsService.replaceWatchlist(watchlistName, watchlist);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "delete_watchlist",
    "Delete a watchlist by name.",
    {
      watchlistName: z.string().describe("The name of the watchlist to delete"),
    },
    DESTRUCTIVE,
    async ({ watchlistName }) => {
      try {
        const result = await getClient().watchlistsService.deleteWatchlist(watchlistName);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_public_watchlists",
    "Get all TastyTrade public watchlists.",
    {
      countsOnly: z.boolean().default(false).describe("Only return counts instead of full watchlist data"),
    },
    READ_ONLY,
    async ({ countsOnly }) => {
      try {
        const watchlists = await getClient().watchlistsService.getPublicWatchlists(countsOnly);
        return { content: [{ type: "text" as const, text: JSON.stringify(watchlists, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_public_watchlist",
    "Get a specific TastyTrade public watchlist by name.",
    {
      watchlistName: z.string().describe("The name of the public watchlist"),
    },
    READ_ONLY,
    async ({ watchlistName }) => {
      try {
        const watchlist = await getClient().watchlistsService.getPublicWatchlist(watchlistName);
        return { content: [{ type: "text" as const, text: JSON.stringify(watchlist, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_pairs_watchlists",
    "Get all TastyTrade pairs watchlists.",
    {},
    READ_ONLY,
    async () => {
      try {
        const watchlists = await getClient().watchlistsService.getPairsWatchlists();
        return { content: [{ type: "text" as const, text: JSON.stringify(watchlists, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_pairs_watchlist",
    "Get a specific TastyTrade pairs watchlist by name.",
    {
      pairsWatchlistName: z.string().describe("The name of the pairs watchlist"),
    },
    READ_ONLY,
    async ({ pairsWatchlistName }) => {
      try {
        const watchlist = await getClient().watchlistsService.getPairsWatchlist(pairsWatchlistName);
        return { content: [{ type: "text" as const, text: JSON.stringify(watchlist, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      }
    }
  );
}
