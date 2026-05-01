#!/usr/bin/env node
/**
 * Skill guide drift detection.
 *
 * Reads all tool names from src/tools/tool-registry.ts and checks that
 * every name appears at least once in skills/tastytrade/mcp-tool-reference.md.
 *
 * Exit code 0  — all tools are documented.
 * Exit code 1  — one or more tools are missing from the guide.
 *
 * Usage:
 *   node scripts/check-skill-drift.js
 *   node scripts/check-skill-drift.js --fix   (prints stub entries to add)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// --- 1. Extract tool names from the registry ---
const registryPath = resolve(ROOT, "src/tools/tool-registry.ts");
const registryText = readFileSync(registryPath, "utf-8");

const toolNames = [];
for (const match of registryText.matchAll(/name:\s*"([^"]+)"/g)) {
  toolNames.push(match[1]);
}

if (toolNames.length === 0) {
  console.error("ERROR: No tool names found in tool-registry.ts. Check the file path.");
  process.exit(1);
}

// --- 2. Load the skill guide ---
const guidePath = resolve(ROOT, "skills/tastytrade/references/mcp-tool-reference.md");
let guideText;
try {
  guideText = readFileSync(guidePath, "utf-8");
} catch {
  console.error(`ERROR: Skill guide not found at ${guidePath}`);
  process.exit(1);
}

// --- 3. Check each tool name ---
const missing = [];
for (const name of toolNames) {
  if (!guideText.includes(name)) {
    missing.push(name);
  }
}

const fix = process.argv.includes("--fix");

if (missing.length === 0) {
  console.log(`✓ All ${toolNames.length} tools are documented in the skill guide.`);
  process.exit(0);
} else {
  console.error(`✗ ${missing.length} tool(s) missing from the skill guide:\n`);
  for (const name of missing) {
    console.error(`  - ${name}`);
  }

  if (fix) {
    console.log("\n--- Stub entries to add to mcp-tool-reference.md ---\n");
    for (const name of missing) {
      console.log(`### \`${name}\`\n**Category**: _TODO_  \n**Description**: _TODO_\n`);
    }
  } else {
    console.error('\nRun with --fix to see stub entries, or add them manually to skills/tastytrade/mcp-tool-reference.md');
  }

  process.exit(1);
}
