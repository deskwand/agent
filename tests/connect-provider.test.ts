import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectCodingSubscription,
  connectOAuthProvider,
} from "../src/renderer/services/connect-provider";

const t = (key: string) => key;

const configWith = (providers: Record<string, { defaultModel?: string }>) => ({
  providers,
  activeProviderKey: "openrouter",
});

const anthropicDefault = "claude-opus-4-5";

const defaultSaveResult = () => ({
  success: true,
  config: configWith({ "oauth:anthropic": { defaultModel: anthropicDefault } }),
});

type Mock = ReturnType<typeof vi.fn>;

function stubElectron(
  overrides: {
    config?: {
      saveProvider?: Mock;
      setActiveProvider?: Mock;
      fetchOpenRouterModels?: Mock;
    };
    auth?: { login?: Mock; status?: Mock };
    openrouterAuth?: { login?: Mock };
  } = {},
) {
  const config = {
    saveProvider: vi.fn(async () => defaultSaveResult()),
    setActiveProvider: vi.fn(async () => defaultSaveResult()),
    fetchOpenRouterModels: vi.fn(async () => ({
      models: [{ id: "or-model", label: "or-model" }],
      usedFallback: false,
    })),
    ...overrides.config,
  };
  const auth = {
    login: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ loggedIn: false })),
    ...overrides.auth,
  };
  const openrouterAuth = {
    login: vi.fn(async () => ({ apiKey: "or-key" })),
    ...overrides.openrouterAuth,
  };
  vi.stubGlobal("window", {
    electronAPI: { config, auth, openrouterAuth },
  });
  return { config, auth, openrouterAuth };
}

afterEach(() => vi.unstubAllGlobals());

describe("connectOAuthProvider", () => {
  it("saves the oauth provider then makes it active", async () => {
    const { config, auth } = stubElectron();

    const result = await connectOAuthProvider("anthropic", "Anthropic", t);

    expect(auth.login).toHaveBeenCalledWith("anthropic", false);
    expect(config.saveProvider).toHaveBeenCalledWith({
      profileKey: "oauth:anthropic",
      config: expect.objectContaining({ provider: "oauth", name: "Anthropic" }),
    });
    expect(config.setActiveProvider).toHaveBeenCalledWith({
      profileKey: "oauth:anthropic",
      defaultModel: anthropicDefault,
    });
    expect(result.config.activeProviderKey).toBe("openrouter");
  });

  it("forces re-auth when the stored token already expired", async () => {
    const { auth } = stubElectron({
      auth: {
        status: vi.fn(async () => ({
          loggedIn: true,
          expiresAt: Math.floor(Date.now() / 1000) - 60,
        })),
      },
    });

    await connectOAuthProvider("anthropic", "Anthropic", t);

    expect(auth.login).toHaveBeenCalledWith("anthropic", true);
  });

  it("throws and does not switch the active provider when no default model came back", async () => {
    const { config } = stubElectron({
      config: {
        saveProvider: vi.fn(async () => ({
          success: true,
          config: configWith({}),
        })),
      },
    });

    await expect(
      connectOAuthProvider("anthropic", "Anthropic", t),
    ).rejects.toThrow("no default model");
    expect(config.setActiveProvider).not.toHaveBeenCalled();
  });

  it("routes openrouter through the openrouter auth and reports a model fallback", async () => {
    const { config, openrouterAuth } = stubElectron({
      config: {
        fetchOpenRouterModels: vi.fn(async () => ({
          models: [{ id: "or-model", label: "or-model" }],
          usedFallback: true,
          error: "network down",
        })),
      },
    });

    const result = await connectOAuthProvider("openrouter", "OpenRouter", t);

    expect(openrouterAuth.login).toHaveBeenCalled();
    expect(config.saveProvider).toHaveBeenCalledWith({
      profileKey: "openrouter",
      config: expect.objectContaining({
        provider: "openrouter",
        apiKey: "or-key",
        defaultModel: "or-model",
      }),
    });
    expect(config.setActiveProvider).toHaveBeenCalledWith({
      profileKey: "openrouter",
      defaultModel: "or-model",
    });
    expect(result.openRouterModelsFromFallback).toEqual({
      error: "network down",
    });
  });
});

describe("connectCodingSubscription", () => {
  it("rejects a bailian key without the sk-sp- prefix and never persists it", async () => {
    const { config } = stubElectron();

    await expect(
      connectCodingSubscription(
        "custom:subscription-bailian-coding",
        "sk-plain",
        t,
      ),
    ).rejects.toThrow("api.subscriptionInvalidKey");
    expect(config.saveProvider).not.toHaveBeenCalled();
  });

  it("saves the plan and makes it active, keeping a previously chosen model when it is still valid", async () => {
    const { config } = stubElectron({
      config: {
        saveProvider: vi.fn(async () => ({
          success: true,
          config: configWith({
            "custom:subscription-bailian-coding": { defaultModel: "kimi-k2.5" },
          }),
        })),
      },
    });

    await connectCodingSubscription(
      "custom:subscription-bailian-coding",
      "sk-sp-abc",
      t,
      "kimi-k2.5",
    );

    expect(config.saveProvider).toHaveBeenCalledWith({
      profileKey: "custom:subscription-bailian-coding",
      config: expect.objectContaining({
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        defaultModel: "kimi-k2.5",
        apiKey: "sk-sp-abc",
      }),
    });
    expect(config.setActiveProvider).toHaveBeenCalledWith({
      profileKey: "custom:subscription-bailian-coding",
      defaultModel: "kimi-k2.5",
    });
  });

  it("falls back to the plan default model when the preferred one is gone", async () => {
    const { config } = stubElectron();

    await connectCodingSubscription(
      "custom:subscription-bailian-coding",
      "sk-sp-abc",
      t,
      "removed-model",
    );

    expect(config.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ defaultModel: "qwen3.7-plus" }),
      }),
    );
  });
});

describe("module boundaries", () => {
  it("never writes the zustand store", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/renderer/services/connect-provider.ts"),
      "utf8",
    );
    // 断言“不导入写 store 的东西”，而不是搜关键字 —— 后者会被注释里的词误伤。
    expect(source).not.toContain("useAppStore");
    expect(source).not.toContain('from "../store"');
    expect(source).not.toContain('from "../hooks/useApiConfigState"');
  });
});
