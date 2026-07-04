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
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("SettingsAPI OpenRouter login flow", () => {
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

  it("connects OpenRouter and saves fetched models", async () => {
    const login = vi.fn(async () => ({
      apiKey: "sk-or-v1-test",
      providerName: "OpenRouter",
    }));
    const fetchOpenRouterModels = vi.fn(async () => ({
      usedFallback: false,
      models: [
        { id: "openrouter/free", label: "Free (Free)", source: "preset" as const },
        { id: "openrouter/paid", label: "Paid", source: "preset" as const },
      ],
    }));
    const saveProvider = vi.fn(async () => ({ success: true, config: buildConfig() }));
    const setActiveProvider = vi.fn(async () => ({ success: true, config: buildConfig() }));
    const get = vi.fn(async () =>
      buildConfig({
        isConfigured: true,
        activeProviderKey: "openrouter",
        providers: {
          openrouter: {
            provider: "openrouter",
            customProtocol: "anthropic",
            apiKey: "sk-or-v1-test",
            baseUrl: "https://openrouter.ai/api/v1",
            defaultModel: "openrouter/free",
            models: [
              { id: "openrouter/free", label: "Free (Free)", source: "preset" },
              { id: "openrouter/paid", label: "Paid", source: "preset" },
            ],
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      }),
    );

    window.electronAPI = {
      config: {
        get,
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        saveProvider,
        setActiveProvider,
        fetchOpenRouterModels,
      },
      auth: {
        status: vi.fn(async () => ({ loggedIn: false, providerName: "OAuth" })),
      },
      openrouterAuth: {
        login,
        logout: vi.fn(async () => undefined),
        status: vi.fn(async () => ({ loggedIn: false, providerName: "OpenRouter" })),
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

    const button = container.querySelector('[data-testid="openrouter-oauth-connect"]');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(login).toHaveBeenCalled();
    expect(fetchOpenRouterModels).toHaveBeenCalled();
    expect(saveProvider).toHaveBeenCalledWith({
      profileKey: "openrouter",
      config: expect.objectContaining({
        provider: "openrouter",
        apiKey: "sk-or-v1-test",
        defaultModel: "openrouter/free",
        models: [
          { id: "openrouter/free", label: "Free (Free)", source: "preset" },
          { id: "openrouter/paid", label: "Paid", source: "preset" },
        ],
      }),
    });
    expect(setActiveProvider).toHaveBeenCalledWith({
      profileKey: "openrouter",
      defaultModel: "openrouter/free",
    });
  });

  it("disconnects OpenRouter and removes the provider", async () => {
    const logout = vi.fn(async () => undefined);
    const deleteProvider = vi.fn(async () => ({ success: true, config: buildConfig() }));

    window.electronAPI = {
      config: {
        get: vi.fn(async () =>
          buildConfig({
            isConfigured: true,
            providers: {
              openrouter: {
                provider: "openrouter",
                customProtocol: "anthropic",
                apiKey: "sk-or-v1-test",
                baseUrl: "https://openrouter.ai/api/v1",
                defaultModel: "openrouter/free",
                models: [{ id: "openrouter/free", label: "Free (Free)", source: "preset" }],
                updatedAt: "2024-01-01T00:00:00.000Z",
              },
            },
          }),
        ),
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        deleteProvider,
        fetchOpenRouterModels: vi.fn(async () => ({ usedFallback: false, models: [] })),
      },
      auth: {
        status: vi.fn(async () => ({ loggedIn: false, providerName: "OAuth" })),
      },
      openrouterAuth: {
        login: vi.fn(async () => ({ apiKey: "sk-or-v1-test", providerName: "OpenRouter" })),
        logout,
        status: vi.fn(async () => ({ loggedIn: true, providerName: "OpenRouter" })),
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

    const disconnectButton = container.querySelector('[data-testid="openrouter-oauth-disconnect"]');
    expect(disconnectButton).not.toBeNull();

    await act(async () => {
      disconnectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    const confirmButtons = Array.from(container.querySelectorAll("button")).filter(
      (element) => element.textContent?.includes("Disconnect"),
    );
    const confirmButton = confirmButtons[confirmButtons.length - 1] || null;
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(logout).toHaveBeenCalled();
    expect(deleteProvider).toHaveBeenCalledWith({ profileKey: "openrouter" });
  });
});
