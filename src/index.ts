/**
 * agent-toolkit — Public API
 *
 * Shared AI agent infrastructure for Codex CLI and Qwen CLI executors
 * with error handling, retry logic, and fallback orchestration.
 */

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export { createAgentExecutor } from './executor.js';
export type { AgentExecutorConfig, AgentExecutor, AgentName } from './executor.js';

export { createBatchRunner } from './batch.js';
export type { BatchRunnerConfig, BatchRunner } from './batch.js';

// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------

export type {
  AgentConfig,
  AgentRunOptions,
  AgentRunResult,
  ExecutorHooks,
  Logger,
  AgentModule,
} from './agents/types.js';

export { DEFAULT_TIMEOUT } from './agents/types.js';

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

export type { RetryConfig } from './retry/backoff.js';
export { DEFAULT_RETRY_CONFIG, calculateBackoff, sleep } from './retry/backoff.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export {
  AgentError,
  AgentQuotaError,
  AllAgentsQuotaError,
  AgentRateLimitError,
  AgentUpstreamError,
  AgentAuthError,
  AgentRetryExhaustedError,
} from './errors/classes.js';

export type {
  ErrorKind,
  AgentErrorOptions,
  AllAgentsQuotaErrorOptions,
  AgentRetryExhaustedErrorOptions,
} from './errors/classes.js';

export type { ErrorClassification } from './errors/classifiers.js';

export {
  classifyCodexError,
  classifyQwenError,
  throwClassifiedError,
} from './errors/classifiers.js';

// ---------------------------------------------------------------------------
// Parsers & utilities
// ---------------------------------------------------------------------------

export {
  extractJson,
  parseJsonlEvents,
  extractQwenResult,
  buildSchemaPromptSuffix,
} from './parsers/output.js';
