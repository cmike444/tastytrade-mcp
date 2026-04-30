#!/usr/bin/env node
/**
 * Integration smoke test: futures quotes end-to-end via the real MCP get_quote handler
 *
 * This test invokes the actual get_quote MCP tool by wiring an in-process
 * Client ↔ Server pair.  It authenticates with a live TastyTrade session and
 * then calls get_quote exactly as a real MCP client would, exercising the full
 * path:
 *
 *   root symbol → resolveFuturesStreamerSymbol → DXLink subscribe → quote event
 *   → remap eventSymbol + resolvedStreamerSymbol → JSON response
 *
 * Tests:
 *   1. Futures root symbol /CL → front-month contract, bid/ask, resolvedStreamerSymbol
 *   2. Equity symbol AAPL → bid/ask, no resolvedStreamerSymbol
 *
 * Run:
 *   npm run test:smoke:futures
 *
 * Requires env vars: TASTYTRADE_CLIENT_SECRET, TASTYTRADE_REFRESH_TOKEN
 * Optional:         TASTYTRADE_SANDBOX=true
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { autoAuthenticate, disconnectClient } from "../tastytrade-client.js";
import { registerMarketDataTools } from "../tools/market-data-tools.js";

// ---------------------------------------------------------------------------
// Minimal assertion helpers
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertDefined(value: unknown, message: string): void {
  assert(value !== undefined && value !== null, message);
}

function assertNonZero(value: unknown, message: string): void {
  assert(typeof value === "number" && !Number.isNaN(value) && value !== 0, `${message} (got ${value})`);
}

function assertPattern(value: unknown, pattern: RegExp, message: string): void {
  assert(
    typeof value === "string" && pattern.test(value),
    `${message} (got ${JSON.stringify(value)})`
  );
}

// ---------------------------------------------------------------------------
// Create the in-process MCP client+server pair
// ---------------------------------------------------------------------------
async function createMcpClient(): Promise<Client> {
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  registerMarketDataTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  return client;
}

// ---------------------------------------------------------------------------
// Helper: call get_quote and parse the JSON payload
// ---------------------------------------------------------------------------
async function callGetQuote(
  client: Client,
  symbols: string[],
  timeoutMs = 8000
): Promise<Array<Record<string, unknown>>> {
  const result = await client.callTool({
    name: "get_quote",
    arguments: {
      symbols,
      timeoutMs,
      detail: "full",
      format: "json",
    },
  });

  type TextContent = { type: string; text?: string };
  const content = result.content as TextContent[];

  if (result.isError) {
    const msg = content[0]?.text ?? "Unknown error";
    throw new Error(`get_quote returned an error: ${msg}`);
  }

  const text = content[0]?.text;
  if (!text) throw new Error("get_quote returned empty content");

  return JSON.parse(text) as Array<Record<string, unknown>>;
}

// Configurable futures root symbol — override with env var for CI flexibility
// (e.g. SMOKE_FUTURES_SYMBOL=/ES npm run test:smoke:futures)
const FUTURES_SYMBOL = process.env["SMOKE_FUTURES_SYMBOL"] ?? "/CL";

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------
async function testFuturesQuote(client: Client): Promise<void> {
  console.log(`\n[Test 1] Futures root symbol ${FUTURES_SYMBOL} → front-month contract quote`);

  let events: Array<Record<string, unknown>>;
  try {
    events = await callGetQuote(client, [FUTURES_SYMBOL]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    assert(false, `get_quote(${FUTURES_SYMBOL}) threw: ${msg}`);
    return;
  }

  assert(events.length > 0, `Received at least one event for ${FUTURES_SYMBOL} (got ${events.length})`);
  if (events.length === 0) return;

  // Prefer the last Quote event (which carries bid/ask); fall back to last event
  const quoteEvents = events.filter(e => e["eventType"] === "Quote" || e["bidPrice"] !== undefined);
  const ev = quoteEvents.length > 0 ? quoteEvents[quoteEvents.length - 1] : events[events.length - 1];

  assert(ev["eventSymbol"] === FUTURES_SYMBOL,
    `eventSymbol remapped back to ${FUTURES_SYMBOL} (got ${ev["eventSymbol"]})`);

  // resolvedStreamerSymbol must match the front-month pattern, e.g. /CLM26:XNYM
  // Pattern: /<ProductCode><MonthLetter><Year>:<Exchange>
  const productCode = FUTURES_SYMBOL.slice(1); // strip leading /
  const streamerPattern = new RegExp(`^\\/${productCode}[A-Z]\\d+:X[A-Z]+$`);
  assertPattern(
    ev["resolvedStreamerSymbol"],
    streamerPattern,
    `resolvedStreamerSymbol matches /${productCode}<Month><Year>:X<Exchange> pattern`
  );

  // bid and ask must be present and non-zero
  assertDefined(ev["bidPrice"], "bidPrice is present");
  assertDefined(ev["askPrice"], "askPrice is present");
  assertNonZero(ev["bidPrice"], "bidPrice is non-zero");
  assertNonZero(ev["askPrice"], "askPrice is non-zero");

  // lastPrice: get_quote normalizes Trade.price → lastPrice in the remap step.
  // Accept lastPrice from any collected event (Trade is typical; Summary may also carry it).
  const evWithLast = events.find(
    e => typeof e["lastPrice"] === "number" &&
      !Number.isNaN(e["lastPrice"] as number) &&
      (e["lastPrice"] as number) !== 0
  );
  assert(evWithLast !== undefined, `lastPrice (non-zero) is present in the ${FUTURES_SYMBOL} payload`);
}

async function testEquityQuote(client: Client): Promise<void> {
  console.log("\n[Test 2] Equity symbol AAPL returns bid/ask unchanged (no resolvedStreamerSymbol)");

  let events: Array<Record<string, unknown>>;
  try {
    events = await callGetQuote(client, ["AAPL"]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    assert(false, `get_quote(AAPL) threw: ${msg}`);
    return;
  }

  assert(events.length > 0, `Received at least one event for AAPL (got ${events.length})`);
  if (events.length === 0) return;

  // Prefer the last Quote event (which carries bid/ask); fall back to last event
  const quoteEvents = events.filter(e => e["eventType"] === "Quote" || e["bidPrice"] !== undefined);
  const ev = quoteEvents.length > 0 ? quoteEvents[quoteEvents.length - 1] : events[events.length - 1];

  assert(ev["eventSymbol"] === "AAPL", `eventSymbol is AAPL (got ${ev["eventSymbol"]})`);
  assert(
    ev["resolvedStreamerSymbol"] === undefined,
    "resolvedStreamerSymbol is absent for equity (not a futures symbol)"
  );

  assertDefined(ev["bidPrice"], "bidPrice is present");
  assertDefined(ev["askPrice"], "askPrice is present");
  assertNonZero(ev["bidPrice"], "bidPrice is non-zero");
  assertNonZero(ev["askPrice"], "askPrice is non-zero");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("=== Futures Quotes Smoke Test (end-to-end via MCP client) ===\n");

  console.log("[Setup] Authenticating with TastyTrade...");
  try {
    const msg = await autoAuthenticate();
    console.log(`[Setup] ${msg}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Setup] Authentication failed: ${msg}`);
    process.exit(1);
  }

  console.log("[Setup] Creating in-process MCP client/server pair...");
  const client = await createMcpClient();

  await testFuturesQuote(client);
  await testEquityQuote(client);

  // Disconnect gracefully
  try {
    await disconnectClient();
  } catch {}

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
