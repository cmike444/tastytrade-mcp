import { logger } from "./logger.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

const parseEnvInt = (key: string, fallback: number, min: number): number =>
  Math.max(min, parseInt(process.env[key] || "", 10) || fallback);

export const failureThreshold = parseEnvInt("CIRCUIT_BREAKER_FAILURE_THRESHOLD", 5, 1);
export const resetTimeoutMs = parseEnvInt("CIRCUIT_BREAKER_RESET_TIMEOUT_MS", 30_000, 1_000);

let state: CircuitState = "CLOSED";
let failureCount = 0;
let nextProbeAt: number | null = null;
let probeInFlight = false;

type MaybeHttpError = { response?: { status?: number }; status?: number; statusCode?: number; message?: string };

function httpStatus(err: MaybeHttpError): number | null {
  const s = err?.response?.status ?? err?.status ?? err?.statusCode;
  return typeof s === "number" ? s : null;
}

/**
 * 4xx client errors (excluding 429) do not indicate API unavailability.
 * 429 and 5xx/network errors are retryable and count toward the threshold.
 */
function isRetryable(err: MaybeHttpError): boolean {
  const s = httpStatus(err);
  return s === null || s >= 500 || s === 429;
}

function transitionToOpen(): void {
  state = "OPEN";
  probeInFlight = false;
  nextProbeAt = Date.now() + resetTimeoutMs;
  logger.warn(`[CircuitBreaker] OPEN after ${failureCount} failure(s). Next probe: ${new Date(nextProbeAt).toISOString()}`);
}

function onSuccess(): void {
  const wasOpen = state !== "CLOSED";
  state = "CLOSED";
  failureCount = 0;
  nextProbeAt = null;
  probeInFlight = false;
  if (wasOpen) logger.info("[CircuitBreaker] CLOSED — API healthy.");
}

function onRetryableFailure(): void {
  failureCount++;
  if (state === "HALF_OPEN") {
    logger.warn("[CircuitBreaker] Probe failed — re-opening.");
    transitionToOpen();
    return;
  }
  if (state === "CLOSED" && failureCount >= failureThreshold) {
    transitionToOpen();
  }
}

function retrySeconds(): number {
  return nextProbeAt ? Math.max(0, Math.ceil((nextProbeAt - Date.now()) / 1000)) : 0;
}

/**
 * Runs fn through the circuit breaker.
 * CLOSED:    normal; retryable failures increment the counter.
 * OPEN:      fast-fail unless cooling-off elapsed, then one probe is allowed.
 * HALF_OPEN: probe caller executes fn; concurrent callers fast-fail.
 *   - 2xx probe success       → CLOSED
 *   - 4xx (non-429) probe     → CLOSED (API is reachable; surface client error)
 *   - 429/5xx/network probe   → OPEN
 */
export async function execute<T>(fn: () => Promise<T>): Promise<T> {
  let isProbe = false;

  if (state === "OPEN") {
    if (nextProbeAt !== null && Date.now() >= nextProbeAt && !probeInFlight) {
      state = "HALF_OPEN";
      probeInFlight = true;
      isProbe = true;
      logger.info("[CircuitBreaker] Entering HALF_OPEN for probe.");
    } else {
      throw new Error(`TastyTrade API is currently unreachable. Retrying in ${retrySeconds()}s.`);
    }
  }

  if (state === "HALF_OPEN" && !isProbe) {
    throw new Error("TastyTrade API is currently unreachable. Retrying in 0s.");
  }

  try {
    const result = await fn();
    onSuccess();
    return result;
  } catch (rawErr) {
    const err = rawErr as MaybeHttpError;
    if (!isRetryable(err)) {
      // Non-retryable 4xx: the API is reachable. Reset the consecutive-failure
      // streak so only truly uninterrupted retryable failures open the circuit.
      // During a probe, also transition to CLOSED explicitly.
      if (isProbe) {
        const s = httpStatus(err);
        logger.info(`[CircuitBreaker] Probe received ${s} — API reachable. Circuit CLOSED.`);
        onSuccess();
      } else {
        failureCount = 0;
        probeInFlight = false;
      }
    } else {
      probeInFlight = false;
      onRetryableFailure();
    }
    throw rawErr;
  }
}

export function getCircuitBreakerStatus() {
  return {
    state,
    failureCount,
    nextProbeAt: nextProbeAt ? new Date(nextProbeAt).toISOString() : null,
    retryInSeconds: state === "OPEN" && nextProbeAt ? retrySeconds() : null,
    thresholds: { failureThreshold, resetTimeoutMs },
  };
}

/**
 * True when the circuit is blocking new calls.
 * Returns false when OPEN+elapsed+no probe in flight so the caller can reach
 * execute() and act as the probe.
 */
export function isOpen(): boolean {
  if (state === "HALF_OPEN") return true;
  if (state === "OPEN") {
    return !(nextProbeAt !== null && Date.now() >= nextProbeAt && !probeInFlight);
  }
  return false;
}

export function openErrorMessage(): string {
  return `TastyTrade API is currently unreachable. Retrying in ${retrySeconds()}s.`;
}
