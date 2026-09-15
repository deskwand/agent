import { describe, it, expect, vi } from "vitest";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
  resolvePiRegistryModel,
} from "../src/main/agent/pi-model-resolution";

const CLOUD = "https://api.deskwand.com/api/models";
const CLOUD_OPTIONS = {
  configProvider: "openai",
  customBaseUrl: CLOUD,
  rawProvider: "custom",
  customProtocol: "openai",
} as never;

/** 走真实路径解析云端模型：能拿注册表就拿，拿不到就走合成回退（与 model-resolution-service 一致） */
function resolveCloudModel(id: string) {
  const registry = resolvePiRegistryModel(`custom/${id}`, CLOUD_OPTIONS);
  if (registry) return registry;
  return applyPiModelRuntimeOverrides(
    buildSyntheticPiModel(id, "custom", "openai", CLOUD, undefined, undefined, undefined, undefined),
    CLOUD_OPTIONS,
  );
}

/** 用真实 pi-ai 构造请求体（stub fetch），断言实际发出的字段 */
async function captureBody(model: unknown, options: Record<string, unknown>, context?: Record<string, unknown>) {
  let body: Record<string, unknown> = {};
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  try {
    const events = stream(
      model as never,
      (context ?? { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], systemPrompt: "sys" }) as never,
      { apiKey: "k", ...options } as never,
    );
    for await (const _event of events as never) { /* drain */ }
  } catch {
    /* 上游形状不影响我们对请求体的断言 */
  }
  vi.unstubAllGlobals();
  return body;
}

describe("cloud deepseek models speak the DeepSeek dialect", () => {
  it("mirrors the registry compat flags for the official flash id", () => {
    const model = resolveCloudModel("deepseek-flash");
    expect(model.compat).toMatchObject({
      maxTokensField: "max_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    });
  });

  it("keeps the registry compat for the pro id", () => {
    const model = resolveCloudModel("deepseek-v4-pro");
    expect(model.provider).toBe("deepseek");
    expect(model.compat).toMatchObject({
      maxTokensField: "max_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    });
  });

  it("only fills missing flags instead of clobbering existing ones", () => {
    // 若模型已自带取值（未来 pi 注册表提供官方名条目），必须以既有值为准
    const preset = applyPiModelRuntimeOverrides(
      {
        ...buildSyntheticPiModel("deepseek-flash", "custom", "openai", CLOUD, undefined, undefined, undefined, undefined),
        compat: { thinkingFormat: "future-format", maxTokensField: "future_field", requiresReasoningContentOnAssistantMessages: false },
      } as never,
      CLOUD_OPTIONS,
    );
    expect(preset.compat?.thinkingFormat).toBe("future-format");
    expect(preset.compat?.maxTokensField).toBe("future_field");
    expect(preset.compat?.requiresReasoningContentOnAssistantMessages).toBe(false);
  });

  it("does not touch other custom providers", () => {
    const model = applyPiModelRuntimeOverrides(
      buildSyntheticPiModel("deepseek-flash", "custom", "openai", "https://example.com/v1", undefined, undefined, undefined, undefined),
      { configProvider: "openai", customBaseUrl: "https://example.com/v1", rawProvider: "custom", customProtocol: "openai" } as never,
    );
    expect(model.compat?.thinkingFormat).toBeUndefined();
  });

  it("does not treat a same-prefix host as our endpoint", () => {
    const model = applyPiModelRuntimeOverrides(
      buildSyntheticPiModel("deepseek-flash", "custom", "openai", "https://api.deskwand.com.evil.com/api/models", undefined, undefined, undefined, undefined),
      { configProvider: "openai", customBaseUrl: "https://api.deskwand.com.evil.com/api/models", rawProvider: "custom", customProtocol: "openai" } as never,
    );
    expect(model.compat?.thinkingFormat).toBeUndefined();
  });

  it("does not touch non-deepseek models on our own endpoint", () => {
    // 云端将来引入非 DeepSeek 模型时不得被误套方言。
    // 用 not.toBe("deepseek")：若该 id 恰好命中注册表（自带其它 thinkingFormat），断言仍成立。
    const model = resolveCloudModel("qwen3-max");
    expect(model.compat?.thinkingFormat).not.toBe("deepseek");
  });

  it("sends system role, max_tokens, no store, and thinking disabled when no effort is given", async () => {
    const body = await captureBody(resolveCloudModel("deepseek-flash"), { maxTokens: 16384 });
    const system = (body.messages as Array<{ role: string }>)[0];
    expect(system.role).toBe("system");
    expect(body.store).toBeUndefined();
    expect(body.max_tokens).toBe(16384);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("keeps reasoning_content on assistant tool-call history", async () => {
    // DeepSeek 官方：带 tools 的请求，后续每一轮都必须回传 reasoning_content，否则 400
    const body = await captureBody(
      resolveCloudModel("deepseek-flash"),
      { maxTokens: 16384 },
      {
        messages: [
          { role: "user", content: [{ type: "text", text: "查一下" }] },
          {
            role: "assistant",
            content: [{ type: "toolCall", id: "call_1", name: "noop", arguments: {} }],
            api: "openai-completions",
            provider: "custom",
            model: "deepseek-flash",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
            stopReason: "toolUse",
          },
          { role: "toolResult", toolCallId: "call_1", toolName: "noop", content: [{ type: "text", text: "ok" }] },
        ],
        tools: [{ name: "noop", description: "noop", parameters: { type: "object", properties: {} } }],
      },
    );
    const assistant = (body.messages as Array<Record<string, unknown>>).find((m) => m.role === "assistant");
    expect(assistant?.reasoning_content).toBe("");
  });

  it("sends thinking enabled plus the requested effort when effort is given", async () => {
    const body = await captureBody(resolveCloudModel("deepseek-flash"), { reasoningEffort: "high", maxTokens: 16384 });
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.max_tokens).toBe(16384);
  });
});
