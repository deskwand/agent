// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { SettingsAPI } from "../../renderer/components/settings/SettingsAPI";
import { useAppStore } from "../../renderer/store";
import type { AppConfig, DiagnosticResult } from "../../renderer/types";
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
    memoryRuntime: { maxNavSteps: 2, ingestionConcurrency: 4 },
    enableThinking: false,
    thinkingLevel: "medium",
    autoSkillLearning: false,
    isConfigured: false,
    webAccess: normalizeWebAccessConfig(undefined),
    ...overrides,
  };
}

function liveDiagnostics(
  models: Array<{ id: string; name: string }>,
): DiagnosticResult {
  return {
    steps: [
      { name: "dns", status: "ok", latencyMs: 1 },
      { name: "tcp", status: "ok", latencyMs: 1 },
      { name: "tls", status: "ok", latencyMs: 1 },
      { name: "auth", status: "ok", latencyMs: 1 },
      { name: "model", status: "skip", latencyMs: 0 },
    ],
    overallOk: true,
    totalLatencyMs: 4,
    models,
    modelsSource: "live",
    modelsFiltered: 0,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** 弹窗渲染在整个页面最后；OAuth 卡片里也有叫「Connect」的按钮，取最后一个匹配项 */
function clickButton(container: HTMLElement, text: string): void {
  const matches = Array.from(container.querySelectorAll("button")).filter(
    (element) => element.textContent?.trim() === text,
  );
  const button = matches[matches.length - 1];
  if (!button) {
    throw new Error(
      `button "${text}" not found; have: ${Array.from(
        container.querySelectorAll("button"),
      )
        .map((b) => b.textContent?.trim())
        .join(" | ")}`,
    );
  }
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/**
 * React 受控输入必须走原生 value setter，直接改 .value 不会触发 onChange。
 * 与 settings-api-opencode.test.ts 的写法保持一致。
 */
function setInput(input: Element | null, value: string): void {
  if (!input) throw new Error("input not found");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 弹窗里的字段是「label 兄弟节点 + input」结构，按 label 文案定位 */
function inputNearLabel(
  container: HTMLElement,
  labelText: string,
): HTMLInputElement | null {
  const label = Array.from(container.querySelectorAll("label")).find(
    (element) => element.textContent?.includes(labelText),
  );
  const input = label?.parentElement?.querySelector("input");
  return (input as HTMLInputElement | null) ?? null;
}

describe("SettingsAPI connect flow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let saveProvider: ReturnType<typeof vi.fn>;
  let diagnose: ReturnType<typeof vi.fn>;

  async function openProviderModal(providerLabel: string): Promise<void> {
    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await flush();
    await act(async () => {
      clickButton(container, "Add Provider");
    });
    await flush();
    await act(async () => {
      clickButton(container, providerLabel);
    });
    await flush();
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
    saveProvider = vi.fn(async () => ({
      success: true,
      config: buildConfig(),
    }));
    diagnose = vi.fn(async () =>
      liveDiagnostics([
        { id: "claude-opus-4-6", name: "claude-opus-4-6" },
        { id: "claude-opus-4-7", name: "claude-opus-4-7" },
      ]),
    );
    useAppStore.setState({ appConfig: buildConfig(), isConfigured: false });
    window.electronAPI = {
      config: {
        get: vi.fn(async () => buildConfig()),
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        saveProvider,
        diagnose,
        fetchOpenRouterModels: vi.fn(async () => ({
          usedFallback: false,
          models: [],
        })),
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

  it("connects a preset provider, discovers models and persists them", async () => {
    await openProviderModal("Anthropic");
    await act(async () => {
      setInput(inputNearLabel(container, "API Key"), "sk-ant-test");
    });
    await flush();

    await act(async () => {
      clickButton(container, "Connect");
    });
    await flush();

    // 1) 先落盘一次（模型为空 → 主进程按内置目录兜底）
    expect(saveProvider).toHaveBeenCalledTimes(2);
    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic", captureModels: true }),
    );

    // 2) 第二次落盘带着合并后的启用集，包含端点新增的模型
    const lastPayload = saveProvider.mock.calls[1][0] as {
      config: { models: Array<{ id: string }>; defaultModel: string };
    };
    const ids = lastPayload.config.models.map((m) => m.id);
    expect(ids).toContain("claude-opus-4-6");
    expect(ids).toContain("claude-opus-4-7");
    expect(lastPayload.config.defaultModel).toBeTruthy();

    // 3) 进入已连接态
    expect(container.textContent).toContain("Connected");
    expect(container.textContent).toContain("Done");
  });

  it("keeps a custom provider unsaved when the endpoint cannot list models", async () => {
    diagnose.mockResolvedValue({
      steps: [{ name: "auth", status: "ok", latencyMs: 1 }],
      overallOk: true,
      totalLatencyMs: 1,
      modelsSource: "unsupported",
      models: [],
    } as DiagnosticResult);

    await openProviderModal("Other Provider");
    await act(async () => {
      setInput(inputNearLabel(container, "API Key"), "sk-test");
      setInput(
        inputNearLabel(container, "Base URL"),
        "https://relay.example.com/v1",
      );
    });
    await flush();

    await act(async () => {
      clickButton(container, "Connect");
    });
    await flush();

    // 自定义供应商不先落盘，端点也不支持列表 → 一次 saveProvider 都没发
    expect(saveProvider).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Save");
    expect(container.textContent).toContain(
      "This endpoint does not list models; enter model IDs manually",
    );
  });

  it("persists checkbox toggles and blocks disabling the last model", async () => {
    await openProviderModal("Anthropic");
    await act(async () => {
      setInput(inputNearLabel(container, "API Key"), "sk-ant-test");
    });
    await flush();
    await act(async () => {
      clickButton(container, "Connect");
    });
    await flush();

    const before = saveProvider.mock.calls.length;
    const row = container.querySelector(
      '[data-testid="model-row-claude-opus-4-7"]',
    ) as HTMLInputElement;
    expect(row).toBeTruthy();

    await act(async () => {
      const checkboxSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "checked",
      )?.set;
      checkboxSetter?.call(row, false);
      row.dispatchEvent(new Event("click", { bubbles: true }));
      row.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(saveProvider.mock.calls.length).toBe(before + 1);
    const payload = saveProvider.mock.calls[before][0] as {
      config: { models: Array<{ id: string }>; disabledModels?: string[] };
    };
    expect(payload.config.models.map((m) => m.id)).not.toContain(
      "claude-opus-4-7",
    );
    expect(payload.config.disabledModels).toContain("claude-opus-4-7");
  });

  it("seeds the local list when editing and does not persist a failed refresh", async () => {
    const providerConfig = {
      provider: "openai" as const,
      customProtocol: "openai" as const,
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
      models: [
        { id: "gpt-5.4", label: "gpt-5.4", source: "preset" as const },
        {
          id: "gpt-5.4-mini",
          label: "gpt-5.4-mini",
          source: "preset" as const,
        },
      ],
      disabledModels: ["gpt-5.4-mini"],
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const config = buildConfig({
      activeProfileKey: "openai",
      activeProviderKey: "openai",
      providers: { openai: providerConfig },
      isConfigured: true,
    });
    useAppStore.setState({ appConfig: config, isConfigured: true });
    (
      window.electronAPI.config.get as ReturnType<typeof vi.fn>
    ).mockResolvedValue(config);
    diagnose.mockRejectedValue(new Error("offline"));

    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await flush();
    await act(async () => {
      clickButton(container, "Edit");
    });
    await flush();

    // 打开编辑即后台刷新；刷新失败时本地列表照常显示，且不写回
    const rows = container.querySelectorAll('[data-testid^="model-row-"]');
    expect(rows.length).toBe(2);
    expect(saveProvider).not.toHaveBeenCalled();
  });

  it("shows the diagnostics pipeline when the connect fails", async () => {
    diagnose.mockResolvedValue({
      steps: [
        { name: "dns", status: "ok", latencyMs: 1 },
        { name: "tcp", status: "ok", latencyMs: 1 },
        { name: "tls", status: "ok", latencyMs: 1 },
        {
          name: "auth",
          status: "fail",
          latencyMs: 1,
          fix: "auth_invalid_key",
        },
        { name: "model", status: "skip", latencyMs: 0 },
      ],
      overallOk: false,
      failedAt: "auth",
      totalLatencyMs: 4,
      modelsSource: "error",
      modelsError: "invalid api key",
    } as DiagnosticResult);

    await openProviderModal("Anthropic");
    await act(async () => {
      setInput(inputNearLabel(container, "API Key"), "sk-ant-bad");
    });
    await flush();
    await act(async () => {
      clickButton(container, "Connect");
    });
    await flush();

    // 面板渲染五步流水线，且不渲染它自己的动作按钮
    expect(container.textContent).toContain("Auth");
    expect(container.textContent).not.toContain("Deep Inference Check");
    // 失败态给「保存」（保住刚填的 Key）+ 「重试」
    expect(container.textContent).toContain("Retry");
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Save",
    );
    expect(saveButton).toBeTruthy();
  });

  it("keeps the local list with a one-line hint when the background refresh fails", async () => {
    const providerConfig = {
      provider: "openai" as const,
      customProtocol: "openai" as const,
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
      models: [{ id: "gpt-5.4", label: "gpt-5.4", source: "preset" as const }],
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const config = buildConfig({
      activeProfileKey: "openai",
      activeProviderKey: "openai",
      providers: { openai: providerConfig },
      isConfigured: true,
    });
    useAppStore.setState({ appConfig: config, isConfigured: true });
    (
      window.electronAPI.config.get as ReturnType<typeof vi.fn>
    ).mockResolvedValue(config);
    // 主进程以“失败的 DiagnosticResult”回来（而不是 reject）
    diagnose.mockResolvedValue({
      steps: [
        { name: "dns", status: "ok", latencyMs: 1 },
        { name: "auth", status: "fail", latencyMs: 1, fix: "auth_invalid_key" },
      ],
      overallOk: false,
      failedAt: "auth",
      totalLatencyMs: 2,
      modelsSource: "error",
    } as DiagnosticResult);

    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await flush();
    await act(async () => {
      clickButton(container, "Edit");
    });
    await flush();

    // 静默刷新：保留本地列表、只留一行提示，不弹诊断面板、按钮栏仍是「连接」
    expect(container.textContent).toContain(
      "Refresh failed; showing the local list",
    );
    expect(container.textContent).not.toContain("Auth");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (b) => b.textContent?.trim() === "Connect",
      ),
    ).toBe(true);
  });
});
