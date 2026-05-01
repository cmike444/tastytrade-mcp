/**
 * token-store.ts — Encrypted-at-rest refresh token persistence.
 *
 * Uses AES-256-GCM with a random 12-byte IV per write.
 * The encryption key is a 64-char hex string (32 bytes) stored as
 * TOKEN_ENCRYPTION_KEY in Replit Secrets.
 *
 * All public functions are safe to call regardless of whether the key is
 * present or valid — they degrade gracefully to no-ops or null returns.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from "node:fs";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const MAX_TOKEN_AGE_DAYS = 28;

const DEFAULT_TOKEN_PATH = "./tastytrade-session.enc";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _keyWarningLogged = false;

// ---------------------------------------------------------------------------
// Encryption key validation
// ---------------------------------------------------------------------------

/**
 * Returns true if TOKEN_ENCRYPTION_KEY is present and exactly 64 hex chars.
 * Logs a one-time warning if absent or malformed. Safe to call repeatedly.
 */
export function validateEncryptionKey(): boolean {
  const key = process.env["TOKEN_ENCRYPTION_KEY"];
  if (!key) {
    if (!_keyWarningLogged) {
      logger.warn(
        "[TokenStore] TOKEN_ENCRYPTION_KEY is not set. " +
        "Refresh token persistence is disabled — auth will continue using the env var token."
      );
      _keyWarningLogged = true;
    }
    return false;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    if (!_keyWarningLogged) {
      logger.warn(
        "[TokenStore] TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). " +
        "Refresh token persistence is disabled — auth will continue using the env var token."
      );
      _keyWarningLogged = true;
    }
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Payload structure (stored encrypted as JSON)
// ---------------------------------------------------------------------------

interface TokenPayload {
  refreshToken: string;
  savedAt: string; // ISO-8601 timestamp
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Encrypts and persists the given refreshToken.
 * Writes to a .tmp file first then renames (atomic on Linux).
 * Any error is caught and logged as a warning — auth is never gated on this.
 *
 * @param opts.refreshToken  The token string to persist.
 * @param opts.filePath      Override the storage path (for tests only).
 */
export function saveTokens(opts: { refreshToken: string; filePath?: string }): void {
  const filePath = opts.filePath ?? DEFAULT_TOKEN_PATH;
  const keyHex = process.env["TOKEN_ENCRYPTION_KEY"];
  if (!keyHex || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    return; // key not available — skip silently (warning already logged at startup)
  }

  try {
    const key = Buffer.from(keyHex, "hex");
    const iv = randomBytes(IV_BYTES);

    const payload: TokenPayload = {
      refreshToken: opts.refreshToken,
      savedAt: new Date().toISOString(),
    };
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: <iv (12 bytes)><tag (16 bytes)><ciphertext>
    const combined = Buffer.concat([iv, tag, encrypted]);

    const tmpPath = filePath + ".tmp";
    writeFileSync(tmpPath, combined);
    renameSync(tmpPath, filePath);
  } catch (err: any) {
    logger.warn(`[TokenStore] Failed to persist refresh token: ${err?.message ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Decrypts and returns the persisted token payload.
 * Returns null on any failure (missing file, corrupt data, wrong key, etc.).
 *
 * @param filePath  Override the storage path (for tests only).
 */
export function loadTokens(filePath?: string): { refreshToken: string; savedAt: Date } | null {
  const path = filePath ?? DEFAULT_TOKEN_PATH;
  const keyHex = process.env["TOKEN_ENCRYPTION_KEY"];
  if (!keyHex || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    return null;
  }

  try {
    if (!existsSync(path)) return null;

    const combined = readFileSync(path);
    if (combined.length < IV_BYTES + TAG_BYTES + 1) return null;

    const iv = combined.subarray(0, IV_BYTES);
    const tag = combined.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = combined.subarray(IV_BYTES + TAG_BYTES);

    const key = Buffer.from(keyHex, "hex");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload: TokenPayload = JSON.parse(decrypted.toString("utf8"));

    if (typeof payload.refreshToken !== "string" || !payload.refreshToken) return null;
    if (typeof payload.savedAt !== "string") return null;

    return {
      refreshToken: payload.refreshToken,
      savedAt: new Date(payload.savedAt),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token age
// ---------------------------------------------------------------------------

/**
 * Returns the age of the persisted token file in fractional days, or null if
 * the file does not exist.
 *
 * @param filePath  Override the storage path (for tests only).
 */
export function getTokenAgeDays(filePath?: string): number | null {
  const path = filePath ?? DEFAULT_TOKEN_PATH;
  try {
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs / (1000 * 60 * 60 * 24);
  } catch {
    return null;
  }
}
