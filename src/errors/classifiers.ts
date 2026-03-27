/**
 * Error classifiers for Codex and Qwen CLI output.
 *
 * Ported from fake-hash-sync/src/auto-linker/agentErrors.js (lines 66-259).
 */

import {
  AgentError,
  AgentQuotaError,
  AgentRateLimitError,
  AgentUpstreamError,
  AgentAuthError,
} from './classes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorClassification {
  kind:
    | 'quota_exceeded'
    | 'rate_limited'
    | 'upstream_overloaded'
    | 'auth_error'
    | 'permission_error'
    | 'unknown';
  retryable: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface CodexEvent {
  type?: string;
  error?: {
    code?: string;
    type?: string;
    message?: string;
    status?: number;
    status_code?: number;
  } | string;
  message?: string;
  status?: number;
}

/**
 * Extract a human-readable message from a JSONL event object.
 */
function extractEventMessage(event: CodexEvent): string | null {
  if (typeof event?.error === 'object' && event.error?.message) return event.error.message;
  if (event?.message) return event.message;
  if (typeof event?.error === 'string') return event.error;
  return null;
}

/**
 * Test whether a string matches a pattern (case-insensitive).
 */
function ci(text: string, pattern: string): boolean {
  return text.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Return the HTTP status embedded in an event, if any.
 */
function eventStatus(event: CodexEvent): number | null {
  if (typeof event?.error === 'object') {
    return event.error.status ?? event.error.status_code ?? null;
  }
  return (event as Record<string, unknown>)?.status as number ?? null;
}

// ---------------------------------------------------------------------------
// Codex Classifier
// ---------------------------------------------------------------------------

/**
 * Classify an error produced by a Codex CLI invocation.
 *
 * @param events   - parsed JSONL event objects from Codex stdout
 * @param stderr   - stderr output
 * @param exitCode - process exit code
 */
export function classifyCodexError(
  events: CodexEvent[] | null | undefined,
  stderr: string,
  exitCode: number | null,
): ErrorClassification {
  // 1. Search JSONL events for error-bearing entries
  const errorEvents = (events ?? []).filter(
    (e) => e?.type === 'turn.failed' || e?.type === 'error' || e?.error,
  );

  for (const event of errorEvents) {
    const errorObj = typeof event?.error === 'object' ? event.error : null;
    const code = errorObj?.code ?? '';
    const type = errorObj?.type ?? '';
    const msg = extractEventMessage(event) ?? '';
    const status = eventStatus(event);
    const combined = `${code} ${type} ${msg}`.toLowerCase();

    // Quota
    if (
      code === 'insufficient_quota' ||
      type === 'insufficient_quota' ||
      ci(combined, 'insufficient_quota')
    ) {
      return { kind: 'quota_exceeded', retryable: false, message: msg || 'Codex quota exceeded' };
    }

    // Rate limit (429 without quota indicators)
    if (
      (status === 429 ||
        ci(combined, 'rate limit') ||
        ci(combined, 'too many requests') ||
        combined.includes('429')) &&
      !ci(combined, 'insufficient_quota') &&
      !ci(combined, 'quota')
    ) {
      return { kind: 'rate_limited', retryable: true, message: msg || 'Codex rate limited' };
    }

    // Upstream overloaded
    if (
      status === 503 ||
      ci(combined, 'overloaded') ||
      ci(combined, 'slow down') ||
      combined.includes('503')
    ) {
      return {
        kind: 'upstream_overloaded',
        retryable: true,
        message: msg || 'Codex upstream overloaded',
      };
    }

    // Auth
    if (
      status === 401 ||
      ci(combined, 'invalid authentication') ||
      ci(combined, 'incorrect api key') ||
      combined.includes('401')
    ) {
      return {
        kind: 'auth_error',
        retryable: false,
        message: msg || 'Codex authentication error',
      };
    }

    // Permission / forbidden
    if (
      status === 403 ||
      ci(combined, 'permission') ||
      ci(combined, 'forbidden') ||
      combined.includes('403')
    ) {
      return {
        kind: 'permission_error',
        retryable: false,
        message: msg || 'Codex permission error',
      };
    }
  }

  // 2. Fall back to stderr text
  if (stderr) {
    const lower = stderr.toLowerCase();

    if (lower.includes('insufficient_quota') || lower.includes('quota exceeded')) {
      return { kind: 'quota_exceeded', retryable: false, message: stderr };
    }
    if (
      (lower.includes('429') ||
        lower.includes('rate limit') ||
        lower.includes('too many requests')) &&
      !lower.includes('insufficient_quota') &&
      !lower.includes('quota')
    ) {
      return { kind: 'rate_limited', retryable: true, message: stderr };
    }
    if (lower.includes('503') || lower.includes('overloaded') || lower.includes('slow down')) {
      return { kind: 'upstream_overloaded', retryable: true, message: stderr };
    }
    if (
      lower.includes('401') ||
      lower.includes('invalid authentication') ||
      lower.includes('incorrect api key')
    ) {
      return { kind: 'auth_error', retryable: false, message: stderr };
    }
    if (lower.includes('403') || lower.includes('permission') || lower.includes('forbidden')) {
      return { kind: 'permission_error', retryable: false, message: stderr };
    }
  }

  // 3. Default
  return {
    kind: 'unknown',
    retryable: false,
    message: stderr || `Codex failed with exit code ${exitCode}`,
  };
}

// ---------------------------------------------------------------------------
// Qwen Classifier
// ---------------------------------------------------------------------------

/**
 * Classify an error produced by a Qwen CLI invocation.
 *
 * @param stdout   - full stdout
 * @param stderr   - full stderr
 * @param exitCode - process exit code
 */
export function classifyQwenError(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): ErrorClassification {
  const combined = `${stdout ?? ''}\n${stderr ?? ''}`;
  const lower = combined.toLowerCase();

  // 1. Quota patterns
  if (
    lower.includes('free allocated quota exceeded') ||
    lower.includes('quota has been exhausted') ||
    lower.includes('insufficient_quota') ||
    lower.includes('quota exceeded')
  ) {
    return { kind: 'quota_exceeded', retryable: false, message: combined.trim() };
  }

  // 2. Rate limit (429 + matching text, without quota patterns)
  if (
    lower.includes('429') &&
    (lower.includes('too many requests') || lower.includes('rate limit')) &&
    !lower.includes('quota') &&
    !lower.includes('insufficient_quota')
  ) {
    return { kind: 'rate_limited', retryable: true, message: combined.trim() };
  }

  // 3. Auth patterns
  if (
    lower.includes('unauthorized') ||
    lower.includes('authorization timeout') ||
    lower.includes('device code expired') ||
    lower.includes('401')
  ) {
    return { kind: 'auth_error', retryable: false, message: combined.trim() };
  }

  // 4. Default
  return {
    kind: 'unknown',
    retryable: false,
    message: stderr || stdout || `Qwen failed with exit code ${exitCode}`,
  };
}

// ---------------------------------------------------------------------------
// Helper: throw classified error
// ---------------------------------------------------------------------------

/**
 * Takes a classification result and throws the appropriate typed AgentError.
 *
 * @param classification - The error classification
 * @param agentName      - Name of the agent that produced the error
 */
export function throwClassifiedError(
  classification: ErrorClassification,
  agentName: string,
): never {
  const opts = { agentName, details: classification };
  switch (classification.kind) {
    case 'quota_exceeded':
      throw new AgentQuotaError(classification.message, opts);
    case 'rate_limited':
      throw new AgentRateLimitError(classification.message, opts);
    case 'upstream_overloaded':
      throw new AgentUpstreamError(classification.message, opts);
    case 'auth_error':
    case 'permission_error':
      throw new AgentAuthError(classification.message, opts);
    default:
      throw new AgentError(classification.message, { ...opts, kind: classification.kind });
  }
}
