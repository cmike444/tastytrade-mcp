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

const toolStats = new Map<string, ToolStats>();
const httpStats = new Map<string, HttpStats>();

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
  };
}
