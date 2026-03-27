/**
 * Exponential backoff with jitter and retry configuration.
 *
 * Ported from fake-hash-sync/src/auto-linker/agentRunner.js (lines 16-30).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Maximum number of retries (default: 3). */
  maxRetries: number;
  /** Base delay in milliseconds (default: 2000). */
  baseMs: number;
  /** Maximum delay cap in milliseconds (default: 30000). */
  maxMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseMs: 2000,
  maxMs: 30_000,
};

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Calculate exponential backoff with jitter.
 *
 * @param attempt - Zero-based attempt index
 * @param baseMs  - Base delay in milliseconds
 * @param maxMs   - Maximum delay cap in milliseconds
 * @returns Delay in milliseconds
 */
export function calculateBackoff(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, maxMs);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
