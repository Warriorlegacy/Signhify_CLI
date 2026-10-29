/**
 * Token speed meter and telemetry helpers for CLI sessions.
 */

/**
 * Calculates token generation speed in tokens per second (tok/s).
 *
 * Accurate calculation: tracks elapsed time from the start timestamp of the
 * first stream token to completion, dividing completion tokens by elapsed seconds.
 *
 * @param completionTokens Number of generated output tokens
 * @param elapsedOrStartMs Elapsed duration in milliseconds, or start timestamp (if endMs provided)
 * @param endMs Optional end timestamp (if elapsedOrStartMs is start timestamp)
 * @returns Speed in tokens/sec, or null if cannot be calculated
 */
export function calculateTokenSpeed(
  completionTokens: number | undefined | null,
  elapsedOrStartMs: number | null | undefined,
  endMs?: number
): number | null {
  if (
    completionTokens === undefined ||
    completionTokens === null ||
    completionTokens <= 0 ||
    elapsedOrStartMs === null ||
    elapsedOrStartMs === undefined
  ) {
    return null;
  }

  const elapsedMs = endMs !== undefined ? endMs - elapsedOrStartMs : elapsedOrStartMs;
  if (elapsedMs <= 0) {
    return null;
  }

  return (completionTokens * 1000) / elapsedMs;
}

/**
 * Formats token speed for display.
 * e.g. "45.2 tok/s" or "unavailable"
 */
export function formatTokenSpeed(tokPerSec: number | null | undefined): string {
  if (tokPerSec === null || tokPerSec === undefined || !Number.isFinite(tokPerSec) || tokPerSec < 0) {
    return "unavailable";
  }
  return `${tokPerSec.toFixed(1)} tok/s`;
}

/**
 * Formats session token usage and speed summary for CLI footer or /usage output.
 */
export function formatSessionSummary(params: {
  usedTokens: number;
  limitTokens: number;
  activeRouterInfo: string;
  tokensPerSecond: number | null | undefined;
  mode: string;
}): string {
  const pct = params.limitTokens > 0 ? (params.usedTokens / params.limitTokens) * 100 : 0;
  return (
    `Session usage: ${params.usedTokens.toLocaleString()} / ${params.limitTokens.toLocaleString()} tokens ` +
    `(${pct.toFixed(1)}%). Endpoint: ${params.activeRouterInfo}. Output speed: ${formatTokenSpeed(params.tokensPerSecond)}. Mode: ${params.mode}.`
  );
}

/**
 * TokenSpeedMeter tracks generation start on the first stream token
 * and computes accurate tokens/second rate on completion.
 */
export class TokenSpeedMeter {
  private startTimestamp: number | null = null;
  private currentSpeed: number | null = null;

  /**
   * Track start timestamp on the first stream token.
   * Only records timestamp on the first token received.
   */
  trackFirstToken(timestamp: number = Date.now()): void {
    if (this.startTimestamp === null) {
      this.startTimestamp = timestamp;
    }
  }

  /**
   * Whether the meter is currently tracking an in-flight stream.
   */
  isTracking(): boolean {
    return this.startTimestamp !== null;
  }

  /**
   * Returns the start timestamp recorded for the current stream, if any.
   */
  getStartTimestamp(): number | null {
    return this.startTimestamp;
  }

  /**
   * Calculate tokens per second on stream completion and reset start timestamp.
   *
   * @param completionTokens Number of generated output tokens
   * @param endTimestamp Completion timestamp (defaults to Date.now())
   * @returns Calculated tokens/second or null
   */
  recordCompletion(
    completionTokens: number | undefined | null,
    endTimestamp: number = Date.now()
  ): number | null {
    if (this.startTimestamp === null) {
      this.currentSpeed = null;
      return null;
    }
    const elapsedMs = endTimestamp - this.startTimestamp;
    this.currentSpeed = calculateTokenSpeed(completionTokens, elapsedMs);
    this.startTimestamp = null;
    return this.currentSpeed;
  }

  /**
   * Returns the most recent token speed measurement.
   */
  getSpeed(): number | null {
    return this.currentSpeed;
  }

  /**
   * Reset meter state.
   */
  reset(): void {
    this.startTimestamp = null;
    this.currentSpeed = null;
  }
}
