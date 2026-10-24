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

const magpieModels = [
  { id: "opencode-go/kimi-k3", name: "Kimi K3" },
  { id: "auto/gpt-5.6-luna", name: "GPT-5.6 Luna" },
];

function liveDiagnostics(models = magpieModels): DiagnosticResult {
  return {
    steps: [
      { name: "dns", status: "ok", latencyMs: 1 },
      { name: "tcp", status: "ok", latencyMs: 1 },
      { name: "tls", status: "skip", latencyMs: 0 },
      { name: "auth", status: "ok", latencyMs: 1 },
      { name: "model", status: "skip", latencyMs: 0 },
    ],
    overallOk: true,
    totalLatencyMs: 3,
    models,
    modelsSource: "live",
    modelsFiltered: 0,
  };
}

function failedAuth(): DiagnosticResult {
  return {
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
}

const magpieProfile: ApiProviderConfig = {
  provider: "custom",
  customProtocol: "openai",
  name: "Magpie",
  apiKey: "magpie",
  baseUrl: "http://127.0.0.1:3425/v1",
  defaultModel: "opencode-go/kimi-k3",
  models: [
    {
      id: "opencode-go/kimi-k3",
      label: "Kimi K3",
      source: "custom",
    },
  ],
  localGateway: "magpie",
  updatedAt: "2026-10-24T00:00:00.000Z",
};

describe("SettingsAPI local gateway entry", () => {
  let container: HTMLDivElement;
  let root: Root;
  let saveProvider: ReturnType<typeof vi.fn>;
  let diagnose: ReturnType<typeof vi.fn>;
  let probeLocalGateway: ReturnType<typeof vi.fn>;

  async function settle(): Promise<void> {
    for (let index = 0; index < 12; index += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  function tileFor(entry: string): HTMLButtonElement {
    const tile = container.querySelector<HTMLButtonElement>(
      `button[data-catalog-entry="${entry}"]`,
    );
    if (!tile) throw new Error(`tile ${entry} not found`);
    return tile;
  }

  function editorDialog(): HTMLElement {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) throw new Error("api editor dialog not open");
    return dialog;
  }

  function inputNearLabel(
    scope: HTMLElement,
    labelText: string,
  ): HTMLInputElement | null {
    const label = Array.from(scope.querySelectorAll("label")).find((element) =>
      element.textContent?.includes(labelText),
    );
    const input = label?.parentElement?.querySelector("input");
    return (input as HTMLInputElement | null) ?? null;
  }

  function clickButton(scope: HTMLElement, text: string): void {
    const button = Array.from(scope.querySelectorAll("button")).find(
      (element) => element.textContent?.trim() === text,
    );
    if (!button) throw new Error(`button "${text}" not found`);
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

  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);

    saveProvider = vi.fn(async () => ({
      success: true,
      config: buildConfig({
        providers: { "custom:magpie": magpieProfile },
        activeProviderKey: "custom:magpie",
      }),
    }));
    diagnose = vi.fn(async () => liveDiagnostics());
    probeLocalGateway = vi.fn(async () => ({
      available: true,
      modelCount: 2,
    }));

    useAppStore.setState({ appConfig: buildConfig(), isConfigured: false });
    window.electronAPI = {
      config: {
        get: vi.fn(async () => buildConfig()),
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        saveProvider,
        diagnose,
        probeLocalGateway,
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

  it("probes, prefills and connects a running Magpie in one click", async () => {
    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await settle();

    await act(async () => {
      tileFor("local:magpie").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await settle();

    expect(probeLocalGateway).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:3425/v1",
      apiKey: "magpie",
    });
    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom",
        customProtocol: "openai",
        baseUrl: "http://127.0.0.1:3425/v1",
        captureModels: true,
      }),
    );
    expect(saveProvider).toHaveBeenCalledTimes(1);
    expect(saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          provider: "custom",
          localGateway: "magpie",
          name: "Magpie",
          apiKey: "magpie",
        }),
      }),
    );
    expect(
      editorDialog().querySelector(
        '[data-testid="model-row-opencode-go/kimi-k3"]',
      ),
    ).not.toBeNull();
  });

  it("only opens the prefilled editor when the gateway is not running", async () => {
    probeLocalGateway.mockResolvedValue({ available: false });

    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await settle();
    await act(async () => {
      tileFor("local:magpie").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await settle();

    expect(diagnose).not.toHaveBeenCalled();
    expect(saveProvider).not.toHaveBeenCalled();
    expect(editorDialog().textContent).toContain("Start its gateway");
  });

  it("opens the existing Magpie profile instead of creating another", async () => {
    const config = buildConfig({
      providers: { "custom:magpie": magpieProfile },
      activeProviderKey: "custom:magpie",
    });
    (
      window.electronAPI.config.get as ReturnType<typeof vi.fn>
    ).mockResolvedValue(config);

    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await settle();
    await act(async () => {
      tileFor("local:magpie").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await settle();

    // 打开编辑会触发一次后台静默刷新；关键是不能换 profileKey。
    expect(saveProvider).toHaveBeenCalled();
    for (const [payload] of saveProvider.mock.calls) {
      expect((payload as { profileKey: string }).profileKey).toBe(
        "custom:magpie",
      );
    }
    expect(inputNearLabel(editorDialog(), "Provider Name")?.value).toBe(
      "Magpie",
    );
  });

  it("explains a rejected key instead of reporting a generic failure", async () => {
    diagnose.mockResolvedValue(failedAuth());

    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await settle();
    await act(async () => {
      tileFor("local:magpie").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await settle();

    expect(editorDialog().textContent).toContain("Magpie rejected the key");
    expect(saveProvider).not.toHaveBeenCalled();
  });

  it("explains an empty model list and leaves nothing configured", async () => {
    diagnose.mockResolvedValue(liveDiagnostics([]));

    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await settle();
    await act(async () => {
      tileFor("local:magpie").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await settle();

    expect(editorDialog().textContent).toContain("no models yet");
    expect(saveProvider).not.toHaveBeenCalled();
  });

  it("ignores a second tile click while the first is opening", async () => {
    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await settle();

    const tile = tileFor("local:magpie");
    await act(async () => {
      tile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      tile.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    // 挂载一次 + 首次点击一次；第二次点击在弹窗挂载前就被丢弃。
    expect(probeLocalGateway).toHaveBeenCalledTimes(2);
    expect(saveProvider).toHaveBeenCalledTimes(1);
  });

  it("keeps the local gateway marker when saving after a failed connect", async () => {
    probeLocalGateway.mockResolvedValue({ available: false });
    diagnose.mockResolvedValue(failedAuth());

    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await settle();
    await act(async () => {
      tileFor("local:magpie").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await settle();

    await act(async () => {
      clickButton(editorDialog(), "Add Model");
    });
    await settle();
    const modelIdInput = Array.from(
      editorDialog().querySelectorAll("input"),
    ).find((input) => input.getAttribute("placeholder") === "Model ID");
    await act(async () => {
      setInput(modelIdInput ?? null, "opencode-go/kimi-k3");
    });
    await settle();

    await act(async () => {
      clickButton(editorDialog(), "Connect");
    });
    await settle();
    await act(async () => {
      clickButton(editorDialog(), "Save");
    });
    await settle();

    expect(saveProvider).toHaveBeenCalledTimes(1);
    const saved = saveProvider.mock.calls[0][0] as {
      config: ApiProviderConfig;
    };
    expect(saved.config.localGateway).toBe("magpie");
  });
});
