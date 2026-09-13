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
    memoryRuntime: { maxNavSteps: 2, ingestionConcurrency: 4 },
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

describe("SettingsAPI OAuth login flow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
    useAppStore.setState({ appConfig: buildConfig(), isConfigured: false });
  });

  it("saves an empty renderer catalog and activates the SDK-selected Codex default", async () => {
    const savedConfig = buildConfig({
      providers: {
        "oauth:openai-codex": {
          provider: "oauth",
          customProtocol: "anthropic",
          apiKey: "",
          baseUrl: "",
          defaultModel: "gpt-6-astra",
          models: [
            { id: "gpt-6-astra", label: "GPT-6 Astra", source: "preset" },
          ],
          updatedAt: "2026-09-13T00:00:00.000Z",
        },
      },
    });
    const saveProvider = vi.fn(async () => ({
      success: true,
      config: savedConfig,
    }));
    const setActiveProvider = vi.fn(async () => ({
      success: true,
      config: savedConfig,
    }));
    const get = vi.fn(async () => savedConfig);

    window.electronAPI = {
      config: {
        get,
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        saveProvider,
        setActiveProvider,
      },
      auth: {
        login: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          loggedIn: false,
          providerName: "OpenAI Codex",
        })),
      },
      openrouterAuth: {
        login: vi.fn(async () => ({ apiKey: "", providerName: "OpenRouter" })),
        logout: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          loggedIn: false,
          providerName: "OpenRouter",
        })),
      },
    } as unknown as typeof window.electronAPI;

    await act(async () => {
      root.render(
        React.createElement(
          SettingsAPI as React.ComponentType<{ embedded?: boolean }>,
          { embedded: true },
        ),
      );
    });
    await flush();

    const button = container.querySelector(
      '[data-testid="openai-codex-oauth-connect"]',
    );
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(saveProvider).toHaveBeenCalledWith({
      profileKey: "oauth:openai-codex",
      config: expect.objectContaining({
        provider: "oauth",
        defaultModel: "",
        models: [],
      }),
    });
    expect(setActiveProvider).toHaveBeenCalledWith({
      profileKey: "oauth:openai-codex",
      defaultModel: "gpt-6-astra",
    });
  });

  it("does not activate the provider when SDK catalog saving fails", async () => {
    const saveProvider = vi.fn(async () => {
      throw new Error(
        "Pi SDK returned no models for OAuth provider openai-codex",
      );
    });
    const setActiveProvider = vi.fn(async () => ({
      success: true,
      config: buildConfig(),
    }));
    const get = vi.fn(async () => buildConfig());

    window.electronAPI = {
      config: {
        get,
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        saveProvider,
        setActiveProvider,
      },
      auth: {
        login: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          loggedIn: false,
          providerName: "OpenAI Codex",
        })),
      },
      openrouterAuth: {
        login: vi.fn(async () => ({ apiKey: "", providerName: "OpenRouter" })),
        logout: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          loggedIn: false,
          providerName: "OpenRouter",
        })),
      },
    } as unknown as typeof window.electronAPI;

    await act(async () => {
      root.render(
        React.createElement(
          SettingsAPI as React.ComponentType<{ embedded?: boolean }>,
          { embedded: true },
        ),
      );
    });
    await flush();
    setActiveProvider.mockClear();
    get.mockClear();

    const button = container.querySelector(
      '[data-testid="openai-codex-oauth-connect"]',
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(setActiveProvider).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Pi SDK returned no models for OAuth provider openai-codex",
    );
  });
});
