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

  /** 目录页在「添加供应商」后面，第一次点瓦片前先推入目录。 */
  const ensureCatalog = async () => {
    if (container.querySelector("[data-catalog-entry]")) return;
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="provider-list-add"]')
        ?.click();
    });
    await flush();
  };

  const clickEntry = async (entryKey: string) => {
    await ensureCatalog();
    const tile = container.querySelector(`[data-catalog-entry="${entryKey}"]`);
    expect(tile, `tile ${entryKey}`).not.toBeNull();
    await act(async () => {
      tile?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
  };

  /**
   * API 编辑弹窗外壳迁到 shadcn Dialog 后经 portal 挂到 document.body，
   * 不再位于测试的 container 内：弹窗内查询收窄到当前 dialog；
   * 页面级节点（目录瓦片、已配置角标）仍查 container。
   */
  const editorDialog = (): HTMLElement => container;

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
    // 可点按钮铺满整行、本身没有子节点；图标是它的兄弟节点
    const icon = row?.parentElement?.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("fill-[");
  });

  it("已登录的订阅瓦片能走到断开确认框（登出保底出口）", async () => {
    (
      window.electronAPI.openrouterAuth.status as unknown as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue({ loggedIn: true, providerName: "OpenRouter" });

    await render();
    await ensureCatalog();
    const tile = container.querySelector(
      '[data-testid="openrouter-oauth-connect"]',
    ) as HTMLButtonElement;
    expect(tile).not.toBeNull();
    expect(tile.disabled).toBe(false);

    await clickEntry("oauth:openrouter");

    // 确认框经 portal 挂到 body，不在 container 内
    expect(document.body.textContent).toContain("Disconnect");
    const confirm = Array.from(document.body.querySelectorAll("button"))
      .filter((b) => b.textContent?.trim() === "Disconnect")
      .at(-1);
    expect(confirm).toBeTruthy();
  });

  it("每个订阅套餐瓦片各自进自己的凭证页，不共享同一个弹窗", async () => {
    await render();
    await clickEntry("plan:custom:subscription-bailian-coding");

    // 之前两个瓦片都打开同一个套餐弹窗、里面把两个套餐都渲染一遍
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="credential-api-key"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("百炼 Coding Plan");
    expect(container.textContent).not.toContain("火山方舟 Coding Plan");

    // 返回目录，点另一个套餐 → 换成它自己的页面
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="credential-cancel"]')
        ?.click();
    });
    await flush();
    await clickEntry("plan:custom:subscription-ark-coding");
    expect(container.textContent).toContain("火山方舟 Coding Plan");
    expect(container.textContent).not.toContain("百炼 Coding Plan");
  });

  it("已配置的订阅套餐出现在列表里，可以像别的供应商一样点开", async () => {
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
    (
      window.electronAPI.config.get as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(planConfig);
    useAppStore.setState({ appConfig: planConfig, isConfigured: true });

    await render();
    expect(
      container.querySelector(
        '[data-testid="configured-provider-custom:subscription-bailian-coding"]',
      ),
    ).not.toBeNull();
  });

  it("点已配置的供应商瓦片进编辑器，并带上已配置角标", async () => {
    await render();
    await ensureCatalog();
    const tile = container.querySelector(
      '[data-catalog-entry="provider:openrouter"]',
    );
    expect(tile?.getAttribute("aria-label")).toBe("OpenRouter — Configured");

    await clickEntry("provider:openrouter");

    // 详情页打开：凭证块里有 API Key 行（编辑态默认打码只读）
    expect(
      editorDialog().querySelector('[data-testid="credential-api-key"]'),
    ).not.toBeNull();
    expect(editorDialog().textContent).toContain("OpenRouter");
  });

  it("点未配置的供应商瓦片也进编辑器", async () => {
    await render();
    await clickEntry("provider:deepseek");
    expect(
      editorDialog().querySelector('[data-testid="credential-api-key"]'),
    ).not.toBeNull();
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
    await ensureCatalog();
    const tile = container.querySelector(
      '[data-catalog-entry="plan:custom:subscription-bailian-coding"]',
    );
    expect(tile?.getAttribute("aria-label")).toBe(
      "百炼 Coding Plan — Configured",
    );
  });
});
