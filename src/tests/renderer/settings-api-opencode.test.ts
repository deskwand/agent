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
    memoryRuntime: {
      maxNavSteps: 2,
      ingestionConcurrency: 4,
    },
    enableThinking: false,
    thinkingLevel: "medium",
    autoSkillLearning: false,
    isConfigured: false,
    webAccess: normalizeWebAccessConfig(undefined),
    codemode: normalizeCodemodeConfig(undefined),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function clickButton(container: HTMLElement, text: string): void {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === text,
  );
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/**
 * API 编辑弹窗外壳迁到 shadcn Dialog 后经 portal 挂到 document.body，
 * 不再位于测试的 container 内：弹窗内查询收窄到当前 dialog；
 * 页面级节点（目录瓦片）仍查 container。
 */
function editorDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error("api editor dialog not open");
  return dialog;
}

describe("SettingsAPI OpenCode provider", () => {
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
    window.electronAPI = {
      config: {
        get: vi.fn(async () => buildConfig()),
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
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
  });

  it("shows the OpenCode card and switches between Zen and Go plans", async () => {
    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await flush();

    // api.addApi 从按钮变成分类网格的标题：直接点网格里的 OpenCode 瓦片进编辑器
    await act(async () => {
      clickButton(container, "OpenCode");
    });
    await flush();

    // Zen/Go 切换按钮出现（测试环境为英文 locale：Zen · Pay as you go / Go · $10/mo subscription）
    const planButtons = Array.from(editorDialog().querySelectorAll("button"));
    expect(
      planButtons.some((b) => b.textContent?.includes("Pay as you go")),
    ).toBe(true);
    expect(planButtons.some((b) => b.textContent?.includes("$10/mo"))).toBe(
      true,
    );

    // 切换到 Go：OpenCode Go 按钮变为选中态
    await act(async () => {
      const goBtn = planButtons.find((b) => b.textContent?.includes("$10/mo"));
      goBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const afterSwitch = Array.from(editorDialog().querySelectorAll("button"));
    const goActive = afterSwitch.find((b) => b.textContent?.includes("$10/mo"));
    expect(goActive?.className).toContain("border-primary");

    // 填写 API Key 并切换回 Zen，Key 保留
    const keyInput = editorDialog().querySelector('input[type="password"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(keyInput, "sk-opencode-test");
      keyInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();

    await act(async () => {
      const zenBtn = Array.from(editorDialog().querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Pay as you go"),
      );
      zenBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const keyAfterSwitch = editorDialog().querySelector(
      'input[type="password"]',
    ) as HTMLInputElement | null;
    expect(keyAfterSwitch?.value).toBe("sk-opencode-test");
  });

  it("connects the Go plan and keeps endpoint-only models", async () => {
    type SavedPayload = {
      profileKey: string;
      config: {
        provider: string;
        baseUrl: string;
        defaultModel: string;
        models: Array<{ id: string }>;
      };
    };
    const saveProvider = vi.fn(async (_payload: SavedPayload) => ({
      success: true,
      config: buildConfig(),
    }));
    const diagnose = vi.fn(async () => ({
      steps: [{ name: "auth", status: "ok", latencyMs: 1 }],
      overallOk: true,
      totalLatencyMs: 1,
      models: [
        { id: "kimi-k3", name: "Kimi K3" },
        { id: "beam-free", name: "Beam Free" },
      ],
      modelsSource: "live",
      modelsFiltered: 0,
    }));
    window.electronAPI = {
      ...window.electronAPI,
      config: {
        ...window.electronAPI.config,
        saveProvider,
        diagnose,
      },
    } as unknown as typeof window.electronAPI;

    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await flush();

    await act(async () => {
      clickButton(container, "OpenCode");
    });
    await flush();

    // OpenCode 与其它预设供应商一样走「连接」，不再有单独的「保存设置」
    expect(editorDialog().textContent).toContain("Connect");
    expect(editorDialog().textContent).not.toContain("Save Settings");

    // 切换到 Go
    await act(async () => {
      const goBtn = Array.from(editorDialog().querySelectorAll("button")).find(
        (b) => b.textContent?.includes("$10/mo"),
      );
      goBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const keyInput = editorDialog().querySelector('input[type="password"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(keyInput, "sk-opencode-go");
      keyInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    await act(async () => {
      clickButton(editorDialog(), "Connect");
    });
    await flush();

    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "opencode-go",
        captureModels: true,
      }),
    );

    // 两次落盘：连接前用目录兜底，第二次带着合并后的完整列表
    expect(saveProvider).toHaveBeenCalledTimes(2);
    const lastPayload = saveProvider.mock.calls[1][0];
    expect(lastPayload).toEqual(
      expect.objectContaining({
        profileKey: "opencode-go",
        config: expect.objectContaining({
          provider: "opencode-go",
          customProtocol: "openai",
          baseUrl: "https://opencode.ai/inference/go/v1",
        }),
      }),
    );
    const ids = lastPayload.config.models.map((model) => model.id);
    expect(ids).toContain("kimi-k3");
    // 端点独有模型会被带去落盘（主进程 enrich 的保留逻辑由
    // opencode-presets.test.ts 单独覆盖）
    expect(ids).toContain("beam-free");
    // Go 计划的目录默认模型
    expect(lastPayload.config.defaultModel).toBe("kimi-k3");
    expect(editorDialog().textContent).toContain("Connected");
  });

  it("refreshes an existing OpenCode profile when its editor opens", async () => {
    const savedConfig = buildConfig({
      activeProviderKey: "opencode-go",
      isConfigured: true,
      providers: {
        "opencode-go": {
          provider: "opencode-go",
          customProtocol: "openai",
          apiKey: "oc_sk_test",
          baseUrl: "https://opencode.ai/zen/go/v1",
          defaultModel: "kimi-k3",
          models: [{ id: "kimi-k3", label: "Kimi K3", source: "preset" }],
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    const saveProvider = vi.fn(async (_payload: unknown) => ({
      success: true,
      config: savedConfig,
    }));
    const diagnose = vi.fn(async () => ({
      steps: [{ name: "auth", status: "ok", latencyMs: 1 }],
      overallOk: true,
      totalLatencyMs: 1,
      models: [
        { id: "kimi-k3", name: "Kimi K3" },
        { id: "beam-free", name: "Beam Free" },
      ],
      modelsSource: "live",
      modelsFiltered: 0,
    }));
    useAppStore.setState({ appConfig: savedConfig, isConfigured: true });
    window.electronAPI = {
      ...window.electronAPI,
      config: {
        ...window.electronAPI.config,
        get: vi.fn(async () => savedConfig),
        saveProvider,
        diagnose,
      },
    } as unknown as typeof window.electronAPI;

    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await flush();

    const editButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="opencode-go-edit"]',
    );
    expect(editButton).not.toBeNull();
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // 静默刷新是 openEdit 里 fire-and-forget 的，多推几轮微任务
    await flush();
    await flush();

    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "opencode-go",
        captureModels: true,
      }),
    );
    const lastPayload = saveProvider.mock.calls.at(-1)?.[0] as
      | { config: { models: Array<{ id: string }> } }
      | undefined;
    expect(lastPayload?.config.models.map((model) => model.id)).toContain(
      "beam-free",
    );
  });
});
