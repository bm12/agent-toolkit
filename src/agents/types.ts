/**
 * Agent module interfaces — shared contract for all CLI agent implementations.
 */

// ---------------------------------------------------------------------------
// Agent Configuration
// ---------------------------------------------------------------------------

export interface AgentConfig {
  /** Model name override (e.g. 'o4-mini', 'qwen-max'). */
  model?: string;
  /** Timeout in milliseconds (default: 300_000 = 5 min). */
  timeout?: number;
  /** Codex: enable --search flag for web search. */
  search?: boolean;
  /** Qwen: --auth-type value (e.g. 'qwen-oauth'). */
  authType?: string;
  /** Working directory for CLI process. */
  cwd?: string;
  /** Extra environment variables for CLI process. */
  env?: Record<string, string>;
}

export const DEFAULT_TIMEOUT = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// Agent Run Options
// ---------------------------------------------------------------------------

export interface AgentRunOptions {
  /** The prompt text to send to the agent. */
  prompt: string;
  /** Path to a JSON Schema file (codex: --output-schema). */
  outputSchema?: string;
  /** Path for the output file (codex: -o). */
  outputFile?: string;
}

// ---------------------------------------------------------------------------
// Agent Run Result
// ---------------------------------------------------------------------------

export interface AgentRunResult<T = unknown> {
  /** Parsed JSON response (null if parsing failed). */
  parsed: T | null;
  /** Raw output text (from output file or extracted result). */
  raw: string;
  /** Full stdout from the CLI process. */
  stdout: string;
  /** Full stderr from the CLI process. */
  stderr: string;
  /** Which agent actually executed ('codex' | 'qwen'). */
  agentUsed: string;
}

// ---------------------------------------------------------------------------
// Executor Hooks
// ---------------------------------------------------------------------------

export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export interface ExecutorHooks {
  /** Optional logger for agent operations. */
  logger?: Logger;
  /** Callback for raw CLI output (useful for debug/save). */
  onRawOutput?: (data: { stdout: string; stderr: string; agent: string }) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Agent Module Interface
// ---------------------------------------------------------------------------

/**
 * Interface that each agent implementation must satisfy.
 */
export interface AgentModule {
  /**
   * Execute the agent CLI with the given prompt and configuration.
   *
   * @param prompt  - The full prompt text
   * @param config  - Agent-specific configuration
   * @param hooks   - Optional hooks for logging and raw output
   * @returns Agent run result with parsed output
   */
  execAgent<T = unknown>(
    prompt: string,
    config: AgentConfig,
    options: AgentRunOptions,
    hooks?: ExecutorHooks,
  ): Promise<AgentRunResult<T>>;
}
