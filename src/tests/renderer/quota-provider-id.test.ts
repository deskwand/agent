// @vitest-environment jsdom
//
// 这个文件只守一个点：底栏必须把会话的 profile key（"oauth:openai-codex"）
// 换算成适配器表的键（"openai-codex"）之后再查额度。
//
// 设计文档 §7.2.1 点名的静默失效：直接透传 profile key → 适配器表永远 miss →
// 降级成「Codex 会话也没有额度块」，且没有任何报错线索。组件测试如果只直接注入
// providerId，这条回归会完全静默，所以这里从底栏真实入口点进去。

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
  activeProviderProfileKey: "oauth:openai-codex" as never,
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
};

const quota = {
  providerId: "openai-codex",
  providerName: "OpenAI Codex",
  planName: "team",
  windows: [
    { kind: "session" as const, usedPercent: 10, resetsAt: 1789761912000 },
  ],
};

describe("底栏的 providerId 推导", () => {
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

  /** 模拟 main 侧适配器表：只有 openai-codex 有数据，其余通道返回 null。 */
  function stubQuota() {
    const get = vi.fn(async (providerId: string) =>
      providerId === "openai-codex" ? quota : null,
    );
    vi.stubGlobal("electronAPI", { quota: { get } });
    return get;
  }

  function render(props: Partial<ChatInputBottomBarProps> = {}) {
    act(() => {
      root.render(
        React.createElement(ChatInputBottomBar, { ...baseProps, ...props }),
      );
    });
  }

  /** 底栏里唯一的 aria-haspopup="dialog" 就是圆环触发按钮。 */
  function trigger(): HTMLButtonElement {
    return container.querySelector('button[aria-haspopup="dialog"]')!;
  }

  it("oauth:openai-codex → 用裸 providerId 查额度并渲染额度块", async () => {
    const get = stubQuota();
    render();
    act(() => trigger().click());
    await act(async () => {});

    expect(get).toHaveBeenCalledWith("openai-codex");
    expect(container.textContent).toContain("OpenAI Codex");
  });

  it("非 OAuth profile 不查额度，面板只剩上下文", async () => {
    const get = stubQuota();
    render({ activeProviderProfileKey: "openrouter" as never });
    act(() => trigger().click());
    await act(async () => {});

    expect(get).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("OpenAI Codex");
    expect(container.textContent).toContain("statusPopover.context");
  });

  it("OAuth 但无适配器的通道不查额度（v1 的 Claude / Copilot）", async () => {
    const get = stubQuota();
    render({ activeProviderProfileKey: "oauth:anthropic" as never });
    act(() => trigger().click());
    await act(async () => {});

    // providerId 会带上去（"anthropic"），但 main 侧适配器表没有它 → 返回 null →
    // 渲染层静默不显示额度块。这里断言的是「不会把 Codex 的数据错配到它头上」。
    expect(get).toHaveBeenCalledWith("anthropic");
    expect(container.textContent).not.toContain("OpenAI Codex");
  });
});
