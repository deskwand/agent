// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { SettingsAPI } from "../../renderer/components/settings/SettingsAPI";
import { useAppStore } from "../../renderer/store";
import type {
  ApiProviderConfig,
  AppConfig,
  DiagnosticResult,
} from "../../renderer/types";
import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
import { normalizeCodemodeConfig } from "../../shared/codemode-config";
import { normalizeWebAccessConfig } from "../../shared/web-access";

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    provider: "custom",
    apiKey: "",
    baseUrl: "",
    customProtocol: "openai",
    model: "",
    contextWindow: undefined,
    maxTokens: undefined,
    activeProfileKey: "custom:relay",
    profiles: {},
    activeProviderKey: "custom:relay",
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

const relayProfile: ApiProviderConfig = {
  provider: "custom",
  customProtocol: "openai",
  name: "Relay",
  apiKey: "sk-test",
  baseUrl: "https://relay.example.com/v1",
  defaultModel: "qwen-max",
  models: [
    {
      id: "qwen-max",
      label: "Qwen Max",
      source: "custom",
      contextWindow: 32768,
    },
    { id: "qwen-plus", label: "Qwen Plus", source: "custom" },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const failedAuth: DiagnosticResult = {
  steps: [
    { name: "dns", status: "ok", latencyMs: 1 },
    { name: "tcp", status: "ok", latencyMs: 1 },
    { name: "tls", status: "skip", latencyMs: 0 },
    {
      name: "auth",
      status: "fail",
      latencyMs: 1,
      error: "401 Unauthorized",
      fix: "auth_invalid_key",
    },
    { name: "model", status: "skip", latencyMs: 0 },
  ],
  overallOk: false,
  failedAt: "auth",
  totalLatencyMs: 3,
};

describe("SettingsAPI per-model overrides", () => {
  let container: HTMLDivElement;
  let root: Root;
  let saveProvider: ReturnType<typeof vi.fn>;
  let config: AppConfig;

  async function settle(): Promise<void> {
    for (let index = 0; index < 12; index += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  /** 三层视图之后没有编辑弹窗，详情页就在 container 里。 */
  function dialog(): HTMLElement {
    return container;
  }

  function byTestId(id: string): HTMLElement {
    const element = dialog().querySelector<HTMLElement>(
      `[data-testid="${id}"]`,
    );
    if (!element) throw new Error(`testid ${id} not found`);
    return element;
  }

  function setInput(element: HTMLElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function blur(element: HTMLElement): void {
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }

  function lastSavedModels(): Array<Record<string, unknown>> {
    const calls = saveProvider.mock.calls;
    const payload = calls[calls.length - 1]?.[0] as {
      config: { models: Array<Record<string, unknown>> };
    };
    return payload.config.models;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);

    config = buildConfig({
      providers: { "custom:relay": relayProfile },
    });
    saveProvider = vi.fn(async () => ({ success: true, config }));

    useAppStore.setState({ appConfig: config, isConfigured: true });
    window.electronAPI = {
      config: {
        get: vi.fn(async () => config),
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        saveProvider,
        diagnose: vi.fn(async () => failedAuth),
      },
      auth: {
        status: vi.fn(async () => ({ loggedIn: false, providerName: "OAuth" })),
      },
      openrouterAuth: {
        login: vi.fn(),
        logout: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          loggedIn: false,
          providerName: "OpenRouter",
        })),
      },
    } as unknown as typeof window.electronAPI;
  });

  async function openEditor(): Promise<void> {
    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await settle();
    const edit = container.querySelector<HTMLElement>(
      '[data-testid="configured-provider-custom:relay"]',
    );
    expect(edit).not.toBeNull();
    await act(async () => {
      edit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
  }

  it("renders one list instead of a duplicate manual editor", async () => {
    await openEditor();
    expect(dialog().querySelectorAll('[data-testid="model-rows"]').length).toBe(
      1,
    );
    // 同一模型只出现一次（以前上面手工栏、下面勾选栏各渲染一遍）
    expect(dialog().textContent?.match(/Qwen Max/g)?.length).toBe(1);
  });

  it("persists an edited context window and pins it", async () => {
    await openEditor();
    // 上下文输入收进了能力 chip 的面板
    await act(async () => {
      byTestId("model-capability-qwen-max").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const input = byTestId("model-context-qwen-max");
    await act(async () => {
      setInput(input, "250000");
    });
    await settle();
    await act(async () => {
      blur(input);
    });
    await settle();

    expect(
      lastSavedModels().find((model) => model.id === "qwen-max"),
    ).toMatchObject({
      label: "Qwen Max",
      contextWindow: 250000,
      contextWindowPinned: true,
    });
  });

  it("persists the image capability toggle", async () => {
    await openEditor();
    await act(async () => {
      byTestId("model-capability-qwen-max").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    // 图片能力是三态按钮（自动 / 支持 / 仅文本），点「支持」即钉住
    const checkbox = byTestId("model-image-on-qwen-max");
    await act(async () => {
      checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(
      lastSavedModels().find((model) => model.id === "qwen-max"),
    ).toMatchObject({
      input: ["text", "image"],
      inputPinned: true,
    });
  });

  it("keeps the edited context window when the row is toggled afterwards", async () => {
    await openEditor();
    await act(async () => {
      byTestId("model-capability-qwen-max").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const input = byTestId("model-context-qwen-max");
    await act(async () => {
      setInput(input, "250000");
    });
    await settle();
    await act(async () => {
      blur(input);
    });
    await settle();

    const checkbox = byTestId("model-row-qwen-max");
    await act(async () => {
      checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    // 取消勾选后模型从启用集消失，再勾回来时上下文仍是用户填的值
    expect(
      lastSavedModels().find((model) => model.id === "qwen-max"),
    ).toBeUndefined();

    await act(async () => {
      byTestId("model-row-qwen-max").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await settle();

    expect(
      lastSavedModels().find((model) => model.id === "qwen-max"),
    ).toMatchObject({ contextWindow: 250000, contextWindowPinned: true });
  });
});
