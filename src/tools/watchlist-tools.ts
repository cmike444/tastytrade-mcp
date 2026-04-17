import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../tastytrade-client.js";
import { formatApiError } from "./error-utils.js";
import { coerceToArray } from "./schema-utils.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

const WatchlistEntrySchema = z.object({
  symbol: z.string().describe("The instrument symbol (e.g. 'AAPL', 'SPY')"),
  "instrument-type": z.string().describe("Instrument type (e.g. 'Equity', 'Equity Option', 'Future', 'Cryptocurrency')"),
});

export function registerWatchlistTools(server: McpServer) {
  server.tool(
    "manage_watchlist",
    [
      "Manage user account watchlists. To list all watchlists, use the mcp://watchlists resource instead. Actions:",
      "  get — Get a specific watchlist by name (requires watchlistName).",
      "  create — Create a new watchlist (requires watchlistName and watchlistEntries).",
      "  replace — Replace all properties of an existing watchlist (requires watchlistName and watchlistEntries).",
      "  delete — Delete a watchlist (requires watchlistName).",
    ].join("\n"),
    {
      action: z.enum(["get", "create", "replace", "delete"]).describe(
        "Action to perform: 'get' one by name, 'create' a new one, 'replace' an existing one, or 'delete' one. To list all watchlists use the mcp://watchlists resource."
      ),
      watchlistName: z.string().optional().describe("Watchlist name — required for get, create, replace, and delete actions."),
      watchlistEntries: z.preprocess(coerceToArray, z.array(WatchlistEntrySchema).optional()).describe(
        "Array of watchlist entries (each with symbol and instrument-type) — required for create and replace actions."
      ),
    },
    READ_ONLY,
    async ({ action, watchlistName, watchlistEntries }) => {
      try {
        const svc = getClient().watchlistsService;
        let result: any;

        if (action === "get") {
          if (!watchlistName) throw new Error("watchlistName is required for action 'get'");
          result = await svc.getSingleWatchlist(watchlistName);
        } else if (action === "create") {
          if (!watchlistName) throw new Error("watchlistName is required for action 'create'");
          if (!watchlistEntries) throw new Error("watchlistEntries is required for action 'create'");
          const watchlistObj = {
            name: watchlistName,
            "watchlist-entries": watchlistEntries,
          };
          result = await svc.createAccountWatchlist(watchlistObj);
        } else if (action === "replace") {
          if (!watchlistName) throw new Error("watchlistName is required for action 'replace'");
          if (!watchlistEntries) throw new Error("watchlistEntries is required for action 'replace'");
          const watchlistObj = {
            name: watchlistName,
            "watchlist-entries": watchlistEntries,
          };
          result = await svc.replaceWatchlist(watchlistName, watchlistObj);
        } else if (action === "delete") {
          if (!watchlistName) throw new Error("watchlistName is required for action 'delete'");
          result = await svc.deleteWatchlist(watchlistName);
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "manage_public_watchlist",
    [
      "Access TastyTrade public and pairs watchlists. Actions:",
      "  list_public — Get all TastyTrade public watchlists (optional countsOnly param).",
      "  get_public — Get a specific public watchlist by name (requires watchlistName).",
      "  list_pairs — Get all TastyTrade pairs watchlists (no extra params needed).",
      "  get_pairs — Get a specific pairs watchlist by name (requires watchlistName).",
    ].join("\n"),
    {
      action: z.enum(["list_public", "get_public", "list_pairs", "get_pairs"]).describe(
        "Action: 'list_public' all public watchlists, 'get_public' one by name, 'list_pairs' all pairs watchlists, 'get_pairs' one by name."
      ),
      watchlistName: z.string().optional().describe("Watchlist name — required for get_public and get_pairs actions."),
      countsOnly: z.boolean().default(false).describe("For list_public only — return only counts instead of full data."),
    },
    READ_ONLY,
    async ({ action, watchlistName, countsOnly }) => {
      try {
        const svc = getClient().watchlistsService;
        let result: any;

        if (action === "list_public") {
          result = await svc.getPublicWatchlists(countsOnly);
        } else if (action === "get_public") {
          if (!watchlistName) throw new Error("watchlistName is required for action 'get_public'");
          result = await svc.getPublicWatchlist(watchlistName);
        } else if (action === "list_pairs") {
          result = await svc.getPairsWatchlists();
        } else if (action === "get_pairs") {
          if (!watchlistName) throw new Error("watchlistName is required for action 'get_pairs'");
          result = await svc.getPairsWatchlist(watchlistName);
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Error: ${formatApiError(error)}` }], isError: true };
      }
    }
  );
}
