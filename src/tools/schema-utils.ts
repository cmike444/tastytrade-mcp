export function coerceToArray(val: unknown): unknown {
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}
