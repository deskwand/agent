import { describe, expect, it, vi } from "vitest";
import { stream } from "@earendil-works/pi-ai/api/openai-completions";
import { normalizeContext } from "@earendil-works/pi-ai";
import { DESKWAND_PROVIDER_PREFIX } from "../src/shared/deskwand-provider";

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/dw-test-userdata",
    getVersion: () => "test",
  },
}));

// ollama-api 与 shared-model-runtime 的网络/凭据路径在 custom 场景不会触发，
// 直接测 resolve 的 piModel 身份对齐逻辑。
import type { AppConfig } from "../src/main/config/config-store";
import { modelResolutionService } from "../src/main/model/model-resolution-service";

const appConfig = {
  activeProviderKey: "custom:openai",
  model: undefined,
  providers: {
    deepseek: {
      provider: "deepseek",
      customProtocol: "anthropic" as const,
      apiKey: "sk-test-deepseek-key-1234567890abcdef",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-v4-flash",
      models: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }],
    },
    "custom:openai": {
      provider: "custom",
      customProtocol: "openai" as const,
      apiKey: "api",
      baseUrl: "http://127.0.0.1:11234/v1",
      defaultModel: "deepseek-v4-flash",
      models: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }],
    },
  },
} as unknown as AppConfig;

describe("modelResolutionService custom profile identity", () => {
  it("pins custom profile piModel provider to deskwand:<profileKey>", async () => {
    const resolved = await modelResolutionService.resolve({
      sessionProviderProfileKey: "custom:openai",
      sessionModel: "deepseek-v4-flash",
      appConfig,
    });

    expect(resolved.piModel.provider).toBe(
      `${DESKWAND_PROVIDER_PREFIX}custom:openai`,
    );
    expect(resolved.piModel.id).toBe("deepseek-v4-flash");
    // baseUrl 保持 profile 的本地代理端点
    expect(resolved.piModel.baseUrl).toBe("http://127.0.0.1:11234/v1");
  });

  it("does not fall back to a billed provider after disconnecting a subscription", async () => {
    await expect(
      modelResolutionService.resolve({
        sessionProviderProfileKey: "custom:subscription-bailian-coding",
        appConfig,
      }),
    ).rejects.toThrow(/百炼 Coding Plan.*disconnected|百炼 Coding Plan.*断开/i);
  });

  it('preserves existing fallback for unrelated missing custom profiles', async () => {
    const resolved = await modelResolutionService.resolve({
      sessionProviderProfileKey: 'custom:old', appConfig,
    });
    expect(resolved.providerProfileKey).toBe('custom:openai');
    expect(resolved.trace.notes).toContain('session_provider_missing_fell_back_to_active');
  });

  it("routes subscription models through their own endpoint and credentials", async () => {
    const profileKey = "custom:subscription-bailian-coding";
    const configured = {
      ...appConfig,
      providers: {
        ...appConfig.providers,
        [profileKey]: {
          provider: "custom",
          customProtocol: "openai",
          apiKey: "sk-sp-test-only",
          baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
          defaultModel: "kimi-k2.5",
          models: [{ id: "kimi-k2.5", label: "kimi-k2.5", source: "preset" }],
        },
      },
    } as AppConfig;
    const resolved = await modelResolutionService.resolve({
      sessionProviderProfileKey: profileKey,
      sessionModel: "kimi-k2.5",
      appConfig: configured,
    });
    expect(resolved.piModel.provider).toBe(`deskwand:${profileKey}`);
    expect(resolved.piModel.baseUrl).toBe(
      "https://coding.dashscope.aliyuncs.com/v1",
    );
    expect(resolved.piModel.api).toBe("openai-completions");
    expect(resolved.apiKey).toBe("sk-sp-test-only");
    expect(resolved.piModel.id).toBe("kimi-k2.5");
  });

  it.each([
    [
      "custom:subscription-bailian-coding",
      "https://coding.dashscope.aliyuncs.com/v1",
      "qwen3.7-plus",
    ],
    [
      "custom:subscription-ark-coding",
      "https://ark.cn-beijing.volces.com/api/coding/v3",
      "ark-code-latest",
    ],
  ])(
    "sends %s requests and Key only to its subscription endpoint",
    async (profileKey, baseUrl, modelId) => {
      const configured = {
        ...appConfig,
        providers: {
          ...appConfig.providers,
          [profileKey]: {
            provider: "custom",
            customProtocol: "openai",
            apiKey: "subscription-secret",
            baseUrl,
            defaultModel: modelId,
            models: [{ id: modelId, label: modelId, source: "preset" }],
          },
        },
      } as AppConfig;
      const resolved = await modelResolutionService.resolve({
        sessionProviderProfileKey: profileKey,
        appConfig: configured,
      });
      const calls: Array<{ url: string; authorization: string }> = [];
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        calls.push({
          url: String(url),
          authorization: new Headers(init.headers).get("authorization") || "",
        });
        return new Response(
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      });
      try {
        const events = stream(
          resolved.piModel as never,
          normalizeContext({
            messages: [
              { role: "user", content: [{ type: "text", text: "hi" }] },
            ],
          } as never),
          { apiKey: resolved.apiKey } as never,
        );
        for await (const _event of events) {
          /* drain */
        }
      } finally {
        vi.unstubAllGlobals();
      }
      expect(calls).toEqual([
        {
          url: `${baseUrl}/chat/completions`,
          authorization: "Bearer subscription-secret",
        },
      ]);
    },
  );

  it("rejects a forged subscription endpoint before sending a request", async () => {
    const profileKey = "custom:subscription-ark-coding";
    const configured = {
      ...appConfig,
      providers: {
        ...appConfig.providers,
        [profileKey]: {
          provider: "custom",
          customProtocol: "openai",
          apiKey: "ark-key",
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          defaultModel: "ark-code-latest",
          models: [
            {
              id: "ark-code-latest",
              label: "ark-code-latest",
              source: "preset",
            },
          ],
        },
      },
    } as AppConfig;
    await expect(
      modelResolutionService.resolve({
        sessionProviderProfileKey: profileKey,
        appConfig: configured,
      }),
    ).rejects.toThrow(/火山方舟 Coding Plan.*endpoint|火山方舟 Coding Plan.*端点/i);
  });

  it("keeps non-custom provider identity unchanged", async () => {
    const resolved = await modelResolutionService.resolve({
      sessionProviderProfileKey: "deepseek",
      sessionModel: "deepseek-v4-flash",
      appConfig,
    });

    expect(resolved.piModel.provider).toBe("deepseek");
  });

  it("resolves the retired deepseek flash ids to the surviving native entry", async () => {
    // pi-ai 0.87.1 的 deepseek 目录用 deepseek-flash 取代了 deepseek-v4-flash 与
    // deepseek-v4-flash-vision-exp。不做重定向时这两个 id 会落到跨 provider 回退、
    // 命中 opencode 的条目 —— provider 与 baseUrl 双双变成 opencode，
    // DeepSeek 的 key 与请求会被发到用户从未配置过的 opencode.ai。
    for (const sessionModel of [
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
    ]) {
      const resolved = await modelResolutionService.resolve({
        sessionProviderProfileKey: "deepseek",
        sessionModel,
        appConfig,
      });

      expect(resolved.piModel.provider).toBe("deepseek");
      expect(resolved.piModel.id).toBe("deepseek-flash");
      expect(resolved.piModel.baseUrl).toContain("api.deepseek.com");
    }
  });
});
