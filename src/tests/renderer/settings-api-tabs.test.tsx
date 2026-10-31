// @vitest-environment jsdom
//
// SettingsAPI 顶部页签：手绘 <Button> + `activeTab === x` 条件类 → ui/tabs（Radix Tabs）。
//
// 迁移前四个按钮只有 onClick，没有 role=tablist/tab/tabpanel、没有 aria-selected、
// 没有方向键语义。这里锁的是原语接管后的**可访问行为**，以及「业务一条没变」：
//   - tablist / tab 唯一，aria-selected 与可见 tabpanel 一起跟着点击走
//   - 方向键只移焦点（activationMode="manual"），Enter 才激活 —— 与旧实现「点一下才切」一致
//   - 面板内容按当前值惰性挂载（不 forceMount）：切走后旧面板的子节点从 DOM 消失
//   - embedded 模式不渲染页签条，但主模型内容照常渲染（旧行为：embedded ⇒ 恒显示 main）
//   - 页签仍是原字符串 union，onValueChange 只把白名单里的值写回 state（源码守卫）
//
// fixture 与 settings-api-catalog-integration.test.tsx 同源：只 mock IPC，不 mock 原语。
import fs from "node:fs";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
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

const configured = buildConfig({
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

// Radix 的 roving focus 把焦点移动放在 setTimeout 里（focusFirst(candidateNodes)），
// 只 drain 微任务会在焦点落下前就断言 document.activeElement。
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("SettingsAPI 顶部页签（ui/tabs 语义）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAppStore.setState({ appConfig: configured, isConfigured: true });
    window.electronAPI = {
      config: {
        get: vi.fn(async () => configured),
        getPresets: vi.fn(async () => API_PROVIDER_PRESETS),
        saveProvider: vi.fn(async () => ({
          success: true,
          config: configured,
        })),
        setActiveProvider: vi.fn(async () => ({
          success: true,
          config: configured,
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

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  // SettingsAPI 的 props 是空接口（embedded 由 store 驱动）：直接把它传给 createElement
  // 会撞上 Attributes 重载（空接口与 Attributes 无公共成员），所以这里显式合并 Attributes。
  const render = async (
    props: React.ComponentProps<typeof SettingsAPI> = {},
  ): Promise<void> => {
    await act(async () => {
      root.render(React.createElement(SettingsAPI, props as React.Attributes));
    });
    for (let i = 0; i < 5; i += 1) await flush();
  };

  const LABELS = [
    i18n.t("api.mainModelTab"),
    i18n.t("api.visionModelTab"),
    i18n.t("api.searchModelTab"),
    i18n.t("api.utilityModelTab"),
  ];

  /** 每个页签内容区的「指纹文案」：切换后用它确认对应面板真的在 DOM 里。 */
  const MARKERS = [
    i18n.t("api.configuredListTitle"),
    i18n.t("api.visionModelTitle"),
    i18n.t("webAccess.groupTitle"),
    i18n.t("api.utilityModelTitle"),
  ];

  const tablist = (): Element[] =>
    Array.from(document.body.querySelectorAll('[role="tablist"]'));
  const tabs = (): HTMLElement[] =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[role="tab"]'));
  const panels = (): HTMLElement[] =>
    Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="tabpanel"]'),
    );
  const visiblePanels = (): HTMLElement[] =>
    panels().filter((panel) => !panel.hasAttribute("hidden"));
  const tabByLabel = (label: string): HTMLElement => {
    const tab = tabs().find((el) => (el.textContent ?? "").trim() === label);
    expect(tab, `页签「${label}」必须存在`).toBeTruthy();
    return tab!;
  };
  const selected = (): HTMLElement[] =>
    tabs().filter((el) => el.getAttribute("aria-selected") === "true");
  /** 当前可见面板必须由选中页签标出（aria-labelledby ↔ aria-controls 成对）。 */
  const panelOf = (tab: HTMLElement): HTMLElement => {
    const found = visiblePanels();
    expect(found, "同一时刻只有一个可见面板").toHaveLength(1);
    expect(found[0].getAttribute("aria-labelledby")).toBe(tab.id);
    expect(tab.getAttribute("aria-controls")).toBe(found[0].id);
    return found[0];
  };

  /** 真实指针路径：Radix 在 mousedown 上激活（并顺手 focus）。 */
  const pressTab = async (el: Element): Promise<void> => {
    await act(async () => {
      el.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
  };

  /** 只发 click（无 mousedown）：程序化 .click() 与既有用例走的就是这条。 */
  const clickOnly = async (el: Element): Promise<void> => {
    await act(async () => {
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
  };

  const pressKey = async (el: Element, key: string): Promise<void> => {
    await act(async () => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
    await flush();
  };

  it("唯一 tablist：四个 tab 顺序不变，默认选中主模型且只有它的面板可见", async () => {
    await render();

    expect(tablist(), "页签容器必须是唯一的 tablist").toHaveLength(1);
    expect(tabs().map((el) => (el.textContent ?? "").trim())).toEqual(LABELS);
    expect(selected()).toEqual([tabByLabel(LABELS[0])]);

    const main = tabByLabel(LABELS[0]);
    expect(panelOf(main).textContent).toContain(MARKERS[0]);
    // 惰性挂载：没选中的子视图不该在 DOM 里（不 forceMount）
    expect(document.body.textContent).not.toContain(MARKERS[1]);
    for (const panel of panels()) {
      if (panel !== visiblePanels()[0]) {
        expect(panel.textContent, "未选中面板不得挂载内容").toBe("");
      }
    }
  });

  it("点击每个页签：aria-selected 与可见面板一起走，旧面板内容卸载", async () => {
    await render();

    for (let i = 1; i < LABELS.length; i += 1) {
      const tab = tabByLabel(LABELS[i]);
      await pressTab(tab);

      expect(selected(), `点击「${LABELS[i]}」后它必须被选中`).toEqual([tab]);
      expect(panelOf(tab).textContent).toContain(MARKERS[i]);
      for (let j = 0; j < MARKERS.length; j += 1) {
        if (j === i) continue;
        // 只在**面板**范围内查：页签条上的 LABELS 本身就会命中同名文案
        // （如「Utility Model」既是页签名也是面板标题）。
        for (const panel of panels()) {
          expect(
            panel.textContent,
            `「${LABELS[i]}」选中时不得还在渲染「${LABELS[j]}」的面板`,
          ).not.toContain(MARKERS[j]);
        }
      }
    }

    await pressTab(tabByLabel(LABELS[0]));
    expect(selected()).toEqual([tabByLabel(LABELS[0])]);
    expect(panelOf(tabByLabel(LABELS[0])).textContent).toContain(MARKERS[0]);
  });

  it("程序化 click（无 mousedown）同样切换页签", async () => {
    await render();

    const vision = tabByLabel(LABELS[1]);
    await clickOnly(vision);
    expect(selected()).toEqual([vision]);
    expect(panelOf(vision).textContent).toContain(MARKERS[1]);
  });

  it("方向键只移焦点不激活（manual），Enter 才切换；Home/End 同语义", async () => {
    await render();

    const [main, vision, search, utility] = LABELS.map((label) =>
      tabByLabel(label),
    );
    // RovingFocusGroup：未聚焦时页签的 tabIndex 全是 -1，唯一 Tab 入口是 tablist 容器
    // （它把焦点转交给当前 tab stop），聚焦后才有一个页签变成 tab stop。
    expect(
      tabs().filter((el) => el.tabIndex === 0).length,
      "聚焦前页签没有 tab stop",
    ).toBe(0);
    expect(
      document.body.querySelector('[role="tablist"]')?.getAttribute("tabindex"),
      "容器的入口 tab stop",
    ).toBe("0");

    // focus() 会触发 onItemFocus → setCurrentTabStopId，必须让这轮 state 落地再断言
    await act(async () => {
      main.focus();
    });
    await flush();
    expect(document.activeElement).toBe(main);
    expect(
      tabs().filter((el) => el.tabIndex === 0),
      "roving tabindex：聚焦后只有一个页签可 Tab 达",
    ).toEqual([main]);

    await pressKey(main, "ArrowRight");
    expect(document.activeElement, "ArrowRight 把焦点移到下一个页签").toBe(
      vision,
    );
    expect(
      selected(),
      "manual 激活：只移焦点不得切换（否则会挂载/触发子视图）",
    ).toEqual([main]);

    await pressKey(vision, "ArrowRight");
    expect(document.activeElement).toBe(search);
    await pressKey(search, "ArrowRight");
    expect(document.activeElement).toBe(utility);
    await pressKey(utility, "ArrowRight");
    expect(document.activeElement, "末尾再按向右回到第一个").toBe(main);
    await pressKey(main, "ArrowLeft");
    expect(document.activeElement, "开头向左绕到最后一个").toBe(utility);

    await pressKey(utility, "Home");
    expect(document.activeElement).toBe(main);
    await pressKey(main, "End");
    expect(document.activeElement).toBe(utility);
    expect(selected(), "Home/End 也只移焦点").toEqual([main]);

    await pressKey(utility, "Enter");
    expect(selected(), "Enter 才激活当前焦点页签").toEqual([utility]);
    expect(panelOf(utility).textContent).toContain(MARKERS[3]);
  });

  it("embedded：不渲染 tablist/tab，主模型内容照常渲染", async () => {
    await render({ embedded: true });

    expect(tablist(), "嵌人态不得渲染页签条").toHaveLength(0);
    expect(tabs()).toHaveLength(0);
    // 嵌人态隐藏的是主模型的**标题块**，列表本体与「添加」入口照常渲染
    // （见 SettingsAPI 里 `embedded && configuredList` 的既有语义）。
    expect(document.body.textContent).toContain(i18n.t("api.addApi"));
    expect(document.body.textContent, "已配置列表本体必须在").toContain(
      "OpenRouter",
    );
    expect(document.body.textContent).not.toContain(MARKERS[1]);
    expect(visiblePanels(), "嵌人态只挂载主模型面板").toHaveLength(1);
  });

  it("onValueChange 只写回白名单值（源码守卫）", () => {
    const raw = fs.readFileSync(
      "src/renderer/components/settings/SettingsAPI.tsx",
      "utf8",
    );
    // 先剥注释：注释里会写到被禁的类名（本文件自己就解释过这条口径），
    // 不剥会把说明文字当成违规。
    const source = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // string → union 的收窄必须显式列出四个合法值，未知值 / 空串一律不写回
    expect(source).toMatch(
      /value === "main" \|\|[\s\S]{0,160}?value === "vision" \|\|[\s\S]{0,160}?value === "search" \|\|[\s\S]{0,160}?value === "utility"/,
    );
    expect(source, "不得用 unchecked cast 把任意 string 写回").not.toMatch(
      /setActiveTab\(value as /,
    );
    // 面板不得 forceMount：惰性挂载是既有语义
    expect(source).not.toMatch(/forceMount/);
    // 页签皮肤必须来自 ui/tabs.tsx（shadcn 默认），调用点不得再手写选中态皮肤：
    // 这正是「不要自己造」的守卫 —— 曾经这里是 border-b-2 + data-[state=active]:border-primary。
    expect(source, "不得再手写下划线指示条").not.toContain("border-b-2");
    expect(source, "不得再手写选中态边框/文字色").not.toMatch(
      /data-\[state=active\]:border-|data-\[state=active\]:text-primary-text/,
    );
    expect(source, "不得硬编码色值").not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
