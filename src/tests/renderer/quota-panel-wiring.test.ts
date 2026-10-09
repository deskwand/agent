// @vitest-environment jsdom
//
// 这个文件守的是**接线层**，不是面板内部：从底栏真实入口点圆环，确认额度块会出现。
//
// 为什么需要它：本次修的 bug（已登录的 Codex 额度在 deepseek 会话里不显示）根因就在
// 底栏/面板这一层的一道条件闸门（曾经的 `if (!open || !providerId) return;`）。
// `status-popover.test.ts` 直接渲染 StatusPopover，绕过了底栏——若有人在
// `ChatInputBottomBar` 处重新加条件渲染（或另一类闸门），那里的用例**全都不会红**。
// 之前唯一驱动这条链路的 `quota-provider-id.test.ts` 随「profile key → 适配器 id」
// 推导一起被删除，所以这里补回接线层的护栏。

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInputBottomBar,
  type ChatInputBottomBarProps,
} from "../../renderer/components/ChatInputBottomBar";
import type { ModelOptionGroup } from "../../renderer/components/ChatInputBottomBar";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const modelOptions: ModelOptionGroup[] = [
  {
    profileKey: "oauth:openai-codex" as never,
    groupLabel: "OpenAI Codex",
    items: [{ id: "gpt-5.6-luna", name: "gpt-5.6-luna" }],
  },
];

const baseProps: ChatInputBottomBarProps = {
  onAttach: () => {},
  onAddFiles: () => {},
  attachedKeys: new Set<string>(),
  model: "gpt-5.6-luna",
  modelOptions,
  activeProviderProfileKey: "openrouter" as never,
  onSelectModel: () => {},
  thinkingLevel: "medium",
  thinkingLevelOptions: ["off", "medium"],
  onSelectThinkingLevel: () => {},
  contextUsagePercentage: 10,
  contextRingColorClass: "text-accent",
  contextStatusDetails: {
    usedLabel: "26K",
    totalLabel: "258K",
    cacheHitRate: "--",
  },
  canStop: false,
  onStop: () => {},
  isSubmitting: false,
  hasInputContent: false,
  voice: {
    status: "idle",
    level: 0,
    seconds: 0,
    onToggle: () => {},
  },
};

const quota = [
  {
    providerId: "openai-codex",
    providerName: "OpenAI Codex",
    planName: "team",
    windows: [
      { kind: "session" as const, usedPercent: 10, resetsAt: 1789761912000 },
    ],
  },
];

describe("底栏到额度块的接线", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function stubQuotaList(result: unknown) {
    const list = vi.fn(async () => result);
    vi.stubGlobal("electronAPI", { quota: { list } });
    return list;
  }

  function render(props: Partial<ChatInputBottomBarProps> = {}) {
    act(() => {
      root.render(
        React.createElement(ChatInputBottomBar, { ...baseProps, ...props }),
      );
    });
  }

  /**
   * 圆环触发按钮 —— **按它自己的 aria-label 精确取** ✓，**不靠「唯一性」** ✗。
   *
   * ⚠️ 2026-10-09：这里原来是 `querySelector('button[aria-haspopup="dialog"]')` ✓，
   * 靠「底栏里只有一颗」这个假设 ✗。而 `MergedInputChip` 与 `StatusPopover` 都迁到
   * Radix 后，**两颗触发器自己都会带 `aria-haspopup="dialog"`**（Radix 的 Trigger 给的 ✓）
   * ⇒ 那个选择器会命中 **模型+思考 chip** ✗，于是点开的是**模型面板**、
   * 「打开刷新额度」自然不发生 ✓✓（症状是 `list` 只被调 1 次 ✗）。
   * ⇒ 契约变了，所以这里**显式断言「现在有两颗」** ✓ —— 下次再有人加一颗，
   * 这条会先红 ✓，而不是**静默点错元素** ✗。
   */
  function trigger(): HTMLButtonElement {
    const dialogTriggers = container.querySelectorAll(
      'button[aria-haspopup="dialog"]',
    );
    expect(
      dialogTriggers.length,
      "底栏的 dialog 触发器数量（迁移后是 2：模型 chip + 额度圆环）",
    ).toBe(2);
    // 本文件的 `react-i18next` mock 让 `t` 原样返回 key ✓（见文件顶部 ✓）
    // ⇒ 圆环的 `aria-label` 就是字面量 `"statusPopover.ringTooltip"` ✓。
    const ring = container.querySelector<HTMLButtonElement>(
      'button[aria-label="statusPopover.ringTooltip"]',
    );
    expect(ring, "圆环触发器必须按 aria-label 找得到").toBeTruthy();
    return ring!;
  }

  it("非 OAuth 会话（openrouter）里打开面板，仍能查到并显示已登录订阅的额度", async () => {
    const list = stubQuotaList(quota);
    render({ activeProviderProfileKey: "openrouter" as never });
    act(() => trigger().click());
    await act(async () => {});
    // ⚠️ 2026-10-09：`ChatInputStatusBar` 的面板已迁到 Radix `Popover` ✗ ⇒
    // 面板经 portal 挂 body ✓，且 Radix 的 `Presence` **延后一帧**挂载 ✓
    // ⇒ 只冲微任务不够 ✗（打开刷新的 effect 挂在「面板已挂载」之后 ✓）——
    // 必须**推一个宏任务** ✓（`curie` 在 `chat-input-status-bar.test.ts` 上实测过同一件事 ✓）。
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 挂载预取 1 次 + 打开刷新 1 次
    expect(list).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("OpenAI Codex");
  });

  it("OAuth 会话里同样可以（防止另一个方向的回归）", async () => {
    const list = stubQuotaList(quota);
    render({ activeProviderProfileKey: "oauth:openai-codex" as never });
    act(() => trigger().click());
    await act(async () => {});
    // ⚠️ 2026-10-09：`ChatInputStatusBar` 的面板已迁到 Radix `Popover` ✗ ⇒
    // 面板经 portal 挂 body ✓，且 Radix 的 `Presence` **延后一帧**挂载 ✓
    // ⇒ 只冲微任务不够 ✗（打开刷新的 effect 挂在「面板已挂载」之后 ✓）——
    // 必须**推一个宏任务** ✓（`curie` 在 `chat-input-status-bar.test.ts` 上实测过同一件事 ✓）。
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 挂载预取 1 次 + 打开刷新 1 次
    expect(list).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("OpenAI Codex");
  });
});
