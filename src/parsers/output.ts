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
// Codex Response Extraction from JSONL Events
// ---------------------------------------------------------------------------

/**
 * Content item within a Codex message event.
 */
interface CodexContentItem {
  type?: string;
  text?: string;
}

/**
 * Item within a Codex JSONL event.
 */
interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  content?: CodexContentItem[];
}

/**
 * Extract the final agent response text from parsed Codex JSONL events.
 *
 * Codex CLI with `--json` emits JSONL events to stdout. The agent's final
 * response is typically in `item.completed` events where `item.type` is
 * `"message"`. The text content is in `item.content[]` entries with
 * `type === "output_text"` (or similar text types).
 *
 * Falls back to collecting text from all `item.completed` events with
 * `item.type === "message"` if no `output_text` content is found.
 *
 * @param events - Parsed JSONL event objects from `parseJsonlEvents()`
 * @returns Extracted response text, or empty string if no message found
 */
export function extractCodexResponse(events: Record<string, unknown>[]): string {
  const textParts: string[] = [];

  for (const event of events) {
    // Look for item.completed events with message-type items
    if (event.type !== 'item.completed') continue;

    const item = event.item as CodexItem | undefined;
    if (!item) continue;

    if (item.type === 'message') {
      // Extract text from content array (preferred path)
      if (Array.isArray(item.content)) {
        for (const contentItem of item.content) {
          if (
            contentItem.text &&
            (contentItem.type === 'output_text' || contentItem.type === 'text')
          ) {
            textParts.push(contentItem.text);
          }
        }
      }
      // Fallback: item-level text field
      if (textParts.length === 0 && item.text) {
        textParts.push(item.text);
      }
    }
  }

  return textParts.join('\n');
}

// ---------------------------------------------------------------------------
// Qwen Response Extraction
// ---------------------------------------------------------------------------

interface QwenEvent {
  type?: string;
  result?: string;
  is_error?: boolean;
}

/**
 * Extract the raw agent response text from Qwen JSON event array stdout.
 *
 * The Qwen CLI with `--output-format json` produces a JSON array of event
 * objects on stdout. This function:
 * 1. Parses the JSON array
 * 2. Finds the event with `type === 'result'`
 * 3. Checks for `is_error` flag and classifies errors
 * 4. Returns the raw `.result` text (before JSON parsing)
 *
 * This is the Qwen equivalent of `extractCodexResponse()` — it extracts
 * the agent's final text from the structured event stream.
 *
 * @param stdout - Raw stdout from Qwen CLI
 * @param stderr - Optional stderr for error classification
 * @returns Raw response text from the agent
 * @throws Error if no result event found, is_error flag set, or empty result
 */
export function extractQwenResponse(stdout: string, stderr = ''): string {
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

  return agentText;
}

/**
 * Extract a typed result from Qwen JSON event array stdout.
 *
 * Convenience wrapper around `extractQwenResponse()` that additionally
 * strips markdown code-block wrappers and JSON.parses the content.
 *
 * @param stdout - Raw stdout from Qwen CLI
 * @param stderr - Optional stderr for error classification
 * @returns Parsed result object
 * @throws Error if no result event found or parsing fails
 */
export function extractQwenResult<T = unknown>(stdout: string, stderr = ''): T {
  const agentText = extractQwenResponse(stdout, stderr);

  // Strip markdown code blocks if present and parse JSON
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
