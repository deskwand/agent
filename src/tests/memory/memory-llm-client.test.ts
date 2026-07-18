import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runPiAiOneShotMock = vi.hoisted(() => vi.fn());
let scheduledTimeout: (() => void) | undefined;
const mockedTimeoutHandle = { unref: () => undefined } as unknown as ReturnType<
  typeof setTimeout
>;

vi.mock("../../main/agent/agent-sdk-one-shot", () => ({
  runPiAiOneShot: runPiAiOneShotMock,
}));

import type { AppConfig } from "../../main/config/config-store";
import { normalizeWebAccessConfig } from "../../shared/web-access";
import { MemoryLLMClient } from "../../main/memory/memory-llm-client";

function makeConfig(timeoutMs: number): AppConfig {
  return {
    provider: "custom",
    customProtocol: "openai",
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    activeProfileKey: "custom:openai",
    activeProviderKey: "custom:openai",
    profiles: {},
    providers: {
      "custom:openai": {
        provider: "custom",
        customProtocol: "openai",
        apiKey: "test-key",
        baseUrl: "https://example.test/v1",
        defaultModel: "test-model",
        models: [{ id: "test-model", label: "test-model", source: "custom" }],
        updatedAt: "2026-05-24T00:00:00.000Z",
      },
    },
    deskWandCodePath: "",
    defaultWorkdir: "",
    enableDevLogs: false,
    theme: "light",
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: {
        inheritFromActive: true,
        apiKey: "",
        baseUrl: "",
        model: "",
        timeoutMs,
      },
      embedding: {
        inheritFromActive: true,
        apiKey: "",
        baseUrl: "",
        model: "text-embedding-3-small",
        timeoutMs: 180000,
      },
      useEmbedding: false,
      maxNavSteps: 2,
      ingestionConcurrency: 4,
      storageRoot: "",
      evalEnabled: false,
      evalWorkspaces: [],
      evalMaxRounds: 12,
      evalArtifactsRoot: "",
      promptIterationRounds: 2,
    },
    enableThinking: false,
    themePreset: "graphite",
    thinkingLevel: "medium",
    autoSkillLearning: false,
    telemetryEnabled: true,
    isConfigured: true,
    webAccess: normalizeWebAccessConfig(undefined),
  };
}

describe("MemoryLLMClient", () => {
  beforeEach(() => {
    scheduledTimeout = undefined;
    runPiAiOneShotMock.mockReset();
    vi.spyOn(global, "setTimeout").mockImplementation(((
      callback: TimerHandler,
    ) => {
      scheduledTimeout =
        typeof callback === "function" ? (callback as () => void) : undefined;
      return mockedTimeoutHandle;
    }) as unknown as typeof setTimeout);
    vi.spyOn(global, "clearTimeout").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts one-shot completions with the configured memory LLM timeout", async () => {
    let signal: AbortSignal | undefined;
    runPiAiOneShotMock.mockImplementation(
      (_prompt, _systemPrompt, _config, options) => {
        signal = options?.signal;
        return new Promise(() => undefined);
      },
    );

    const client = new MemoryLLMClient(() => makeConfig(5000));
    const completion = client
      .complete({
        systemPrompt: "memory system",
        userPrompt: "memory user",
      })
      .then(
        () => null,
        (error: unknown) => error as Error,
      );

    expect(signal?.aborted).toBe(false);
    expect(scheduledTimeout).toBeTypeOf("function");

    scheduledTimeout?.();
    expect(signal?.aborted).toBe(true);
    const error = await completion;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Memory LLM request timed out after 5000ms",
    );
  });
});
