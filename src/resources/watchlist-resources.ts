import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../tastytrade-client.js";

export function registerWatchlistResources(server: McpServer) {
  server.resource(
    "all-watchlists",
    "mcp://watchlists",
    {
      description: "All user watchlists.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const watchlists = await getClient().watchlistsService.getAllWatchlists();
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify(watchlists, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: error.message }),
            },
          ],
        };
      }
    }
  );

  server.resource(
    "public-watchlists",
    "mcp://watchlists/public",
    {
      description: "All TastyTrade public watchlists.",
      mimeType: "application/json",
    },
    async (uri) => {
      try {
        const watchlists = await getClient().watchlistsService.getPublicWatchlists(false);
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify(watchlists, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: error.message }),
            },
          ],
        };
      }
    }
  );

  const watchlistTemplate = new ResourceTemplate("mcp://watchlists/{name}", {
    list: undefined,
  });

  server.resource(
    "watchlist-by-name",
    watchlistTemplate,
    {
      description: "Contents of a specific user watchlist by name.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const name = variables["name"] as string;
      try {
        const watchlist = await getClient().watchlistsService.getSingleWatchlist(name);
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify(watchlist, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: error.message }),
            },
          ],
        };
      }
    }
  );
}
