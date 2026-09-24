import { describe, expect, it, vi } from "vitest";
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
