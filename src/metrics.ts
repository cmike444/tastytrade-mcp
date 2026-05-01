import { getSkillCacheStats } from "./resources/skill-resources.js";
import { promises as fs } from "node:fs";
import path from "node:path";

const METRICS_FILE = path.resolve(".metrics.json");
const PERSIST_INTERVAL_MS = 60_000;

const startTime = Date.now();

interface ToolStats {
  calls: number;
  errors: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

interface HttpStats {
  calls: number;
  errors: number;
}

interface PersistedSnapshot {
  toolStats: Record<string, ToolStats>;
  httpStats: Record<string, HttpStats>;
}

const toolStats = new Map<string, ToolStats>();
const httpStats = new Map<string, HttpStats>();

// Load persisted snapshot from disk at startup so metrics survive restarts.
async function loadPersistedMetrics(): Promise<void> {
  try {
    const raw = await fs.readFile(METRICS_FILE, "utf-8");
    const snap: PersistedSnapshot = JSON.parse(raw);

    if (snap.toolStats && typeof snap.toolStats === "object") {
      for (const [name, s] of Object.entries(snap.toolStats)) {
        if (s && typeof s.calls === "number") {
          toolStats.set(name, {
            calls: s.calls,
            errors: s.errors ?? 0,
            totalMs: s.totalMs ?? 0,
            minMs: s.minMs ?? Infinity,
            maxMs: s.maxMs ?? 0,
          });
        }
      }
    }

    if (snap.httpStats && typeof snap.httpStats === "object") {
      for (const [p, s] of Object.entries(snap.httpStats)) {
        if (s && typeof s.calls === "number") {
          httpStats.set(p, { calls: s.calls, errors: s.errors ?? 0 });
        }
      }
    }
  } catch {
    // File doesn't exist or is malformed — start fresh.
  }
}

// Persist current counters to disk.
async function persistMetrics(): Promise<void> {
  try {
    const snap: PersistedSnapshot = {
      toolStats: Object.fromEntries(toolStats),
      httpStats: Object.fromEntries(httpStats),
    };
    await fs.writeFile(METRICS_FILE, JSON.stringify(snap), "utf-8");
  } catch {
    // Non-fatal — don't crash the server over a failed write.
  }
}

// Start the periodic persistence loop.
export function startMetricsPersistence(): void {
  setInterval(() => {
    persistMetrics().catch(() => {});
  }, PERSIST_INTERVAL_MS).unref();
}

// Load on module init (async; callers that need it done synchronously should
// call and await initMetrics() before starting the server).
export async function initMetrics(): Promise<void> {
  await loadPersistedMetrics();
}

export function recordToolCall(name: string, latencyMs: number, isError: boolean): void {
  let s = toolStats.get(name);
  if (!s) {
    s = { calls: 0, errors: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
    toolStats.set(name, s);
  }
  s.calls++;
  if (isError) s.errors++;
  s.totalMs += latencyMs;
  if (latencyMs < s.minMs) s.minMs = latencyMs;
  if (latencyMs > s.maxMs) s.maxMs = latencyMs;
}

export function recordHttpRequest(path: string, statusCode: number): void {
  let s = httpStats.get(path);
  if (!s) {
    s = { calls: 0, errors: 0 };
    httpStats.set(path, s);
  }
  s.calls++;
  if (statusCode >= 400) s.errors++;
}

export function getMetricsSnapshot() {
  const uptimeMs = Date.now() - startTime;
  const mem = process.memoryUsage();

  const tools = Array.from(toolStats.entries())
    .map(([name, s]) => ({
      name,
      calls: s.calls,
      errors: s.errors,
      avgMs: s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0,
      minMs: s.calls > 0 ? Math.round(s.minMs) : 0,
      maxMs: Math.round(s.maxMs),
      totalMs: Math.round(s.totalMs),
    }))
    .sort((a, b) => b.calls - a.calls);

  const http = Object.fromEntries(
    Array.from(httpStats.entries()).map(([path, s]) => [path, s])
  );

  return {
    server: {
      uptimeSeconds: Math.floor(uptimeMs / 1000),
      startedAt: new Date(startTime).toISOString(),
      nodeVersion: process.version,
      memoryMB: {
        rss: parseFloat((mem.rss / 1024 / 1024).toFixed(1)),
        heapUsed: parseFloat((mem.heapUsed / 1024 / 1024).toFixed(1)),
        heapTotal: parseFloat((mem.heapTotal / 1024 / 1024).toFixed(1)),
      },
    },
    tools,
    http,
    skillCache: getSkillCacheStats(),
  };
}
