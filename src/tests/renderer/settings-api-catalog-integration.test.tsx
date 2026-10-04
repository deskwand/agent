// @vitest-environment jsdom
import fs from "node:fs";
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
    themePreset: "graphite",
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

const configuredOpenrouter = buildConfig({
  isConfigured: true,
  providers: {
    openrouter: {
      provider: "openrouter",
      customProtocol: "anthropic",
      apiKey: "sk-or-v1-test",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "openrouter/free",
      models: [{ id: "openrouter/free", label: "Free", source: "preset" }],
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  },
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("SettingsAPI catalog integration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
    useAppStore.setState({
      appConfig: configuredOpenrouter,
      isConfigured: true,
    });
    window.electronAPI = {
      config: {
        get: vi.fn(async () => configuredOpenrouter),
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        saveProvider: vi.fn(async () => ({
          success: true,
          config: configuredOpenrouter,
        })),
        setActiveProvider: vi.fn(async () => ({
          success: true,
          config: configuredOpenrouter,
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

  const render = async () => {
    await act(async () => {
      root.render(React.createElement(SettingsAPI, {}));
    });
    await flush();
  };

  const clickEntry = async (entryKey: string) => {
    const tile = container.querySelector(`[data-catalog-entry="${entryKey}"]`);
    expect(tile, `tile ${entryKey}`).not.toBeNull();
    await act(async () => {
      tile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
  };

  it("只有主模型子 tab 吃宽栏，其余三个表单子 tab 保持 720", () => {
    // 外壳对 api tab 不封顶，宽度由 SettingsAPI 按子 tab 各自封：
    // 主模型是目录网格（1080），视觉/搜索/轻量是表单（720）。
    // 谁把这条改成一致，就会让两个表单页出现一米宽的输入框。
    const source = fs.readFileSync(
      "src/renderer/components/settings/SettingsAPI.tsx",
      "utf8",
    );
    expect(source.match(/max-w-\[1080px\]/g)?.length).toBe(1);
    expect(source.match(/max-w-\[720px\]/g)?.length).toBe(3);
  });

  it("oauth 行渲染真品牌图标，不是 Server 占位图", async () => {
    const codexConfig = buildConfig({
      isConfigured: true,
      providers: {
        "oauth:openai-codex": {
          provider: "oauth",
          customProtocol: "anthropic",
          name: "OpenAI Codex",
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
    useAppStore.setState({ appConfig: codexConfig, isConfigured: true });
    (
      window.electronAPI.config.get as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(codexConfig);
    (
      window.electronAPI.auth.status as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ loggedIn: true, providerName: "OpenAI Codex" });

    await render();

    const row = container.querySelector(
      '[data-testid="configured-provider-oauth:openai-codex"]',
    );
    expect(row).not.toBeNull();
    // 品牌图标用 fill-<品牌色> 上色；lucide 的 Server 兜底是 stroke + fill="none"
    const icon = row?.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("fill-[");
  });

  it("已登录的订阅瓦片能走到断开确认框（登出保底出口）", async () => {
    (
      window.electronAPI.openrouterAuth.status as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue({ loggedIn: true, providerName: "OpenRouter" });

    await render();
    const tile = container.querySelector(
      '[data-testid="openrouter-oauth-connect"]',
    ) as HTMLButtonElement;
    expect(tile).not.toBeNull();
    expect(tile.disabled).toBe(false);

    await clickEntry("oauth:openrouter");

    // 确认框出现，且带真正会登出的那个按钮
    expect(container.textContent).toContain("Disconnect");
    const confirm = Array.from(container.querySelectorAll("button"))
      .filter((b) => b.textContent?.trim() === "Disconnect")
      .at(-1);
    expect(confirm).toBeTruthy();
  });

  it("点订阅套餐瓦片打开套餐弹窗（接线，不是组件单测）", async () => {
    await render();
    expect(
      container.querySelector(
        '[data-testid="custom:subscription-bailian-coding-card"]',
      ),
    ).toBeNull();

    await clickEntry("plan:custom:subscription-bailian-coding");

    expect(
      container.querySelector(
        '[data-testid="custom:subscription-bailian-coding-card"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="custom:subscription-ark-coding-card"]',
      ),
    ).not.toBeNull();
  });

  it("点已配置的供应商瓦片进编辑器，并带上已配置角标", async () => {
    await render();
    const tile = container.querySelector(
      '[data-catalog-entry="provider:openrouter"]',
    );
    expect(tile?.getAttribute("aria-label")).toBe("OpenRouter — Configured");

    await clickEntry("provider:openrouter");

    // 编辑器弹窗打开：出现 API Key 输入框
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.textContent).toContain("OpenRouter");
  });

  it("点未配置的供应商瓦片也进编辑器", async () => {
    await render();
    await clickEntry("provider:deepseek");
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it("Coding Plan 配好之后也能拿到已配置角标", async () => {
    const planConfig = buildConfig({
      isConfigured: true,
      providers: {
        "custom:subscription-bailian-coding": {
          provider: "custom",
          customProtocol: "openai",
          name: "百炼 Coding Plan",
          apiKey: "sk-sp-test",
          baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
          defaultModel: "qwen3.7-plus",
          models: [
            { id: "qwen3.7-plus", label: "qwen3.7-plus", source: "preset" },
          ],
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });
    // SettingsAPI 走 IPC 读配置（不是直接读 store），所以两条都要给
    useAppStore.setState({ appConfig: planConfig, isConfigured: true });
    (
      window.electronAPI.config.get as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(planConfig);

    await render();
    const tile = container.querySelector(
      '[data-catalog-entry="plan:custom:subscription-bailian-coding"]',
    );
    expect(tile?.getAttribute("aria-label")).toBe(
      "百炼 Coding Plan — Configured",
    );
  });
});
