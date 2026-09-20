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
    // 挂载预取 1 次 + 打开刷新 1 次
    expect(list).toHaveBeenCalledTimes(2);
    expect(text).not.toContain("OpenAI Codex");
    expect(text).toContain("statusPopover.context");
  });

  it("首次就 IPC reject：不崩、不显示额度块（只证明这一类失败）", async () => {
    // ⚠️ 业务级失败（500 / 超时 / 非 JSON）不走 reject：它们在主进程被吞成空数组，
    // 由聚合层的失败回落（D）处理，见 quota-service.test.ts 的「失败回落」那组用例。
    // 也注意这里 `not.toContain` 是**弱**断言：挂载预取同样 reject，quota 从未被填过，
    // 所以它实际证明的是「不崩 + 不出现假数据」。保留值：首次失败 → 不渲染额度块。
    stubQuotaList([], true);
    render();
    act(() => trigger().click());

    await act(async () => {});

    const text = dialog()!.textContent!;
    expect(text).toContain("statusPopover.context"); // 上下文块仍在（面板没崩）
    expect(text).not.toContain("OpenAI Codex");
  });

  it("挂载即预取，打开时再刷新一次（不依赖任何 prop）", async () => {
    const list = stubQuotaList([quota]);
    // helper 会注入三个必填 prop，但不注入任何通道信息：
    // 面板不该因为「当前通道不是 OAuth」而不请求。
    render();
    // 挂载的那一次就是预取：实测冷请求 ~1s，必须提前到用户点击之前
    await act(async () => {});
    expect(list).toHaveBeenCalledTimes(1);

    act(() => trigger().click());
    await act(async () => {});
    expect(list).toHaveBeenCalledTimes(2);
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

  it("关闭不触发刷新", async () => {
    const list = stubQuotaList([quota]);
    render();
    await act(async () => {});

    act(() => trigger().click()); // 打开
    await act(async () => {});
    act(() => trigger().click()); // 关闭
    await act(async () => {});

    expect(list).toHaveBeenCalledTimes(2); // 挂载 1 + 打开 1，关闭不增加
  });

  it("保留上次结果：第二次打开的首帧就有额度块（不先空再出现）", async () => {
    stubQuotaList([quota]);
    render();
    // 先冲刷挂载预取：不冲刷的话「首帧」在正确实现下也是空的，断言就没有区分力
    await act(async () => {});

    act(() => trigger().click());
    await act(async () => {});
    expect(dialog()!.textContent).toContain("OpenAI Codex");

    act(() => trigger().click()); // 关闭
    await act(async () => {});
    act(() => trigger().click()); // 再打开：这一帧就应含额度块
    expect(dialog()!.textContent).toContain("OpenAI Codex");
  });

  it("IPC reject 时保留已有额度块（渲染层真正可观察的那一半）", async () => {
    let shouldReject = false;
    const list = vi.fn(async () => {
      if (shouldReject) throw new Error("ipc down");
      return [quota];
    });
    vi.stubGlobal("electronAPI", { quota: { list } });

    render();
    act(() => trigger().click());
    await act(async () => {});
    expect(dialog()!.textContent).toContain("OpenAI Codex");

    shouldReject = true;
    act(() => trigger().click()); // 关闭
    await act(async () => {});
    act(() => trigger().click()); // 再打开
    await act(async () => {});

    expect(dialog()!.textContent).toContain("OpenAI Codex"); // 保留，而不是清空
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

  it("面板外壳复用浮层共享 token，并带入场动画", () => {
    render();
    act(() => trigger().click());

    const panel = dialog()!;
    // 逐 token 用 classList 断言，不用字符串 includes ——
    // `hover:bg-surface-hover` 那类子串会让 toContain 变成恒真。
    expect(panel.classList.contains("animate-menu-in-up")).toBe(true);
    expect(panel.classList.contains("border-border-subtle")).toBe(true);
    expect(panel.classList.contains("shadow-elevated")).toBe(true);
    expect(panel.classList.contains("z-30")).toBe(true);

    // 旧内联外壳的两个特征必须消失
    expect(panel.classList.contains("shadow-soft")).toBe(false);
    expect(panel.classList.contains("border-border")).toBe(false);

    // 「丢能力」那一侧：外壳常量不含内边距（`menu-styles.ts:11` 的注释），
    // 本面板靠自己的 `p-3`。若将来被换成 `MENU_PANEL_PADDED_CLASS`（`p-1`），
    // 上面 6 条会全绿而内边距无声消失，且 `p-3`/`p-1` 谁生效取决于 Tailwind 输出顺序。
    expect(panel.classList.contains("p-3")).toBe(true);
    expect(panel.classList.contains("p-1")).toBe(false);

    // 面板内部 3 处分隔线也必须用 `border-border-subtle`（本次一并对齐的部分）。
    // 属性选择器 `[class~="..."]` 匹配完整 token，不会误伤 `border-border-subtle`。
    // 面板是只读状态面板、内部没有表单类元素，所以不存在需要 `border-border` 的子元素；
    // 将来若真需要，改成更精确的选择器，而不是放宽这一条。
    expect(panel.querySelectorAll('[class~="border-border"]')).toHaveLength(0);
  });
});
