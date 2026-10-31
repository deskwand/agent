// @vitest-environment jsdom
//
// 轻量任务模型只能从已配置的模型里选：一个下拉 + 保存。
// 没有「继承」开关（它就是「没选具体模型」），也没有 Provider 下拉（那是同一个决定的第二次询问）。
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { SettingsAPI } from "../../renderer/components/settings/SettingsAPI";
import { useAppStore } from "../../renderer/store";
import type { AppConfig } from "../../renderer/types";
import { openMenu, optionValues } from "./settings-menu-helper";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
import { normalizeCodemodeConfig } from "../../shared/codemode-config";
import { normalizeWebAccessConfig } from "../../shared/web-access";

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    provider: "openrouter",
    apiKey: "",
    baseUrl: "https://openrouter.ai/api/v1",
    customProtocol: "anthropic",
    model: "",
    contextWindow: undefined,
    maxTokens: undefined,
    activeProfileKey: "openrouter",
    profiles: {},
    activeProviderKey: "openrouter",
    providers: {},
    deskWandCodePath: "",
    defaultWorkdir: "",
    theme: "light",
    themePreset: "zinc",
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: { maxNavSteps: 2, ingestionConcurrency: 4 },
    enableThinking: false,
    thinkingLevel: "medium",
    autoSkillLearning: false,
    isConfigured: true,
    webAccess: normalizeWebAccessConfig(undefined),
    codemode: normalizeCodemodeConfig(undefined),
    ...overrides,
  };
}

const deepseek = {
  provider: "deepseek" as const,
  customProtocol: "openai" as const,
  apiKey: "sk-deepseek",
  baseUrl: "https://api.deepseek.com/v1",
  defaultModel: "deepseek-v4-pro",
  models: [
    {
      id: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro",
      source: "preset" as const,
    },
    {
      id: "deepseek-flash",
      label: "DeepSeek Flash",
      source: "preset" as const,
    },
    { id: "deepseek-off", label: "DeepSeek Off", source: "preset" as const },
  ],
  disabledModels: ["deepseek-off"],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const oauthProfile = {
  provider: "oauth" as const,
  customProtocol: "anthropic" as const,
  apiKey: "",
  baseUrl: "",
  defaultModel: "gpt-6-astra",
  models: [
    { id: "gpt-6-astra", label: "GPT-6 Astra", source: "preset" as const },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const emptyModels = {
  provider: "custom" as const,
  customProtocol: "openai" as const,
  name: "无模型供应商",
  apiKey: "sk-x",
  baseUrl: "https://relay.example.com/v1",
  defaultModel: "",
  models: [],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;
let save: ReturnType<typeof vi.fn>;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function byTestId<T extends HTMLElement>(id: string): T | null {
  return container.querySelector<T>(`[data-testid="${id}"]`);
}

describe("轻量任务模型", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);

    const config = buildConfig({
      providers: {
        deepseek,
        "oauth:openai-codex": oauthProfile,
        "custom:relay": emptyModels,
      },
    });
    useAppStore.setState({ appConfig: config, isConfigured: true });
    save = vi.fn(async (updates: { utilityRuntime: unknown }) => ({
      success: true,
      config: buildConfig({ utilityRuntime: updates.utilityRuntime as never }),
    }));
    window.electronAPI = {
      config: {
        get: vi.fn(async () => config),
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        save,
        saveProvider: vi.fn(async () => ({ success: true, config })),
        deleteProvider: vi.fn(async () => ({ success: true, config })),
        fetchOpenRouterModels: vi.fn(async () => ({
          usedFallback: false,
          models: [],
        })),
      },
      auth: {
        status: vi.fn(async () => ({ loggedIn: false, providerName: "OAuth" })),
      },
      openrouterAuth: {
        status: vi.fn(async () => ({
          loggedIn: false,
          providerName: "OpenRouter",
        })),
        logout: vi.fn(async () => undefined),
        login: vi.fn(),
      },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function openUtilityTab(): Promise<void> {
    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await flush();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent?.trim() === i18n.t("api.utilityModelTab"))
        ?.click();
    });
    await flush();
  }

  it("只有一个模型下拉：没有继承开关，也没有 Provider 下拉", async () => {
    await openUtilityTab();
    expect(byTestId("utility-model")).not.toBeNull();
    expect(byTestId("utility-inherit-active")).toBeNull();
    expect(byTestId("utility-provider")).toBeNull();
  });

  it("默认是「跟随主模型」，保存写回 inheritFromActive: true", async () => {
    await openUtilityTab();
    expect(byTestId("utility-model")!.textContent).toContain(
      i18n.t("api.utilityModelFollowMain"),
    );

    await act(async () => byTestId<HTMLButtonElement>("utility-save")!.click());
    await flush();

    expect(save).toHaveBeenCalledWith({
      utilityRuntime: expect.objectContaining({
        inheritFromActive: true,
        providerProfileKey: undefined,
        model: "",
      }),
    });
  });

  it("选项只列已配置供应商的已启用模型，OAuth 与零模型供应商不出现", async () => {
    await openUtilityTab();
    await openMenu(container, "utility-model");
    const values = optionValues("utility-model");

    // 第一项是「跟随主模型」，其余是 profile::model
    expect(values[0]).toBe("follow-main");
    expect(values).toContain("deepseek|deepseek-flash");
    expect(values).toContain("deepseek|deepseek-v4-pro");
    // 停用的模型不列
    expect(values).not.toContain("deepseek|deepseek-off");
    // OAuth 的 key 是空串，选了必失败；零模型供应商没有可选项
    expect(values.some((value) => value.startsWith("oauth:"))).toBe(false);
    expect(values.some((value) => value.startsWith("custom:relay"))).toBe(
      false,
    );
  });

  it("选具体模型后落盘三个字段", async () => {
    await openUtilityTab();
    await openMenu(container, "utility-model");
    await act(async () => {
      document
        .querySelector<HTMLElement>(
          '[data-testid="utility-model-option-deepseek|deepseek-flash"]',
        )!
        .click();
    });
    await flush();

    await act(async () => byTestId<HTMLButtonElement>("utility-save")!.click());
    await flush();

    expect(save).toHaveBeenCalledWith({
      utilityRuntime: expect.objectContaining({
        inheritFromActive: false,
        providerProfileKey: "deepseek",
        model: "deepseek-flash",
      }),
    });
  });

  it("已配置的轻量任务模型在进页面时回显", async () => {
    const config = buildConfig({
      providers: { deepseek },
      utilityRuntime: {
        inheritFromActive: false,
        providerProfileKey: "deepseek" as never,
        model: "deepseek-flash",
        timeoutMs: 180000,
      },
    });
    (
      window.electronAPI.config.get as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(config);
    useAppStore.setState({ appConfig: config, isConfigured: true });

    await openUtilityTab();
    // 回显的是「供应商 / 模型」的可读名，而落盘值仍是 profileKey + model id
    expect(byTestId("utility-model")!.textContent).toContain("DeepSeek Flash");
  });
});
