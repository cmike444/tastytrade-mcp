#!/usr/bin/env node
/**
 * Smoke test: encrypted token roundtrip without real TastyTrade credentials.
 *
 * Verifies that the token-store module integrates correctly with the compiled
 * codebase by performing a full save/load cycle using a test encryption key
 * and a temp file path.
 *
 * Run:
 *   npm run test:smoke:auth-persistence
 *
 * No TastyTrade credentials are required.
 */

import { existsSync, unlinkSync } from "node:fs";
import { saveTokens, loadTokens, getTokenAgeDays } from "../token-store.js";

// ---------------------------------------------------------------------------
// Minimal assertion helpers (consistent with smoke-futures-quotes.ts style)
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const TEST_KEY = "b".repeat(64); // valid 64-char hex key
const TEST_PATH = "/tmp/tt-smoke-auth-persistence.enc";
const TEST_TOKEN = "smoke-test-refresh-token-xyz789";

function cleanUp(): void {
  if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH);
  if (existsSync(TEST_PATH + ".tmp")) unlinkSync(TEST_PATH + ".tmp");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("=== Auth Persistence Smoke Test ===\n");

  cleanUp();
  process.env["TOKEN_ENCRYPTION_KEY"] = TEST_KEY;

  // 1. File should not exist before save
  assert(!existsSync(TEST_PATH), "No token file exists before first save");

  // 2. getTokenAgeDays returns null before save
  const ageBefore = getTokenAgeDays(TEST_PATH);
  assert(ageBefore === null, `getTokenAgeDays returns null before save (got ${ageBefore})`);

  // 3. saveTokens creates the file
  saveTokens({ refreshToken: TEST_TOKEN, filePath: TEST_PATH });
  assert(existsSync(TEST_PATH), "Token file created after saveTokens");

  // 4. loadTokens returns the correct token
  const loaded = loadTokens(TEST_PATH);
  assert(loaded !== null, "loadTokens returns non-null after save");
  assert(
    loaded?.refreshToken === TEST_TOKEN,
    `Roundtrip token matches original (got "${loaded?.refreshToken}")`
  );

  // 5. savedAt is a recent Date
  const nowMs = Date.now();
  const savedAtMs = loaded?.savedAt?.getTime() ?? 0;
  const diffMs = Math.abs(nowMs - savedAtMs);
  assert(diffMs < 5000, `savedAt is within 5 seconds of now (diff=${diffMs}ms)`);

  // 6. getTokenAgeDays returns a small non-negative number
  const ageAfter = getTokenAgeDays(TEST_PATH);
  assert(ageAfter !== null, "getTokenAgeDays returns non-null after save");
  assert(
    typeof ageAfter === "number" && ageAfter >= 0 && ageAfter < 1,
    `getTokenAgeDays is in [0, 1) for a fresh file (got ${ageAfter})`
  );

  // 7. loadTokens returns null without the key
  delete process.env["TOKEN_ENCRYPTION_KEY"];
  const loadedWithoutKey = loadTokens(TEST_PATH);
  assert(loadedWithoutKey === null, "loadTokens returns null when TOKEN_ENCRYPTION_KEY is absent");

  // --- Rotation capture test ---
  // Simulates the generateAccessToken monkey-patch in tastytrade-client.ts:
  // if the OAuth server returns a new refresh_token in the response body,
  // the patched function updates hc.refreshToken and we persist that instead
  // of the original input token.
  console.log("\n[Rotation capture simulation]");
  process.env["TOKEN_ENCRYPTION_KEY"] = TEST_KEY;
  cleanUp();

  const ORIGINAL_TOKEN = "original-refresh-token-abc";
  const ROTATED_TOKEN = "rotated-refresh-token-xyz";

  // Simulate httpClient state (what the SDK maintains)
  const simulatedHc = { refreshToken: ORIGINAL_TOKEN };

  // Simulate a token response from TastyTrade containing a new refresh_token
  const simulatedTokenResponse = {
    data: {
      access_token: "new-access-token",
      expires_in: 3600,
      refresh_token: ROTATED_TOKEN,
    },
  };

  // Apply our rotation detection logic (mirrors the patch in tastytrade-client.ts)
  const newRefToken: unknown = simulatedTokenResponse?.data?.refresh_token;
  if (typeof newRefToken === "string" && newRefToken.length > 0 && newRefToken !== simulatedHc.refreshToken) {
    simulatedHc.refreshToken = newRefToken;
  }

  assert(simulatedHc.refreshToken === ROTATED_TOKEN, "Rotation capture: hc.refreshToken updated to rotated value");

  // Persist the effective (rotated) token and verify it is stored correctly
  saveTokens({ refreshToken: simulatedHc.refreshToken, filePath: TEST_PATH });
  const loadedRotated = loadTokens(TEST_PATH);
  assert(loadedRotated !== null, "Rotation capture: loadTokens returns non-null after persisting rotated token");
  assert(
    loadedRotated?.refreshToken === ROTATED_TOKEN,
    `Rotation capture: persisted token is the rotated one (got "${loadedRotated?.refreshToken}")`
  );
  assert(
    loadedRotated?.refreshToken !== ORIGINAL_TOKEN,
    "Rotation capture: persisted token is NOT the original input token"
  );

  // Cleanup
  cleanUp();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
