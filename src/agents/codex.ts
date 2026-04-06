/**
 * Codex CLI agent — spawn, JSONL parsing, error classification.
 *
 * Ported from fake-hash-sync/src/auto-linker/codexAgent.js
 * and tg-chat-qa/services/api/src/codex.ts.
 */

import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentConfig, AgentRunOptions, AgentRunResult, ExecutorHooks } from './types.js';
import { DEFAULT_TIMEOUT } from './types.js';
import { classifyCodexError, throwClassifiedError } from '../errors/classifiers.js';
import { parseJsonlEvents, extractJson, extractCodexResponse } from '../parsers/output.js';

/**
 * Execute the Codex CLI agent with the given prompt and configuration.
 *
 * Builds CLI args: --json, --search, --skip-git-repo-check, --output-schema, -o, --model
 * Collects stdout (JSONL) and stderr, parses events, classifies errors.
 *
 * @param prompt  - The full prompt text
 * @param config  - Codex-specific configuration
 * @param options - Run options (outputSchema, outputFile)
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
  const args: string[] = [];

  // Model override (at the very beginning)
  if (config.model) {
    args.push('--model', config.model);
  }

  // Search flag (must be before exec)
  if (config.search) {
    args.push('--search');
  }

  args.push(
    'exec',
    '--json',                // Output JSONL events to stdout
    '--skip-git-repo-check', // Don't require git repo
  );

  // Output schema
  if (options.outputSchema) {
    args.push('--output-schema', options.outputSchema);
  }

  // Output file: if outputSchema is specified but no outputFile, auto-generate
  // a temp file. Codex writes structured output to the -o file, not to stdout
  // (stdout only has JSONL events when --json is used).
  const effectiveOutputFile = options.outputFile
    ?? (options.outputSchema
      ? join(tmpdir(), `codex-output-${randomUUID()}.json`)
      : undefined);
  const isTempOutputFile = !options.outputFile && !!effectiveOutputFile;

  if (effectiveOutputFile) {
    args.push('-o', effectiveOutputFile);
  }

  // Prompt as the last argument
  args.push(prompt);

  logger?.info('[Codex] Starting Codex CLI...');
  logger?.debug(`[Codex] Args: ${args.slice(0, -1).join(' ')} "<prompt>"`);

  return new Promise<AgentRunResult<T>>((resolve, reject) => {
    const codex = spawn('codex', args, {
      env: {
        ...process.env,
        ...config.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.cwd ?? process.cwd(),
    });

    let stdoutRaw = '';
    let stderr = '';

    codex.stdout.on('data', (chunk: Buffer) => {
      stdoutRaw += chunk.toString();
    });

    codex.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      logger?.debug(`[Codex stderr] ${text.trim()}`);
    });

    codex.on('error', (error: Error) => {
      logger?.error(`[Codex] Failed to start: ${error.message}`);
      reject(new Error(`Failed to start Codex: ${error.message}`));
    });

    // Timeout handling
    const timer = setTimeout(() => {
      codex.kill('SIGTERM');
      reject(new Error(`Codex timed out after ${timeout}ms`));
    }, timeout);

    codex.on('close', async (code) => {
      clearTimeout(timer);

      // Fire raw output hook
      if (hooks?.onRawOutput) {
        try {
          await hooks.onRawOutput({ stdout: stdoutRaw, stderr, agent: 'codex' });
        } catch {
          // ignore hook errors
        }
      }

      // Parse JSONL events from stdout
      const events = parseJsonlEvents(stdoutRaw);

      if (code !== 0) {
        // Classify the error from JSONL events, stderr, and exit code
        const classification = classifyCodexError(events, stderr, code);
        try {
          throwClassifiedError(classification, 'codex');
        } catch (err) {
          reject(err);
        }
        return;
      }

      // Exit code 0 — but check events for errors (Codex can exit 0 with errors in stream)
      const hasErrors = events.some(
        (e) => e.type === 'turn.failed' || e.type === 'error',
      );
      if (hasErrors) {
        const classification = classifyCodexError(events, stderr, code);
        try {
          throwClassifiedError(classification, 'codex');
        } catch (err) {
          reject(err);
        }
        return;
      }

      try {
        let raw = '';
        let parsed: T | null = null;

        // Strategy 1: Read from output file (-o flag, auto-generated or explicit)
        if (effectiveOutputFile) {
          try {
            raw = await readFile(effectiveOutputFile, 'utf-8');
            logger?.debug(`[Codex] Read output file: ${raw.substring(0, 200)}...`);
          } catch {
            logger?.debug(`[Codex] Output file not found, falling back to event extraction`);
          } finally {
            // Clean up auto-generated temp file
            if (isTempOutputFile) {
              unlink(effectiveOutputFile).catch(() => {});
            }
          }
        }

        // Strategy 2: Extract agent response text from JSONL events
        if (!raw) {
          const responseText = extractCodexResponse(events);
          if (responseText) {
            raw = responseText;
            logger?.debug(`[Codex] Extracted response from JSONL events: ${raw.substring(0, 200)}...`);
          }
        }

        // Strategy 3: Last resort — use raw stdout (JSONL stream)
        if (!raw && stdoutRaw) {
          raw = stdoutRaw;
          logger?.warn(`[Codex] No structured response found, using raw stdout as fallback`);
        }

        // Parse JSON from raw output
        if (raw) {
          parsed = extractJson<T>(raw);
        }

        resolve({
          parsed,
          raw,
          stdout: stdoutRaw,
          stderr,
          agentUsed: 'codex',
        });
      } catch (error) {
        // Clean up temp file on error path too
        if (isTempOutputFile && effectiveOutputFile) {
          unlink(effectiveOutputFile).catch(() => {});
        }
        reject(
          new Error(
            `Failed to parse Codex output: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  });
}
