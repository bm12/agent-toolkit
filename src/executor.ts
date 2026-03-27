/**
 * Agent executor — factory function with retry logic.
 *
 * Ported from fake-hash-sync/src/auto-linker/agentRunner.js (lines 134-204).
 */

import type {
  AgentConfig,
  AgentRunOptions,
  AgentRunResult,
  ExecutorHooks,
} from './agents/types.js';
import type { RetryConfig } from './retry/backoff.js';
import { DEFAULT_RETRY_CONFIG, calculateBackoff, sleep } from './retry/backoff.js';
import { AgentQuotaError, AgentRetryExhaustedError, AgentError } from './errors/classes.js';
import { execAgent as execCodex } from './agents/codex.js';
import { execAgent as execQwen } from './agents/qwen.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentName = 'codex' | 'qwen';

export interface AgentExecutorConfig {
  /** Configuration for each agent. Provide at least one. */
  agents: {
    codex?: AgentConfig;
    qwen?: AgentConfig;
  };
  /** The primary agent to use. */
  primaryAgent: AgentName;
  /** Retry configuration (defaults to 3 retries, 2s base, 30s max). */
  retry?: Partial<RetryConfig>;
  /** Optional hooks for logging and raw output callbacks. */
  hooks?: ExecutorHooks;
}

export interface AgentExecutor {
  /**
   * Run an agent with retry logic.
   *
   * - Retryable errors → backoff + retry
   * - Quota errors → propagate immediately (no retry)
   * - After retries exhausted → AgentRetryExhaustedError
   */
  run<T = unknown>(options: AgentRunOptions, agentOverride?: AgentName): Promise<AgentRunResult<T>>;
}

// ---------------------------------------------------------------------------
// Agent dispatch
// ---------------------------------------------------------------------------

type ExecFn = <T = unknown>(
  prompt: string,
  config: AgentConfig,
  options: AgentRunOptions,
  hooks?: ExecutorHooks,
) => Promise<AgentRunResult<T>>;

function getAgentExec(agentName: AgentName): ExecFn {
  switch (agentName) {
    case 'codex':
      return execCodex;
    case 'qwen':
      return execQwen;
    default:
      throw new Error(`Unknown AI agent: "${agentName as string}"`);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an agent executor with retry logic.
 *
 * @param config - Executor configuration
 * @returns AgentExecutor instance
 */
export function createAgentExecutor(config: AgentExecutorConfig): AgentExecutor {
  const retryConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...config.retry,
  };

  return {
    async run<T = unknown>(
      options: AgentRunOptions,
      agentOverride?: AgentName,
    ): Promise<AgentRunResult<T>> {
      const agentName = agentOverride ?? config.primaryAgent;
      const agentConfig = config.agents[agentName];

      if (!agentConfig) {
        throw new Error(
          `Agent "${agentName}" is not configured. Available agents: ${Object.keys(config.agents).join(', ')}`,
        );
      }

      const exec = getAgentExec(agentName);
      const { maxRetries, baseMs, maxMs } = retryConfig;
      const logger = config.hooks?.logger;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await exec<T>(options.prompt, agentConfig, options, config.hooks);
          return result; // success
        } catch (error) {
          // Never retry quota errors — propagate immediately
          if (error instanceof AgentQuotaError) {
            throw error;
          }

          const isRetryable =
            error instanceof AgentError ? error.retryable : false;

          // Retryable error with remaining attempts
          if (isRetryable && attempt < maxRetries) {
            const backoff = calculateBackoff(attempt, baseMs, maxMs);
            const kind = error instanceof AgentError ? error.kind : 'unknown';
            logger?.warn(
              `[Agent] Agent error (${kind}), retrying in ${Math.round(backoff)}ms ` +
                `(attempt ${attempt + 1}/${maxRetries + 1})...`,
            );
            await sleep(backoff);
            continue;
          }

          // Retryable error but retries exhausted
          if (isRetryable && attempt >= maxRetries) {
            throw new AgentRetryExhaustedError(
              `Agent retries exhausted after ${maxRetries + 1} attempts: ${error instanceof Error ? error.message : String(error)}`,
              {
                attempts: maxRetries + 1,
                lastError: error instanceof Error ? error : new Error(String(error)),
                agentName,
              },
            );
          }

          // Non-retryable, non-quota error — propagate as-is
          throw error;
        }
      }

      // Should never reach here, but TypeScript needs a return
      throw new Error('Unexpected end of retry loop');
    },
  };
}
