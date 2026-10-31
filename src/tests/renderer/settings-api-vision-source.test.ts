// @vitest-environment jsdom
//
// 视觉模型不再要求重填一遍凭证：来源可以是任一已配置供应商（复用其 key），
// 「单独配置」才展开手动编辑。这里锁的是三段式与落盘语义。
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { SettingsAPI } from "../../renderer/components/settings/SettingsAPI";
import { useAppStore } from "../../renderer/store";
import type { AppConfig } from "../../renderer/types";
import { pickOption } from "./settings-menu-helper";
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
    isConfigured: false,
    webAccess: normalizeWebAccessConfig(undefined),
    codemode: normalizeCodemodeConfig(undefined),
    ...overrides,
  };
}

const deepseekProfile = {
  provider: "deepseek" as const,
  customProtocol: "openai" as const,
  apiKey: "sk-live-deepseek",
  baseUrl: "https://api.deepseek.com/v1",
  defaultModel: "deepseek-v4-pro",
  models: [
    {
      id: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro",
      source: "preset" as const,
    },
    { id: "deepseek-chat", label: "DeepSeek Chat", source: "preset" as const },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("视觉模型来源", () => {
  let save: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
    const config = buildConfig({
      isConfigured: true,
      activeProviderKey: "deepseek",
      providers: { deepseek: deepseekProfile },
    });
    useAppStore.setState({ appConfig: config, isConfigured: true });
    save = vi.fn(async (updates: { visionModel: unknown }) => ({
      success: true,
      config: buildConfig({ visionModel: updates.visionModel as never }),
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

  async function openVisionTab(): Promise<void> {
    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await flush();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent?.trim() === i18n.t("api.visionModelTab"))
        ?.click();
    });
    await flush();
  }

  it("默认只有启用 / 来源 / 模型三段，不渲染供应商按钮墙", async () => {
    await openVisionTab();
    expect(
      container.querySelector('[data-testid="vision-source"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="vision-model"]')).toBeNull();
    // 手动配置的供应商墙只在「单独配置」里出现
    expect(
      Array.from(container.querySelectorAll("button")).some((b) =>
        (b.textContent ?? "").includes("API Key"),
      ),
    ).toBe(false);
  });

  it("来源选已配置供应商后，模型来自该供应商且保存 providerProfileKey", async () => {
    await openVisionTab();
    await pickOption(container, "vision-source", "profile:deepseek");
    await flush();

    // 模型下拉只有该供应商已启用的模型
    expect(
      container.querySelector('[data-testid="vision-model"]'),
    ).not.toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="vision-save"]')
        ?.click();
    });
    await flush();

    expect(save).toHaveBeenCalledWith({
      visionModel: expect.objectContaining({
        enabled: true,
        providerProfileKey: "deepseek",
        model: "deepseek-v4-pro",
      }),
    });
  });

  it("页面里没有手填表单：来源只有关闭与已配置供应商", async () => {
    await openVisionTab();

    const { openMenu } = await import("./settings-menu-helper");
    await openMenu(container, "vision-source");
    const optionIds = Array.from(
      document.querySelectorAll('[data-testid^="vision-source-option-"]'),
    ).map((node) => node.getAttribute("data-testid"));
    expect(optionIds).not.toContain("vision-source-option-manual");
    expect(optionIds).toContain("vision-source-option-off");
    expect(optionIds).toContain("vision-source-option-profile:deepseek");

    // 任何状态下都不渲染供应商墙 / API Key 输入
    expect(
      container.querySelector('[data-testid="vision-provider-anthropic"]'),
    ).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("旧的手工配置不丢失：给一条只读来源，保存时原样写回", async () => {
    const legacy = buildConfig({
      isConfigured: true,
      visionModel: {
        enabled: true,
        provider: "deepseek",
        apiKey: "sk-legacy",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-flash",
      },
    });
    (
      window.electronAPI.config.get as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(legacy);
    useAppStore.setState({ appConfig: legacy, isConfigured: true });

    await openVisionTab();

    // 只读提示：说清当前是旧手工配置、怎么替换
    expect(container.textContent).toContain(
      i18n.t("api.visionLegacyNotice", {
        provider: "DeepSeek",
        model: "deepseek-flash",
      }),
    );
    expect(container.querySelector('input[type="password"]')).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="vision-save"]')
        ?.click();
    });
    await flush();

    const payload = save.mock.calls[0][0] as {
      visionModel: {
        enabled: boolean;
        providerProfileKey?: string;
        apiKey: string;
      };
    };
    expect(payload.visionModel.enabled).toBe(true);
    expect(payload.visionModel.providerProfileKey).toBeUndefined();
    expect(payload.visionModel.apiKey).toBe("sk-legacy");
  });

  it("来源关闭时保存 enabled:false，且不带 providerProfileKey", async () => {
    await openVisionTab();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="vision-save"]')
        ?.click();
    });
    await flush();

    const payload = save.mock.calls[0][0] as {
      visionModel: { enabled: boolean; providerProfileKey?: string };
    };
    expect(payload.visionModel.enabled).toBe(false);
    expect(payload.visionModel.providerProfileKey).toBeUndefined();
  });
});
