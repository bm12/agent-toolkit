/**
 * Batch runner with fallback orchestration between agents.
 *
 * Ported from fake-hash-sync/src/auto-linker/index.js (lines 116-203).
 *
 * When one agent's quota is exhausted, automatically switches to the next
 * available agent. When all agents are exhausted, throws AllAgentsQuotaError.
 */

import type { AgentRunOptions, AgentRunResult, ExecutorHooks } from './agents/types.js';
import type { RetryConfig } from './retry/backoff.js';
import type { AgentName, AgentExecutorConfig } from './executor.js';
import { createAgentExecutor } from './executor.js';
import { AgentQuotaError, AllAgentsQuotaError } from './errors/classes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchRunnerConfig extends AgentExecutorConfig {
  /** Callback fired when falling back from one agent to another. */
  onFallback?: (fromAgent: string, toAgent: string) => void | Promise<void>;
  /** Callback fired when all agents are exhausted. */
  onAllExhausted?: (agents: string[]) => void | Promise<void>;
}

export interface BatchRunner {
  /**
   * Execute a single task in the batch context.
   *
   * On quota error — automatically falls back to the next available agent.
   * On all agents exhausted — throws AllAgentsQuotaError.
   */
  run<T = unknown>(options: AgentRunOptions): Promise<AgentRunResult<T>>;

  /** The currently active agent. */
  readonly currentAgent: string;

  /** Set of agents whose quota has been exhausted. */
  readonly exhaustedAgents: ReadonlySet<string>;

  /** Reset batch state (exhaustedAgents, currentAgent → primary). */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a batch runner with fallback orchestration.
 *
 * @param config - Batch runner configuration
 * @returns BatchRunner instance
 */
export function createBatchRunner(config: BatchRunnerConfig): BatchRunner {
  const executor = createAgentExecutor(config);
  const availableAgents: AgentName[] = Object.keys(config.agents).filter(
    (key): key is AgentName => config.agents[key as AgentName] !== undefined,
  );

  let currentAgent: AgentName = config.primaryAgent;
  const exhaustedAgents = new Set<string>();
  const logger = config.hooks?.logger;

  return {
    get currentAgent(): string {
      return currentAgent;
    },

    get exhaustedAgents(): ReadonlySet<string> {
      return exhaustedAgents;
    },

    reset(): void {
      currentAgent = config.primaryAgent;
      exhaustedAgents.clear();
      logger?.info(`[BatchRunner] Reset: primary agent restored to "${config.primaryAgent}"`);
    },

    async run<T = unknown>(options: AgentRunOptions): Promise<AgentRunResult<T>> {
      try {
        return await executor.run<T>(options, currentAgent);
      } catch (error) {
        if (!(error instanceof AgentQuotaError)) {
          throw error;
        }

        // Mark current agent as exhausted
        exhaustedAgents.add(currentAgent);

        // Find a fallback agent
        const fallbackAgent = availableAgents.find((a) => !exhaustedAgents.has(a));

        if (!fallbackAgent) {
          // All agents exhausted
          logger?.error(
            `[BatchRunner] All agents quota exceeded: ${[...exhaustedAgents].join(', ')}`,
          );
          if (config.onAllExhausted) {
            try {
              await config.onAllExhausted([...exhaustedAgents]);
            } catch {
              // ignore callback errors
            }
          }
          throw new AllAgentsQuotaError(
            `All agents quota exceeded: ${[...exhaustedAgents].join(', ')}`,
            { agents: [...exhaustedAgents] },
          );
        }

        // Switch to fallback agent
        logger?.warn(
          `[BatchRunner] Agent "${currentAgent}" quota exceeded, switching to "${fallbackAgent}"`,
        );
        if (config.onFallback) {
          try {
            await config.onFallback(currentAgent, fallbackAgent);
          } catch {
            // ignore callback errors
          }
        }

        const previousAgent = currentAgent;
        currentAgent = fallbackAgent;

        // Retry the same task with the fallback agent
        try {
          return await executor.run<T>(options, currentAgent);
        } catch (retryError) {
          if (retryError instanceof AgentQuotaError) {
            // Fallback agent also exhausted
            exhaustedAgents.add(currentAgent);
            logger?.error(
              `[BatchRunner] All agents quota exceeded: ${[...exhaustedAgents].join(', ')}`,
            );
            if (config.onAllExhausted) {
              try {
                await config.onAllExhausted([...exhaustedAgents]);
              } catch {
                // ignore callback errors
              }
            }
            throw new AllAgentsQuotaError(
              `All agents quota exceeded: ${[...exhaustedAgents].join(', ')}`,
              { agents: [...exhaustedAgents] },
            );
          }
          // Non-quota error from fallback — propagate
          throw retryError;
        }
      }
    },
  };
}
