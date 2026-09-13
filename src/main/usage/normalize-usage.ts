/**
 * Normalizes the many provider usage payload shapes into TokenUsage.
 *
 * Moved out of agent-runner.ts: the vision tool (vision-describe.ts) needs it
 * too, and importing agent-runner from there would be a cycle.
 *
 * Behavior is preserved verbatim from the original, including the Anthropic
 * `totalPromptInput` branch; see design-docs/2026-09-13-local-usage-stats-design.md
 * §12 for the separate open question about that branch.
 */

import type { Message } from "../../renderer/types";

export function normalizeTokenUsage(
  usage: unknown,
  provider?: string,
): Message["tokenUsage"] | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const raw = usage as {
    input?: unknown;
    output?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    cachedContentTokenCount?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    cache_read_input_tokens?: unknown;
    cacheReadInputTokens?: unknown;
    cacheWriteInputTokens?: unknown;
    cache_creation_input_tokens?: unknown;
    prompt_tokens_details?: {
      cached_tokens?: unknown;
    };
    input_token_details?: {
      cached_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      cache_write_tokens?: unknown;
    };
    usage?: {
      inputTokenDetails?: {
        cachedTokens?: unknown;
      };
    };
  };

  const inputFromPromptTotal = raw.prompt_tokens ?? raw.promptTokenCount;
  const input =
    raw.input ?? raw.input_tokens ?? raw.inputTokens ?? inputFromPromptTotal;
  const output =
    raw.output ??
    raw.output_tokens ??
    raw.outputTokens ??
    raw.completion_tokens ??
    raw.candidatesTokenCount;

  if (typeof input !== "number" || typeof output !== "number") {
    return undefined;
  }

  const cacheReadCandidates = [
    raw.cacheRead,
    raw.cache_read_input_tokens,
    raw.cacheReadInputTokens,
    raw.cachedContentTokenCount,
    raw.prompt_tokens_details?.cached_tokens,
    raw.input_token_details?.cached_tokens,
    raw.input_token_details?.cache_read_input_tokens,
    raw.usage?.inputTokenDetails?.cachedTokens,
  ];
  const cacheReadRaw = cacheReadCandidates.find(
    (value) => typeof value === "number",
  );
  const cacheRead =
    typeof cacheReadRaw === "number" && cacheReadRaw >= 0
      ? Math.floor(cacheReadRaw)
      : undefined;

  const cacheWriteCandidates = [
    raw.cacheWrite,
    raw.cacheWriteInputTokens,
    raw.cache_creation_input_tokens,
    raw.input_token_details?.cache_write_tokens,
  ];
  const cacheWriteRaw = cacheWriteCandidates.find(
    (value) => typeof value === "number",
  );
  const cacheWrite =
    typeof cacheWriteRaw === "number" && cacheWriteRaw >= 0
      ? Math.floor(cacheWriteRaw)
      : undefined;

  // Raw OpenAI / Gemini payloads report a prompt *total* that already includes
  // the cached tokens; pi's normalized shape does not (its adapters subtract
  // them, see pi-ai's openai-completions + google-generative-ai adapters).
  // Normalize to pi's shape so cache read is not counted twice in the input
  // column or in the hit-rate denominator.
  const rawPromptTotal = inputFromPromptTotal !== undefined;
  const normalizedInput = rawPromptTotal
    ? Math.max(0, Math.floor(input) - (cacheRead ?? 0) - (cacheWrite ?? 0))
    : Math.floor(input);

  // Provider semantics: Anthropic's input includes cacheRead; OpenAI's input excludes both cacheRead and cacheWrite.
  // We need totalPromptInput = the full prompt tokens sent (what counts against the context window).
  const isAnthropic =
    provider === "anthropic" || provider === "cloudflare-ai-gateway";
  const totalPromptInput = rawPromptTotal
    ? Math.floor(input) // a provider-reported prompt total is already the full prompt
    : isAnthropic
      ? Math.floor(input) // input already includes cacheRead
      : Math.floor(input) + (cacheRead ?? 0) + (cacheWrite ?? 0); // input = prompt_tokens - cacheRead - cacheWrite

  return {
    input: normalizedInput,
    output: Math.floor(output),
    totalPromptInput,
    ...(typeof cacheRead === "number" ? { cacheRead } : {}),
    ...(typeof cacheWrite === "number" ? { cacheWrite } : {}),
  };
}
