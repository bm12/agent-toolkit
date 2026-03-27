/**
 * Typed error classes for AI agent errors.
 *
 * Ported from fake-hash-sync/src/auto-linker/agentErrors.js (lines 10-64).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorKind =
  | 'quota_exceeded'
  | 'all_agents_quota_exceeded'
  | 'rate_limited'
  | 'upstream_overloaded'
  | 'auth_error'
  | 'permission_error'
  | 'retry_exhausted'
  | 'unknown';

export interface AgentErrorOptions {
  kind?: ErrorKind;
  retryable?: boolean;
  agentName?: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------

export class AgentError extends Error {
  readonly kind: ErrorKind;
  readonly retryable: boolean;
  readonly agentName: string;
  readonly details: unknown;

  constructor(
    message: string,
    {
      kind = 'unknown',
      retryable = false,
      agentName = 'unknown',
      details = null,
    }: AgentErrorOptions = {},
  ) {
    super(message);
    this.name = 'AgentError';
    this.kind = kind;
    this.retryable = retryable;
    this.agentName = agentName;
    this.details = details;
  }
}

export class AgentQuotaError extends AgentError {
  constructor(message: string, opts: Omit<AgentErrorOptions, 'kind' | 'retryable'> = {}) {
    super(message, { ...opts, kind: 'quota_exceeded', retryable: false });
    this.name = 'AgentQuotaError';
  }
}

export interface AllAgentsQuotaErrorOptions extends Omit<AgentErrorOptions, 'kind' | 'retryable'> {
  agents?: string[];
}

export class AllAgentsQuotaError extends AgentError {
  readonly agents: string[];

  constructor(message: string, { agents = [], ...opts }: AllAgentsQuotaErrorOptions = {}) {
    super(message, { ...opts, kind: 'all_agents_quota_exceeded', retryable: false });
    this.name = 'AllAgentsQuotaError';
    this.agents = agents;
  }
}

export class AgentRateLimitError extends AgentError {
  constructor(message: string, opts: Omit<AgentErrorOptions, 'kind' | 'retryable'> = {}) {
    super(message, { ...opts, kind: 'rate_limited', retryable: true });
    this.name = 'AgentRateLimitError';
  }
}

export class AgentUpstreamError extends AgentError {
  constructor(message: string, opts: Omit<AgentErrorOptions, 'kind' | 'retryable'> = {}) {
    super(message, { ...opts, kind: 'upstream_overloaded', retryable: true });
    this.name = 'AgentUpstreamError';
  }
}

export class AgentAuthError extends AgentError {
  constructor(message: string, opts: Omit<AgentErrorOptions, 'kind' | 'retryable'> = {}) {
    super(message, { ...opts, kind: 'auth_error', retryable: false });
    this.name = 'AgentAuthError';
  }
}

export interface AgentRetryExhaustedErrorOptions extends Omit<AgentErrorOptions, 'kind' | 'retryable'> {
  attempts?: number;
  lastError?: Error;
}

export class AgentRetryExhaustedError extends AgentError {
  readonly attempts: number;
  readonly lastError: Error | undefined;

  constructor(
    message: string,
    { attempts = 0, lastError, ...opts }: AgentRetryExhaustedErrorOptions = {},
  ) {
    super(message, { ...opts, kind: 'retry_exhausted', retryable: false });
    this.name = 'AgentRetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}
