import { describe, expect, it, vi } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 复刻 agent-runner 的 key 写入决策（主请求 + 冷启动 compaction 两处相同逻辑）：
// custom profile → 只写 deskwand:<profileKey>，绝不写原生 provider。
// 这是根因修复的行为契约：原生 provider 不再被自定义 profile 的 key 污染。

async function buildRuntime(): Promise<ModelRuntime> {
  const tmp = mkdtempSync(join(tmpdir(), "dw-auth-"));
  const authPath = join(tmp, "auth.json");
  writeFileSync(
    authPath,
    JSON.stringify({ "openai-codex": { type: "oauth", access: "fake" } }),
  );
  return ModelRuntime.create({
    authPath,
    modelsPath: null,
    allowModelNetwork: false,
  });
}

describe("agent-runner key write targeting for custom profiles", () => {
  it("writes custom profile key only to deskwand namespace, never native provider", async () => {
    const runtime = await buildRuntime();
    // provider-bridge 预注册 deskwand:custom:openai（主流程 3528 行）
    runtime.registerProvider("deskwand:custom:openai", {
      name: "custom:openai",
      baseUrl: "http://127.0.0.1:11234/v1",
      apiKey: "deskwand-runtime-placeholder",
      models: [
        {
          id: "deepseek-v4-flash",
          name: "deepseek-v4-flash",
          api: "openai-completions",
          baseUrl: "http://127.0.0.1:11234/v1",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ],
    });

    const setRuntimeApiKey = vi.spyOn(runtime, "setRuntimeApiKey");
    const apiKey = "api";
    const provider = "custom";
    const piModel = runtime.getModel(
      "deskwand:custom:openai",
      "deepseek-v4-flash",
    );
    if (!piModel)
      throw new Error(
        "deskwand:custom:openai/deepseek-v4-flash not registered",
      );

    // 复刻 agent-runner.ts 的决策（修复后）：
    const piProvider = provider === "custom" ? piModel.provider : provider;
    await runtime.setRuntimeApiKey(piProvider, apiKey, { allowNetwork: false });
    if (piModel.provider !== piProvider) {
      await runtime.setRuntimeApiKey(piModel.provider, apiKey, {
        allowNetwork: false,
      });
    }

    // 只写 deskwand:custom:openai，绝不写原生 deepseek
    const written = setRuntimeApiKey.mock.calls.map((c) => c[0]);
    expect(written).toEqual(["deskwand:custom:openai"]);
    expect(written).not.toContain("deepseek");

    // 认证可从 deskwand 命名空间解析到 key
    const auth = await runtime.getAuth(piModel);
    expect(auth?.auth?.apiKey).toBe("api");
  });

  it("non-custom providers still write to their own provider id", async () => {
    const runtime = await buildRuntime();
    const setRuntimeApiKey = vi.spyOn(runtime, "setRuntimeApiKey");
    const apiKey = "sk-test-deepseek-key-1234567890abcdef";
    const provider = "deepseek";
    // 原生 deepseek 无需注册（builtin）
    const piModel = runtime.getModel("deepseek", "deepseek-v4-flash");
    if (!piModel) throw new Error("native deepseek model missing");

    const piProvider = provider === "custom" ? piModel.provider : provider;
    await runtime.setRuntimeApiKey(piProvider, apiKey, { allowNetwork: false });
    if (piModel.provider !== piProvider) {
      await runtime.setRuntimeApiKey(piModel.provider, apiKey, {
        allowNetwork: false,
      });
    }

    const written = setRuntimeApiKey.mock.calls.map((c) => c[0]);
    expect(written).toEqual(["deepseek"]);
  });
});
