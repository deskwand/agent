// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StatusPopover,
  type StatusPopoverProps,
} from "../../renderer/components/StatusPopover";
import type { ContextStatusDetails } from "../../renderer/components/ChatInputBottomBar";

vi.mock("react-i18next", () => ({
  // StatusPopover 会间接 import 到 src/renderer/utils/i18n-format → src/renderer/i18n/config，
  // 那里调用 `i18n.use(initReactI18next)`。整模块 mock 必须补上这个插件占位，
  // 否则 i18n config 在 import 期就报 `No "initReactI18next" export is defined`。
  initReactI18next: { type: "3rdParty", init: () => {} },
  // 保留 key 便于断言「哪条文案被渲染」，同时把插值参数一并带出来 ——
  // 否则 `t("statusPopover.cacheHitRate", { rate })` 只会得到 key，
  // 「缓存命中率 91.3%」这类断言永远看不到真实数值。
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${Object.values(params).join(" ")}` : key,
  }),
}));

const details: ContextStatusDetails = {
  usedLabel: "87.2K",
  totalLabel: "258K",
  cacheHitRate: "91.3%",
};

describe("StatusPopover", () => {
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

  function render(props: Partial<StatusPopoverProps> = {}) {
    act(() => {
      root.render(
        React.createElement(StatusPopover, {
          contextUsagePercentage: 34,
          contextRingColorClass: "text-accent",
          contextStatusDetails: details,
          ...props,
        }),
      );
    });
  }

  function trigger(): HTMLButtonElement {
    return container.querySelector("button")!;
  }

  function dialog(): HTMLElement | null {
    return container.querySelector('[role="dialog"]');
  }

  it("默认不渲染面板，点击后渲染", () => {
    render();
    expect(dialog()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    act(() => trigger().click());

    expect(dialog()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("面板显示百分比与绝对 token 数", () => {
    render();
    act(() => trigger().click());

    const panel = dialog()!;
    expect(panel.textContent).toContain("34%");
    expect(panel.textContent).toContain("87.2K");
    expect(panel.textContent).toContain("258K");
  });

  it("有缓存命中率时渲染脚注", () => {
    render();
    act(() => trigger().click());

    expect(dialog()!.textContent).toContain("statusPopover.cacheHitRate");
    expect(dialog()!.textContent).toContain("91.3%");
  });

  it("缓存命中率为 -- 时整条脚注不渲染", () => {
    render({ contextStatusDetails: { ...details, cacheHitRate: "--" } });
    act(() => trigger().click());

    expect(dialog()!.textContent).not.toContain("statusPopover.cacheHitRate");
  });

  it("Escape 关闭面板", () => {
    render();
    act(() => trigger().click());
    expect(dialog()).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(dialog()).toBeNull();
  });

  it("点击面板外部关闭面板", () => {
    render();
    act(() => trigger().click());

    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(dialog()).toBeNull();
  });

  const quota = {
    providerId: "openai-codex",
    providerName: "OpenAI Codex",
    planName: "team",
    windows: [
      { kind: "session" as const, usedPercent: 0, resetsAt: 1789759179000 },
      { kind: "weekly" as const, usedPercent: 51, resetsAt: 1789903190000 },
    ],
  };

  function stubQuotaList(result: unknown, reject = false) {
    const list = reject
      ? vi.fn(async () => {
          throw new Error("ipc down");
        })
      : vi.fn(async () => result);
    // jsdom 里 window === globalThis，stubGlobal 就等价于挂到 window 上；
    // 回收靠本文件 afterEach 里的 vi.unstubAllGlobals()。
    vi.stubGlobal("electronAPI", { quota: { list } });
    return list;
  }

  it("有快照时渲染 provider 标签行、两条窗口与重置行", async () => {
    stubQuotaList([quota]);
    render();
    act(() => trigger().click());

    await act(async () => {});

    const text = dialog()!.textContent!;
    expect(text).toContain("OpenAI Codex");
    expect(text).toContain("team");
    expect(text).toContain("statusPopover.windowSession");
    expect(text).toContain("statusPopover.windowWeekly");
    expect(text).toContain("statusPopover.resetAt");
    expect(text).toContain("51%");
  });

  it("只有一条窗口时只渲染一条", async () => {
    stubQuotaList([{ ...quota, windows: [quota.windows[0]] }]);
    render();
    act(() => trigger().click());
    await act(async () => {});

    const text = dialog()!.textContent!;
    expect(text).toContain("statusPopover.windowSession");
    expect(text).not.toContain("statusPopover.windowWeekly");
  });

  it("没有 planName 时标签行只显示 provider 名", async () => {
    stubQuotaList([{ ...quota, planName: undefined }]);
    render();
    act(() => trigger().click());
    await act(async () => {});

    const text = dialog()!.textContent!;
    expect(text).toContain("OpenAI Codex");
    expect(text).not.toContain("undefined");
  });

  it("空数组时不渲染额度块，而请求确实发出去了", async () => {
    const list = stubQuotaList([]);
    render();
    act(() => trigger().click());
    await act(async () => {});

    const text = dialog()!.textContent!;
    expect(list).toHaveBeenCalledTimes(1);
    expect(text).not.toContain("OpenAI Codex");
    expect(text).toContain("statusPopover.context");
  });

  it("IPC reject 时静默降级", async () => {
    stubQuotaList([], true);
    render();
    act(() => trigger().click());

    await act(async () => {});

    expect(dialog()!.textContent).not.toContain("OpenAI Codex");
  });

  it("打开面板即请求，不依赖任何 prop（非 OAuth 会话也必须查）", async () => {
    const list = stubQuotaList([quota]);
    // helper 会注入三个必填 prop，但不注入任何通道信息：
    // 面板不该因为「当前通道不是 OAuth」而不请求。
    render();
    act(() => trigger().click());
    await act(async () => {});

    expect(list).toHaveBeenCalledTimes(1);
  });

  it("两条快照时渲染两个 provider 标签行", async () => {
    stubQuotaList([
      quota,
      {
        providerId: "anthropic",
        providerName: "Anthropic",
        planName: "max",
        windows: [
          {
            kind: "session" as const,
            usedPercent: 12,
            resetsAt: 1789761912000,
          },
        ],
      },
    ]);
    render();
    act(() => trigger().click());
    await act(async () => {});

    const text = dialog()!.textContent!;
    expect(text).toContain("OpenAI Codex");
    expect(text).toContain("Anthropic");
  });

  it("windows 为空数组的快照不渲染该块", async () => {
    stubQuotaList([{ ...quota, windows: [] }]);
    render();
    act(() => trigger().click());
    await act(async () => {});

    const text = dialog()!.textContent!;
    expect(text).not.toContain("OpenAI Codex");
    expect(text).toContain("statusPopover.context");
  });

  it("不再有可见气泡：focus 按钮后仍无 role=tooltip", async () => {
    render();

    await act(async () => trigger().focus());

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    // 可访问名称不能跟着气泡一起丢
    expect(trigger().getAttribute("aria-label")).toBe(
      "statusPopover.ringTooltip",
    );
  });

  it("只保留轨道与进度弧两层，刻度层已删除", () => {
    render();

    const svg = container.querySelector("svg")!;
    expect(svg.querySelectorAll("circle")).toHaveLength(2);
  });

  it("触发按钮用与 chip 同族的 36px 槽位，并有可访问名称", () => {
    render();

    const button = trigger();
    expect(button.className).toContain("w-9");
    expect(button.className).toContain("h-9");
    expect(button.getAttribute("aria-label")).toBe("statusPopover.ringTooltip");
  });

  it("展开时按钮保持按下背景", () => {
    render();
    act(() => trigger().click());

    // 按空白切分成 token 再断言：className 字符串包含的话，关闭态的
    // `hover:bg-surface-hover` 也会让 toContain 通过，那条断言永远不会失败。
    expect(trigger().className.split(/\s+/)).toContain("bg-surface-hover");
  });
});
