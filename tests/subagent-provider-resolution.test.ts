import { describe, expect, it } from "vitest";
import { ModelRuntime, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { resolveModel } from "@tintinweb/pi-subagents/dist/model-resolver.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface ProfileLike {
  baseUrl: string;
  apiKey: string;
  models: Array<{ id: string }>;
}

async function buildRuntime(
  config: Record<string, ProfileLike>,
): Promise<ModelRuntime> {
  const tmp = mkdtempSync(join(tmpdir(), "dw-auth-"));
  const authPath = join(tmp, "auth.json");
  writeFileSync(
    authPath,
    JSON.stringify({ "openai-codex": { type: "oauth", access: "fake" } }),
  );

  const runtime = await ModelRuntime.create({
    authPath,
    modelsPath: null,
    allowModelNetwork: false,
  });

  // 修复后：主 agent 不再向原生 deepseek 写入 custom profile 的 key
  // （agent-runner 现在把 custom 的 key 只写到 deskwand:<profileKey>）。
  // 模拟 provider-bridge 注册 deskwand:* profiles
  for (const [key, prof] of Object.entries(config)) {
    const providerId = "deskwand:" + key;
    runtime.registerProvider(providerId, {
      name: key,
      baseUrl: prof.baseUrl,
      apiKey: "deskwand-runtime-placeholder",
      models: prof.models.map((m) => ({
        id: m.id,
        name: m.id,
        api: "openai-completions",
        baseUrl: prof.baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      })),
    });
    await runtime.setRuntimeApiKey(providerId, prof.apiKey, {
      allowNetwork: false,
    });
  }

  return runtime;
}

describe("subagent model spec resolution", () => {
  it("exact deskwand spec resolves to profile provider with its auth", async () => {
    const runtime = await buildRuntime({
      deepseek: {
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-test-deepseek-key-1234567890abcdef",
        models: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }],
      },
      "custom:openai": {
        baseUrl: "http://127.0.0.1:11234/v1",
        apiKey: "api",
        models: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }],
      },
    });
    const registry = new ModelRegistry(runtime);

    // 修复后：完整 spec → exact match → deskwand:custom:openai
    const resolved = resolveModel(
      "deskwand:custom:openai/deepseek-v4-flash",
      registry,
    );
    expect(typeof resolved).not.toBe("string");
    if (typeof resolved === "string") return;
    expect(resolved.provider).toBe("deskwand:custom:openai");
    expect(resolved.id).toBe("deepseek-v4-flash");
    expect(resolved.baseUrl).toBe("http://127.0.0.1:11234/v1");
    const auth = await runtime.getAuth(resolved);
    expect(auth?.auth?.apiKey).toBe("api");

    // 修复后：deskwand:deepseek spec → 官方 provider + 官方 key
    const resolved2 = resolveModel(
      "deskwand:deepseek/deepseek-v4-flash",
      registry,
    );
    expect(typeof resolved2).not.toBe("string");
    if (typeof resolved2 === "string") return;
    expect(resolved2.provider).toBe("deskwand:deepseek");
    expect(resolved2.baseUrl).toBe("https://api.deepseek.com/v1");
    const auth2 = await runtime.getAuth(resolved2);
    expect(auth2?.auth?.apiKey).toBe("sk-test-deepseek-key-1234567890abcdef");
  });

  it("bare model name resolves to deskwand provider, not polluted native", async () => {
    const runtime = await buildRuntime({
      deepseek: {
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-test-deepseek-key-1234567890abcdef",
        models: [{ id: "deepseek-v4-flash" }],
      },
      "custom:openai": {
        baseUrl: "http://127.0.0.1:11234/v1",
        apiKey: "api",
        models: [{ id: "deepseek-v4-flash" }],
      },
    });
    const registry = new ModelRegistry(runtime);
    const resolved = resolveModel("deepseek-v4-flash", registry);
    // 原生 deepseek 不再被写入 custom key → 不在 available → fuzzy 命中
    // deskwand:deepseek（官方 baseUrl + 有效 key），不再 401
    expect(typeof resolved).not.toBe("string");
    if (typeof resolved === "string") return;
    expect(resolved.provider).toBe("deskwand:deepseek");
    const auth = await runtime.getAuth(resolved);
    expect(auth?.auth?.apiKey).toBe("sk-test-deepseek-key-1234567890abcdef");
  });
});
