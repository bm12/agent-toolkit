/**
 * Qwen CLI agent — spawn, JSON event parsing, error classification.
 *
 * Ported from fake-hash-sync/src/auto-linker/qwenAgent.js.
 *
 * Key differences from Codex:
 * - No --output-schema flag; schema is embedded in the prompt
 * - No -o flag; output is captured from stdout
 * - stdout is a JSON array of event objects (--output-format json)
 * - Result is extracted from the event with type === 'result'
 */

import { spawn } from 'node:child_process';
import type { AgentConfig, AgentRunOptions, AgentRunResult, ExecutorHooks } from './types.js';
import { DEFAULT_TIMEOUT } from './types.js';
import { classifyQwenError, throwClassifiedError } from '../errors/classifiers.js';
import { extractQwenResult } from '../parsers/output.js';

/**
 * Execute the Qwen Code CLI agent with the given prompt and configuration.
 *
 * Builds CLI args: --output-format json, --auth-type, --model
 * Collects stdout (JSON array) and stderr, parses events, classifies errors.
 *
 * @param prompt  - The full prompt text (schema should already be appended by consumer)
 * @param config  - Qwen-specific configuration
 * @param options - Run options (outputSchema and outputFile are ignored for Qwen)
 * @param hooks   - Optional hooks for logging and raw output
 * @returns Agent run result with parsed output
 */
export async function execAgent<T = unknown>(
  prompt: string,
  config: AgentConfig,
  options: AgentRunOptions,
  hooks?: ExecutorHooks,
): Promise<AgentRunResult<T>> {
  const logger = hooks?.logger;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  // Build CLI args
  const args: string[] = [
    prompt,                    // Positional prompt (not -p)
    '--output-format', 'json', // Structured JSON event array on stdout
  ];

  // Auth type
  if (config.authType) {
    args.push('--auth-type', config.authType);
  }

  // Model override
  if (config.model) {
    args.push('--model', config.model);
  }

  logger?.info('[Qwen] Starting Qwen Code CLI...');
  logger?.debug(`[Qwen] Args: "<prompt>" ${args.slice(1).join(' ')}`);

  return new Promise<AgentRunResult<T>>((resolve, reject) => {
    const qwen = spawn('qwen', args, {
      env: {
        ...process.env,
        ...config.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.cwd ?? process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    qwen.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    qwen.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      logger?.debug(`[Qwen stderr] ${text.trim()}`);
    });

    qwen.on('error', (error: Error) => {
      logger?.error(`[Qwen] Failed to start: ${error.message}`);
      reject(new Error(`Failed to start Qwen: ${error.message}`));
    });

    // Timeout handling
    const timer = setTimeout(() => {
      qwen.kill('SIGTERM');
      reject(new Error(`Qwen timed out after ${timeout}ms`));
    }, timeout);

    qwen.on('close', async (code: number | null) => {
      clearTimeout(timer);

      // Fire raw output hook
      if (hooks?.onRawOutput) {
        try {
          await hooks.onRawOutput({ stdout, stderr, agent: 'qwen' });
        } catch {
          // ignore hook errors
        }
      }

      if (code !== 0) {
        // Classify the error from stdout, stderr, and exit code
        const classification = classifyQwenError(stdout, stderr, code);
        try {
          throwClassifiedError(classification, 'qwen');
        } catch (err) {
          reject(err);
        }
        return;
      }

      try {
        const parsed = extractQwenResult<T>(stdout, stderr);

        resolve({
          parsed,
          raw: stdout,
          stdout,
          stderr,
          agentUsed: 'qwen',
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}
