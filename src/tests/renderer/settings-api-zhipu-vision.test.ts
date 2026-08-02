// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { SettingsAPI } from "../../renderer/components/settings/SettingsAPI";
import { useAppStore } from "../../renderer/store";
import type { AppConfig } from "../../renderer/types";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
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
    themePreset: "graphite",
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: { inheritFromActive: true, timeoutMs: 180000 },
      embedding: { inheritFromActive: true, timeoutMs: 180000 },
      useEmbedding: false,
      maxNavSteps: 2,
      ingestionConcurrency: 4,
    },
    enableThinking: false,
    thinkingLevel: "medium",
    autoSkillLearning: false,
    isConfigured: false,
    webAccess: normalizeWebAccessConfig(undefined),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function clickButton(container: HTMLElement, text: string): HTMLElement | null {
  const button =
    Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.trim() === text,
    ) || null;
  if (button) {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  return button;
}

describe("SettingsAPI Zhipu vision model", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
    useAppStore.setState({
      appConfig: buildConfig(),
      isConfigured: false,
    });
  });

  it("switches region and saves zhipu vision config with global baseUrl", async () => {
    const save = vi.fn(async (updates: { visionModel: unknown }) => ({
      success: true,
      config: buildConfig({ visionModel: updates.visionModel as never }),
    }));
    window.electronAPI = {
      config: {
        get: vi.fn(async () => buildConfig()),
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        save,
        saveProvider: vi.fn(async () => ({
          success: true,
          config: buildConfig(),
        })),
        fetchOpenRouterModels: vi.fn(async () => ({
          usedFallback: false,
          models: [],
        })),
      },
      auth: {
        status: vi.fn(async () => ({ loggedIn: false, providerName: "OAuth" })),
      },
      openrouterAuth: {
        login: vi.fn(async () => ({
          apiKey: "sk-or-v1-test",
          providerName: "OpenRouter",
        })),
        logout: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          loggedIn: false,
          providerName: "OpenRouter",
        })),
      },
    } as unknown as typeof window.electronAPI;

    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await flush();

    // 打开视觉模型 tab
    await act(async () => {
      clickButton(container, "Vision Model");
    });
    await flush();

    // 打开配置编辑器（空状态按钮）
    await act(async () => {
      clickButton(container, "Configure Vision Model");
    });
    await flush();

    // 选择「智谱」provider（预设 name 为硬编码中文）
    await act(async () => {
      clickButton(container, "智谱");
    });
    await flush();

    // 区域切换按钮出现（模型自动为 glm-4.6v-flash）
    const regionButtons = Array.from(container.querySelectorAll("button"));
    expect(
      regionButtons.some((b) => b.textContent?.includes("open.bigmodel.cn")),
    ).toBe(true);
    expect(regionButtons.some((b) => b.textContent?.includes("api.z.ai"))).toBe(
      true,
    );

    // 切换到国际站
    await act(async () => {
      const globalBtn =
        Array.from(container.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("api.z.ai"),
        ) || null;
      globalBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    // 填写 API Key（受控输入需 native setter + input 事件）
    const keyInput = container.querySelector('input[type="password"]');
    expect(keyInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(keyInput, "sk-zhipu-test");
      keyInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();

    // 保存
    await act(async () => {
      clickButton(container, "Save Settings");
    });
    await flush();

    expect(save).toHaveBeenCalledWith({
      visionModel: expect.objectContaining({
        provider: "zhipu",
        apiKey: "sk-zhipu-test",
        baseUrl: "https://api.z.ai/api/paas/v4",
        model: "glm-4.6v-flash",
      }),
    });
  });
});
