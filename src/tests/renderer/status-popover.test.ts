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
    // Radix 经 Portal 挂在 document.body 的弹层节点，清掉以免跨用例污染
    document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
    vi.unstubAllGlobals();
  });

  function render(props: Partial<StatusPopoverProps> = {}) {
    act(() => {
      root.render(
        React.createElement(StatusPopover, {
          contextUsagePercentage: 34,
          contextRingColorClass: "text-primary",
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
    // 查 document.body 而不是 container：迁到 Radix 的 Popover 后内容经 Portal
    // 挂到 body 下（陷阱 3）。body 是 container 的超集，本文件 22 处调用一并受益。
    return document.body.querySelector('[role="dialog"]');
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

  it("把 token 速度放在缓存命中率的同一行", () => {
    render({
      contextStatusDetails: { ...details, tokenSpeedLabel: "38 tok/s" },
    });
    act(() => trigger().click());

    const panel = dialog()!;
    expect(panel.textContent).toContain("statusPopover.cacheHitRate");
    expect(panel.textContent).toContain("38 tok/s");
  });

  it("只有速度时不留分隔符", () => {
    render({
      contextStatusDetails: {
        ...details,
        cacheHitRate: "--",
        tokenSpeedLabel: "约 42 tok/s",
      },
    });
    act(() => trigger().click());

    const panel = dialog()!;
    expect(panel.textContent).not.toContain("statusPopover.cacheHitRate");
    expect(panel.textContent).toContain("约 42 tok/s");
    expect(panel.textContent).not.toContain("·");
  });

  it("两者都没有时整块脚注不渲染", () => {
    render({
      contextStatusDetails: { ...details, cacheHitRate: "--" },
    });
    act(() => trigger().click());

    const panel = dialog()!;
    expect(panel.textContent).not.toContain("tok/s");
    expect(panel.textContent).not.toContain("·");
  });

  it("缓存命中率为 -- 时整条脚注不渲染", () => {
    render({ contextStatusDetails: { ...details, cacheHitRate: "--" } });
    act(() => trigger().click());

    expect(dialog()!.textContent).not.toContain("statusPopover.cacheHitRate");
  });

  it("Escape 关闭面板", () => {
    // ⚠️ KeyboardEvent **必须**显式 cancelable: true —— 否则任何 preventDefault()
    // 都是空操作（真实浏览器里 Esc 是可取消的）。评审实测：给 PopoverContent 加
    // `onEscapeKeyDown={(e) => e.preventDefault()}` 后，缺这个字段会让本用例**照样绿**
    // → 「Esc 被压制」这种真实回归会无声溜过。计划自己列的陷阱 2 就是这条。
    render();
    act(() => trigger().click());
    expect(dialog()).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
      );
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
      { kind: "monthly" as const, usedPercent: 82, resetsAt: 1790000000000 },
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

  it("有快照时渲染 provider 标签行、各窗口与重置行", async () => {
    stubQuotaList([quota]);
    render();
    act(() => trigger().click());

    await act(async () => {});

    const text = dialog()!.textContent!;
    expect(text).toContain("OpenAI Codex");
    expect(text).toContain("team");
    expect(text).toContain("statusPopover.windowSession");
    expect(text).toContain("statusPopover.windowWeekly");
    expect(text).toContain("statusPopover.windowMonthly");
    expect(text).toContain("statusPopover.resetAt");
    expect(text).toContain("51%");
  });

  it("只有月度窗口时用月度文案，而不是退化成 7d", async () => {
    stubQuotaList([{ ...quota, windows: [quota.windows[2]] }]);
    render();
    act(() => trigger().click());
    await act(async () => {});

    const text = dialog()!.textContent!;
    expect(text).toContain("statusPopover.windowMonthly");
    expect(text).not.toContain("statusPopover.windowWeekly");
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

  // 迁移回归守卫（与活动 chip 同族的迁移回归）：环自己写的 `w-5 h-5`（20px）会被
  // `<Button>` base 的 `[&_svg]:size-4` 顶掉 —— 选择器 `.cls svg` 特指度 0,1,1 > `.h-5` 的 0,1,0。
  // Chromium + 构建 CSS 实测 16px，写回后 20px == 迁移前的原生 `<button>`（`67889f23^`）。
  // 这个触发器里只有环一个 svg，所以 `size-5` 不会误伤别处。
  // ⚠️ jsdom 没有布局引擎 ⇒ 这一条钉的是类名，几何归真机。
  it("环的尺寸不被 Button 的 base 顶掉", () => {
    render();

    // 按空白切分成 token 再断言：`className.toContain` 在本文件已经被证明会误报
    // （关闭态的 `hover:bg-accent` 也会让 toContain 通过）。
    const tokens = trigger().className.split(/\s+/);
    expect(tokens).toContain("[&_svg]:size-5");
    expect(tokens).not.toContain("[&_svg]:size-4");
  });

  it("展开时按钮保持按下背景", () => {
    render();
    act(() => trigger().click());

    // 按空白切分成 token 再断言：className 字符串包含的话，关闭态的
    // `hover:bg-accent` 也会让 toContain 通过，那条断言永远不会失败。
    expect(trigger().className.split(/\s+/)).toContain("bg-accent");
  });

  it("面板外壳复用浮层共享 token，并带入场动画", () => {
    render();
    act(() => trigger().click());

    const panel = dialog()!;
    // 逐 token 用 classList 断言，不用字符串 includes ——
    // `hover:bg-accent` 那类子串会让 toContain 变成恒真。
    //
    // ⚠️ 载体换了：原来这 4 个类来自 MENU_PANEL_CLASS，现在面板是 vendored 的
    // PopoverContent —— 它的外壳契约是 data-[state=open]:animate-in（入场动画）
    // 与 bg-popover（实色底），而不是本仓的 shadow-elevated / border-border/40。
    // 约束（面板要有入场动画、不能用回退的阴影/边框）没变，载体变了。
    expect(panel.classList.contains("data-[state=open]:animate-in")).toBe(true);
    expect(panel.classList.contains("bg-popover")).toBe(true);

    // 旧内联外壳的两个特征必须消失
    expect(panel.classList.contains("shadow-soft")).toBe(false);
    expect(panel.classList.contains("border-border")).toBe(false);

    // 「丢能力」那一侧：外壳常量不含内边距（`menu-styles.ts:11` 的注释），
    // 本面板靠自己的 `p-3`。若将来被换成 `MENU_PANEL_PADDED_CLASS`（`p-1`），
    // 上面 6 条会全绿而内边距无声消失，且 `p-3`/`p-1` 谁生效取决于 Tailwind 输出顺序。
    expect(panel.classList.contains("p-3")).toBe(true);
    expect(panel.classList.contains("p-1")).toBe(false);

    // 面板内部 3 处分隔线也必须用 `border-border/40`（本次一并对齐的部分）。
    // 属性选择器 `[class~="..."]` 匹配完整 token，不会误伤 `border-border/40`。
    // 面板是只读状态面板、内部没有表单类元素，所以不存在需要 `border-border` 的子元素；
    // 将来若真需要，改成更精确的选择器，而不是放宽这一条。
    expect(panel.querySelectorAll('[class~="border-border"]')).toHaveLength(0);
  });

  it("打开后焦点仍在环形按钮上【Review Focus 1】", () => {
    // ⚠️ 这条同时是**证伪工具**：先不写 onOpenAutoFocus 跑它一次。
    //   红 → Radix 的 Popover 确实会把焦点移进内容 → 加 prop ✓ 此后本用例有牙齿；
    //   绿 → 不移焦 → **不要加那个 prop**（加了是投机代码，准则 2）。
    render();
    // ⚠️ 必须先**显式聚焦**：jsdom 的 `.click()` 不会把焦点给元素（真实浏览器会），
    // 不先聚焦的话这条测的是「从未聚焦」而不是「焦点被移走」—— 两个方向都会绿/红错。
    trigger().focus();
    expect(document.activeElement, "前置条件：焦点先要在按钮上").toBe(
      trigger(),
    );

    act(() => trigger().click());
    expect(document.activeElement, "焦点必须仍在环形按钮上").toBe(trigger());
  });

  it("面板仍是 role=dialog 且带 aria-label【Review Focus 2】", () => {
    // 迁移前旧实现就带了这两个 ✓ 它是**特征化用例**：迁移后必须仍绿。
    // role="dialog" 由 Radix 的 PopoverContent 提供（不手写），aria-label 必须显式传。
    render();
    act(() => trigger().click());
    const panel = dialog();
    expect(panel, "面板必须存在且是 dialog 角色").not.toBeNull();
    expect(panel!.getAttribute("aria-label"), "aria-label 不能丢").toBeTruthy();
  });

  it("点面板外部关闭（带正对照）【Review Focus 4】", async () => {
    // 原实现是手写 mousedown 监听，迁走后由 Radix 的 DismissableLayer 接管。
    render();
    act(() => trigger().click());
    // ⚠️ 必须让多轮微任务落地再派发：Radix 的 DismissableLayer 是在 **effect** 里
    // 注册 document 监听的，同一 tick 内派发时它还没装上 —— 症状是「点了没反应」，
    // 会被误判成「Radix 不支持外部点击」。计划 5 在菜单上踩过同一个坑。
    await act(async () => {});

    expect(dialog(), "正对照：面板必须确实开着").not.toBeNull();

    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      document.body.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(dialog(), "点面板外部应当关闭").toBeNull();
  });

  it("再点一次环形按钮关闭（切换权从手写 onClick 移到 Radix 的 Trigger）【评审 Important 2】", () => {
    // 原来按钮上是手写的 `onClick={() => setOpen(v => !v)}`，现在由 Radix 的
    // PopoverTrigger 管（onOpenToggle）。行为对是「构造使然」，但没有用例钉住它 ——
    // 而「点第二次还开着」（或反过来一直关）是这类迁移里很容易出现的回归。
    render();
    act(() => trigger().click());
    expect(dialog(), "第一次点击应当打开").not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");

    act(() => trigger().click());
    expect(dialog(), "第二次点击应当关闭").toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });
});
