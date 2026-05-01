#!/usr/bin/env node
/**
 * generate-enc-key.js
 *
 * Generates a fresh 64-char hex TOKEN_ENCRYPTION_KEY and prints
 * step-by-step instructions for saving it in Replit Secrets.
 *
 * Usage:  npm run generate:enc-key
 */

import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("hex");

console.log("");
console.log("=".repeat(70));
console.log("  TOKEN_ENCRYPTION_KEY Generator");
console.log("=".repeat(70));
console.log("");
console.log("  Your new encryption key (64 hex characters / 32 bytes):");
console.log("");
console.log(`  ${key}`);
console.log("");
console.log("  HOW TO SAVE IT IN REPLIT:");
console.log("");
console.log("  1. In the Replit sidebar, click the padlock icon (Secrets).");
console.log('  2. Click "+ New Secret".');
console.log("  3. Set the name to:   TOKEN_ENCRYPTION_KEY");
console.log("  4. Paste the key above as the value.");
console.log("  5. Click 'Add Secret'.");
console.log("  6. Restart the server — encrypted token persistence will be active.");
console.log("");
console.log("  IMPORTANT: keep this key safe. If you lose it, any previously");
console.log("  saved sessions cannot be decrypted and you will need to log in again.");
console.log("");
console.log("=".repeat(70));
console.log("");
