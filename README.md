# agent-toolkit

Shared AI agent infrastructure for Codex CLI and Qwen CLI executors with error handling, retry logic, and fallback orchestration.

## Installation

```bash
npm install github:bm12/agent-toolkit#v1.0.0
```

## Features

- **Codex CLI executor** — spawn, JSONL parsing, error classification
- **Qwen CLI executor** — spawn, JSON event parsing, error classification
- **Typed error classes** — `AgentQuotaError`, `AgentRateLimitError`, `AgentUpstreamError`, etc.
- **Retry with exponential backoff** — configurable retries with jitter
- **Batch runner with fallback** — automatic agent switching on quota exhaustion
- **JSON extraction** — from markdown code blocks, raw text, JSONL streams

## Quick Start

```typescript
import { createAgentExecutor } from 'agent-toolkit';

const executor = createAgentExecutor({
  agents: {
    codex: { search: true },
    qwen: { authType: 'qwen-oauth' },
  },
  primaryAgent: 'codex',
  retry: { maxRetries: 3, baseMs: 2000, maxMs: 30000 },
});

// Single execution with retry
const result = await executor.run({
  prompt: 'Your prompt here',
  outputSchema: './schema.json',
});

console.log(result.parsed);   // Parsed JSON response
console.log(result.agentUsed); // 'codex' or 'qwen'
```

## Batch Runner (Fallback Orchestration)

```typescript
import { createBatchRunner, AllAgentsQuotaError } from 'agent-toolkit';

const batch = createBatchRunner({
  agents: {
    codex: { search: true },
    qwen: { authType: 'qwen-oauth' },
  },
  primaryAgent: 'codex',
  retry: { maxRetries: 3, baseMs: 2000, maxMs: 30000 },
  onFallback: (from, to) => console.log(`Switching from ${from} to ${to}`),
  onAllExhausted: (agents) => console.log(`All agents exhausted: ${agents}`),
});

for (const task of tasks) {
  try {
    const result = await batch.run({ prompt: task.prompt });
  } catch (err) {
    if (err instanceof AllAgentsQuotaError) {
      console.log('All agents quota exceeded, stopping batch');
      break;
    }
  }
}

batch.reset(); // Reset for next batch
```

## Error Classes

| Class | Kind | Retryable |
|-------|------|-----------|
| `AgentError` | varies | varies |
| `AgentQuotaError` | `quota_exceeded` | ❌ |
| `AllAgentsQuotaError` | `all_agents_quota_exceeded` | ❌ |
| `AgentRateLimitError` | `rate_limited` | ✅ |
| `AgentUpstreamError` | `upstream_overloaded` | ✅ |
| `AgentAuthError` | `auth_error` | ❌ |
| `AgentRetryExhaustedError` | `retry_exhausted` | ❌ |

## License

MIT
