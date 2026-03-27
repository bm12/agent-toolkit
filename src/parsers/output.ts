/**
 * Output parsers for CLI agent responses.
 *
 * Unified parser combining logic from:
 * - fake-hash-sync/src/auto-linker/codexAgent.js (parseCodexOutput, lines 146-165)
 * - tg-chat-qa/services/api/src/codex.ts (JSON extraction, lines 111-139)
 * - fake-hash-sync/src/auto-linker/qwenAgent.js (parseQwenOutput, getSchemaPromptSuffix)
 */

import { classifyQwenError, throwClassifiedError } from '../errors/classifiers.js';

// ---------------------------------------------------------------------------
// JSON Extraction
// ---------------------------------------------------------------------------

/**
 * Extract JSON from various CLI output formats.
 *
 * Tries in order:
 * 1. Direct JSON.parse
 * 2. JSON from markdown code blocks (```json ... ```)
 * 3. Raw JSON object found in text ({...})
 *
 * @param raw - Raw output string
 * @returns Parsed object or null if extraction fails
 */
export function extractJson<T = unknown>(raw: string): T | null {
  if (!raw || !raw.trim()) return null;

  // 1. Try direct JSON parse
  try {
    return JSON.parse(raw) as T;
  } catch {
    // continue to fallback strategies
  }

  // 2. Try to extract JSON from markdown code blocks
  const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch?.[1]) {
    try {
      return JSON.parse(jsonMatch[1].trim()) as T;
    } catch {
      // continue
    }
  }

  // 3. Try to find JSON object in the raw text
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]) as T;
    } catch {
      // continue
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// JSONL Parsing (Codex)
// ---------------------------------------------------------------------------

/**
 * Parse Codex JSONL stdout into an array of event objects.
 *
 * Each line of stdout is expected to be a JSON object. Non-JSON lines are
 * silently skipped.
 *
 * @param stdout - Raw stdout from Codex CLI (JSONL format)
 * @returns Array of parsed event objects
 */
export function parseJsonlEvents(stdout: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  const lines = stdout.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // non-JSON line, skip
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Qwen Result Extraction
// ---------------------------------------------------------------------------

interface QwenEvent {
  type?: string;
  result?: string;
  is_error?: boolean;
}

/**
 * Extract a typed result from Qwen JSON event array stdout.
 *
 * The Qwen CLI with `--output-format json` produces a JSON array of event
 * objects on stdout. This function:
 * 1. Parses the JSON array
 * 2. Finds the event with `type === 'result'`
 * 3. Checks for `is_error` flag and classifies errors
 * 4. Extracts the `.result` text field
 * 5. Strips markdown code-block wrappers if present
 * 6. JSON.parses the inner content
 *
 * @param stdout - Raw stdout from Qwen CLI
 * @param stderr - Optional stderr for error classification
 * @returns Parsed result object
 * @throws Error if no result event found or parsing fails
 */
export function extractQwenResult<T = unknown>(stdout: string, stderr = ''): T {
  // 1. Parse the JSON array of events
  const events: QwenEvent[] = JSON.parse(stdout);

  // 2. Find the result event
  const resultEvent = events.find((e) => e.type === 'result');

  if (!resultEvent) {
    throw new Error('No result event found in Qwen output');
  }

  if (resultEvent.is_error) {
    const classification = classifyQwenError(stdout, stderr || resultEvent.result || '', 1);
    throwClassifiedError(classification, 'qwen');
  }

  // 3. Extract the agent's final text
  const agentText = resultEvent.result;

  if (!agentText) {
    throw new Error('Qwen result event has empty result field');
  }

  // 4. Strip markdown code blocks if present and parse JSON
  const jsonMatch = agentText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : agentText.trim();

  return JSON.parse(jsonStr) as T;
}

// ---------------------------------------------------------------------------
// Schema Prompt Suffix
// ---------------------------------------------------------------------------

/**
 * Build a prompt suffix that instructs the agent to output raw JSON conforming
 * to the given schema.
 *
 * Used for agents like Qwen that don't have a native `--output-schema` flag.
 *
 * @param schemaContent - JSON Schema content as a string
 * @returns Prompt suffix string to append to the base prompt
 */
export function buildSchemaPromptSuffix(schemaContent: string): string {
  return `

## Required Output Format

You MUST respond with ONLY a valid JSON object (no markdown, no code blocks, no explanation text).
The JSON MUST conform to this exact schema:

${schemaContent}

Do NOT wrap the JSON in markdown code blocks. Output ONLY the raw JSON.`;
}
