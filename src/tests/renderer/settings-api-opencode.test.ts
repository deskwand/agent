// @vitest-environment jsdom
//
// OpenCode 的三档（Zen / Go / Go Plus）从「一个弹窗里切计划」变成目录里的两个条目：
// 选哪个条目就是选哪档，草稿里的 provider / baseUrl 跟着条目走。
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { SettingsAPI } from "../../renderer/components/settings/SettingsAPI";
import { PROVIDER_CATALOG } from "../../renderer/components/settings/provider-catalog";
import { useAppStore } from "../../renderer/store";
import type { AppConfig, DiagnosticResult } from "../../renderer/types";
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

function liveDiagnostics(
  models: Array<{ id: string; name: string }>,
): DiagnosticResult {
  return {
    steps: [{ name: "auth", status: "ok", latencyMs: 1 }],
    overallOk: true,
    totalLatencyMs: 1,
    models,
    modelsSource: "live",
    modelsFiltered: 0,
  };
}

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function clickButton(scope: HTMLElement, text: string): void {
  const button = Array.from(scope.querySelectorAll("button")).find(
    (element) =>
      element.textContent?.trim() === text ||
      element.getAttribute("aria-label") === text,
  );
  if (!button) {
    throw new Error(
      `button "${text}" not found; have: ${Array.from(
        scope.querySelectorAll("button"),
      )
        .map((b) => b.textContent?.trim())
        .join(" | ")}`,
    );
  }
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function setInput(input: Element | null, value: string): void {
  if (!input) throw new Error("input not found");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function inputNearLabel(
  scope: HTMLElement,
  labelText: string,
): HTMLInputElement | null {
  const label = Array.from(scope.querySelectorAll("label")).find((element) =>
    element.textContent?.includes(labelText),
  );
  const input =
    label?.querySelector("input") ??
    label?.parentElement?.querySelector("input");
  return (input as HTMLInputElement | null) ?? null;
}

async function openAdd(entryLabel: string): Promise<void> {
  await act(async () => {
    root.render(React.createElement(SettingsAPI, {}));
  });
  await flush();
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('[data-testid="provider-list-add"]')
      ?.click();
  });
  await flush();
  await act(async () => {
    clickButton(container, entryLabel);
  });
  await flush();
}

describe("SettingsAPI OpenCode provider", () => {
  let saveProvider: ReturnType<typeof vi.fn>;
  let diagnose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
    saveProvider = vi.fn(
      async (payload: { profileKey: string; config: never }) => ({
        success: true,
        config: buildConfig({
          isConfigured: true,
          activeProviderKey: payload.profileKey,
          providers: { [payload.profileKey]: payload.config },
        }),
      }),
    );
    diagnose = vi.fn(async () =>
      liveDiagnostics([
        { id: "kimi-k3", name: "Kimi K3" },
        { id: "beam-free", name: "Beam Free" },
      ]),
    );
    useAppStore.setState({ appConfig: buildConfig(), isConfigured: false });
    window.electronAPI = {
      config: {
        get: vi.fn(async () => buildConfig()),
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        saveProvider,
        diagnose,
        save: vi.fn(async () => ({ success: true, config: buildConfig() })),
        deleteProvider: vi.fn(async () => ({
          success: true,
          config: buildConfig(),
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

  it("Zen 与 Go 是两个独立条目，各自带自己的 baseUrl", async () => {
    const relay = PROVIDER_CATALOG.find((category) => category.id === "relay");
    const ids = relay?.entries.map((entry) => entry.id);
    expect(ids).toContain("opencode");
    expect(ids).toContain("opencode-go");

    await openAdd("OpenCode Go");
    const baseUrl = inputNearLabel(container, "Base URL");
    expect(baseUrl?.value).toContain("go");
    // 表单标题认得出是哪一档
    expect(container.textContent).toContain("OpenCode Go");
  });

  it("连接 Go 计划并带上端点独有模型", async () => {
    await openAdd("OpenCode Go");
    await act(async () => {
      setInput(inputNearLabel(container, "API Key"), "sk-opencode-go");
    });
    await flush();
    await act(async () => {
      clickButton(container, "Add");
    });
    await flush();

    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "opencode-go", captureModels: true }),
    );

    // 两次落盘：连接前用目录兜底，第二次带着合并后的完整列表
    expect(saveProvider).toHaveBeenCalledTimes(2);
    const lastPayload = saveProvider.mock.calls[1][0] as {
      profileKey: string;
      config: {
        provider: string;
        customProtocol: string;
        baseUrl: string;
        defaultModel: string;
        models: Array<{ id: string }>;
      };
    };
    expect(lastPayload.profileKey).toBe("opencode-go");
    expect(lastPayload.config.provider).toBe("opencode-go");
    expect(lastPayload.config.customProtocol).toBe("openai");
    expect(lastPayload.config.baseUrl).toContain("go");

    const ids = lastPayload.config.models.map((model) => model.id);
    expect(ids).toContain("kimi-k3");
    expect(ids).toContain("beam-free");
    // Go 计划的目录默认模型
    expect(lastPayload.config.defaultModel).toBe("kimi-k3");

    // 成功后回到列表
    expect(
      container.querySelector('[data-testid="provider-list-add"]'),
    ).toBeTruthy();
  });

  it("打开已有 OpenCode 档案时就地刷新模型列表", async () => {
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
    useAppStore.setState({ appConfig: savedConfig, isConfigured: true });
    (
      window.electronAPI.config.get as ReturnType<typeof vi.fn>
    ).mockResolvedValue(savedConfig);
    diagnose.mockRejectedValue(new Error("offline"));

    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await flush();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="configured-provider-opencode-go"]',
        )
        ?.click();
    });
    await flush();

    // 静默刷新失败：保留本地列表，且不写回
    const rows = container.querySelectorAll('[data-testid^="model-row-"]');
    expect(rows.length).toBe(1);
    expect(diagnose).toHaveBeenCalled();
    expect(saveProvider).not.toHaveBeenCalled();
  });
});
