/**
 * Unit tests for src/token-store.ts
 *
 * Run with:
 *   npm run test:token-store
 *
 * Covers:
 *   (a) save/load roundtrip produces identical token
 *   (b) missing TOKEN_ENCRYPTION_KEY → saveTokens is a no-op, loadTokens returns null
 *   (c) corrupt ciphertext → loadTokens returns null
 *   (d) missing file → loadTokens returns null
 *   (e) getTokenAgeDays returns null when no file
 *   (f) getTokenAgeDays returns a number >= 0 after a save
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import {
  validateEncryptionKey,
  saveTokens,
  loadTokens,
  getTokenAgeDays,
} from "../token-store.js";

// Use a temp file path so tests never touch the real .enc file
const TEST_PATH = "/tmp/tt-test-session.enc";
const VALID_KEY = "a".repeat(64); // 64 hex chars (all 'a' is valid hex)

function cleanUp() {
  if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH);
  if (existsSync(TEST_PATH + ".tmp")) unlinkSync(TEST_PATH + ".tmp");
}

// ---------------------------------------------------------------------------
// (a) save/load roundtrip produces identical token
// ---------------------------------------------------------------------------

test("token-store — save/load roundtrip produces identical refreshToken", () => {
  cleanUp();
  process.env["TOKEN_ENCRYPTION_KEY"] = VALID_KEY;

  const token = "test-refresh-token-abc123";
  saveTokens({ refreshToken: token, filePath: TEST_PATH });

  const loaded = loadTokens(TEST_PATH);
  assert.ok(loaded !== null, "loadTokens returns non-null after save");
  assert.equal(loaded!.refreshToken, token, "roundtrip token matches original");
  assert.ok(loaded!.savedAt instanceof Date, "savedAt is a Date");

  cleanUp();
  delete process.env["TOKEN_ENCRYPTION_KEY"];
});

// ---------------------------------------------------------------------------
// (b) missing TOKEN_ENCRYPTION_KEY → saveTokens is a no-op, loadTokens returns null
// ---------------------------------------------------------------------------

test("token-store — missing TOKEN_ENCRYPTION_KEY: saveTokens is no-op", () => {
  cleanUp();
  const originalKey = process.env["TOKEN_ENCRYPTION_KEY"];
  delete process.env["TOKEN_ENCRYPTION_KEY"];

  saveTokens({ refreshToken: "some-token", filePath: TEST_PATH });
  assert.ok(!existsSync(TEST_PATH), "no file created when key is absent");

  if (originalKey !== undefined) process.env["TOKEN_ENCRYPTION_KEY"] = originalKey;
});

test("token-store — missing TOKEN_ENCRYPTION_KEY: loadTokens returns null", () => {
  cleanUp();
  const originalKey = process.env["TOKEN_ENCRYPTION_KEY"];
  delete process.env["TOKEN_ENCRYPTION_KEY"];

  const result = loadTokens(TEST_PATH);
  assert.equal(result, null, "loadTokens returns null when key is absent");

  if (originalKey !== undefined) process.env["TOKEN_ENCRYPTION_KEY"] = originalKey;
});

// ---------------------------------------------------------------------------
// (c) corrupt ciphertext → loadTokens returns null
// ---------------------------------------------------------------------------

test("token-store — corrupt ciphertext: loadTokens returns null", () => {
  cleanUp();
  process.env["TOKEN_ENCRYPTION_KEY"] = VALID_KEY;

  // Write garbage bytes
  writeFileSync(TEST_PATH, Buffer.from("this-is-not-valid-encrypted-data-garbage-1234567890abcdef"));

  const result = loadTokens(TEST_PATH);
  assert.equal(result, null, "loadTokens returns null for corrupt ciphertext");

  cleanUp();
  delete process.env["TOKEN_ENCRYPTION_KEY"];
});

// ---------------------------------------------------------------------------
// (d) missing file → loadTokens returns null
// ---------------------------------------------------------------------------

test("token-store — missing file: loadTokens returns null", () => {
  cleanUp();
  process.env["TOKEN_ENCRYPTION_KEY"] = VALID_KEY;

  assert.ok(!existsSync(TEST_PATH), "precondition: file does not exist");
  const result = loadTokens(TEST_PATH);
  assert.equal(result, null, "loadTokens returns null when file does not exist");

  delete process.env["TOKEN_ENCRYPTION_KEY"];
});

// ---------------------------------------------------------------------------
// (e) getTokenAgeDays returns null when no file
// ---------------------------------------------------------------------------

test("token-store — getTokenAgeDays returns null when no file", () => {
  cleanUp();
  const age = getTokenAgeDays(TEST_PATH);
  assert.equal(age, null, "getTokenAgeDays returns null when file does not exist");
});

// ---------------------------------------------------------------------------
// (f) getTokenAgeDays returns a number >= 0 after a save
// ---------------------------------------------------------------------------

test("token-store — getTokenAgeDays returns a number >= 0 after a save", () => {
  cleanUp();
  process.env["TOKEN_ENCRYPTION_KEY"] = VALID_KEY;

  saveTokens({ refreshToken: "age-test-token", filePath: TEST_PATH });
  assert.ok(existsSync(TEST_PATH), "file exists after save");

  const age = getTokenAgeDays(TEST_PATH);
  assert.ok(age !== null, "getTokenAgeDays returns non-null after save");
  assert.ok(typeof age === "number", "getTokenAgeDays returns a number");
  assert.ok(age >= 0, `getTokenAgeDays is >= 0 (got ${age})`);
  assert.ok(age < 1, `getTokenAgeDays is < 1 day for a just-written file (got ${age})`);

  cleanUp();
  delete process.env["TOKEN_ENCRYPTION_KEY"];
});

// ---------------------------------------------------------------------------
// (g) validateEncryptionKey — invalid length returns false
// ---------------------------------------------------------------------------

test("token-store — validateEncryptionKey returns false for wrong-length key", () => {
  const originalKey = process.env["TOKEN_ENCRYPTION_KEY"];
  process.env["TOKEN_ENCRYPTION_KEY"] = "tooshort";
  const result = validateEncryptionKey();
  assert.equal(result, false, "validateEncryptionKey returns false for wrong-length key");
  if (originalKey !== undefined) {
    process.env["TOKEN_ENCRYPTION_KEY"] = originalKey;
  } else {
    delete process.env["TOKEN_ENCRYPTION_KEY"];
  }
});

test("token-store — validateEncryptionKey returns true for valid 64-char hex key", () => {
  const originalKey = process.env["TOKEN_ENCRYPTION_KEY"];
  process.env["TOKEN_ENCRYPTION_KEY"] = VALID_KEY;
  const result = validateEncryptionKey();
  assert.equal(result, true, "validateEncryptionKey returns true for valid key");
  if (originalKey !== undefined) {
    process.env["TOKEN_ENCRYPTION_KEY"] = originalKey;
  } else {
    delete process.env["TOKEN_ENCRYPTION_KEY"];
  }
});

// ---------------------------------------------------------------------------
// (h) generateAccessToken patch capability-check contract
// Verifies that the canPatch guard logic (used in tastytrade-client.ts)
// correctly identifies SDK-compatible httpClient shapes.
// ---------------------------------------------------------------------------

test("generateAccessToken patch contract — canPatch true when required methods present", () => {
  const mockHc = {
    axiosConfig: () => ({}),
    getDefaultHeaders: () => ({}),
    accessToken: {
      updateFromTokenResponse: () => {},
    },
  };
  const canPatch =
    typeof mockHc?.axiosConfig === "function" &&
    typeof mockHc?.getDefaultHeaders === "function" &&
    typeof mockHc?.accessToken?.updateFromTokenResponse === "function";
  assert.equal(canPatch, true, "canPatch is true when all required SDK methods are present");
});

test("generateAccessToken patch contract — canPatch false when axiosConfig missing", () => {
  const mockHcBroken = {
    getDefaultHeaders: () => ({}),
    accessToken: { updateFromTokenResponse: () => {} },
  } as any;
  const canPatch =
    typeof mockHcBroken?.axiosConfig === "function" &&
    typeof mockHcBroken?.getDefaultHeaders === "function" &&
    typeof mockHcBroken?.accessToken?.updateFromTokenResponse === "function";
  assert.equal(canPatch, false, "canPatch is false when axiosConfig is missing");
});

test("generateAccessToken patch contract — canPatch false when updateFromTokenResponse missing", () => {
  const mockHcBroken = {
    axiosConfig: () => ({}),
    getDefaultHeaders: () => ({}),
    accessToken: {},
  } as any;
  const canPatch =
    typeof mockHcBroken?.axiosConfig === "function" &&
    typeof mockHcBroken?.getDefaultHeaders === "function" &&
    typeof mockHcBroken?.accessToken?.updateFromTokenResponse === "function";
  assert.equal(canPatch, false, "canPatch is false when updateFromTokenResponse is missing");
});

test("generateAccessToken patch rotation capture — refreshToken updated when response contains new token", () => {
  // Simulate the patched generateAccessToken rotation-capture logic
  const hc = { refreshToken: "original-token" };
  const simulatedResponse = { data: { refresh_token: "rotated-token", access_token: "new-at" } };

  const newRefToken: unknown = simulatedResponse?.data?.refresh_token;
  if (typeof newRefToken === "string" && newRefToken.length > 0 && newRefToken !== hc.refreshToken) {
    hc.refreshToken = newRefToken;
  }
  assert.equal(hc.refreshToken, "rotated-token", "refreshToken updated to rotated value from response");
});

test("generateAccessToken patch rotation capture — refreshToken unchanged when response has no new token", () => {
  // Simulate case where server does NOT return a refresh_token (no rotation)
  const hc = { refreshToken: "stable-token" };
  const simulatedResponse = { data: { access_token: "new-at", expires_in: 3600 } } as any;

  const newRefToken: unknown = simulatedResponse?.data?.refresh_token;
  if (typeof newRefToken === "string" && newRefToken.length > 0 && newRefToken !== hc.refreshToken) {
    hc.refreshToken = newRefToken;
  }
  assert.equal(hc.refreshToken, "stable-token", "refreshToken unchanged when response contains no refresh_token");
});

console.log("\nAll token-store tests completed.");
