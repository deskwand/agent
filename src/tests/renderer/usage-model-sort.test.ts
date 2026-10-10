// @vitest-environment jsdom
//
// 「按模型」表的排序**行为**测试（不是字符串断言）：喂一份成本序与输出序**故意不同**
// 的数据，点标题栏的「金额」后行序必须真的变。
//
// 为什么需要它：源码字符串断言挡不住"切换器渲染了、但表体还在用未排序的 rows"这类
// 断链（2026-09-21 有人就是这么怀疑它没生效的），只有真渲染 + 真点击才能锁住。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "zh" },
  }),
}));

/** A 输出最大但最便宜，C 输出最小但最贵 —— 两种口径的顺序必须不同 */
const snapshot = {
  totals: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    calls: 0,
    cost: 15,
    hitRate: null,
  },
  byDay: [],
  byHour: [],
  byModel: [row("A", 900, 1), row("B", 500, 5), row("C", 100, 9)],
};

function row(model: string, output: number, cost: number) {
  return {
    model,
    provider: "p",
    input: 0,
    output,
    cacheRead: 0,
    calls: 1,
    hitRate: null,
    cost,
  };
}

describe("by-model table sorting", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    const invoke = vi.fn(async (msg: { type: string }) =>
      msg.type === "usage.query" ? snapshot : { rates: null },
    );
    window.electronAPI = { invoke } as never;
    localStorage.setItem("deskwand.usageCurrency", "USD");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
  });

  /** 表体第一列（模型名 + provider）按显示顺序 */
  function modelsInOrder(): string[] {
    return Array.from(container.querySelectorAll("tbody tr"))
      .map((tr) => tr.querySelector("td")?.textContent?.trim() ?? "")
      .filter((text) => text && !text.startsWith("usage."));
  }

  function toggle(labelKey: string): HTMLButtonElement {
    const found = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === labelKey,
    );
    if (!found) throw new Error(`toggle not found: ${labelKey}`);
    return found as HTMLButtonElement;
  }

  it("starts in output order and reorders by cost after clicking 金额", async () => {
    const { UsageView } = await import("../../renderer/components/UsageView");
    await act(async () => {
      root.render(React.createElement(UsageView));
    });

    expect(modelsInOrder()).toEqual(["Ap", "Bp", "Cp"]);

    await act(async () => {
      toggle("usage.sort.cost").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(modelsInOrder()).toEqual(["Cp", "Bp", "Ap"]);

    await act(async () => {
      toggle("usage.sort.output").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(modelsInOrder()).toEqual(["Ap", "Bp", "Cp"]);
  });

  it("每行条形是收窄到 56px 的 progressbar，区间与值跟着数据走", async () => {
    const { UsageView } = await import("../../renderer/components/UsageView");
    await act(async () => {
      root.render(React.createElement(UsageView));
    });

    const bars = Array.from(
      container.querySelectorAll<HTMLElement>('[role="progressbar"]'),
    );
    // 三条数据行各一个；合计行没有条形
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      // ⚠️ 上游 ui/progress.tsx 的 Root 自带 `w-full`，靠 cn 合并 `w-14` 才收窄 ——
      // 合并失效时条形会撑满整列，这两行就是那个抓手（只断言 `toContain("w-14")` 不够：
      // 那时 class 里 **两个都有**，而生成顺序里 `.w-full` 在 `.w-14` 之后，它会赢）。
      expect(bar.className).toContain("w-14");
      expect(bar.className).not.toContain("w-full");
      expect(bar.getAttribute("aria-valuemax")).toBe("900");
      expect(bar.getAttribute("aria-valuenow")).not.toBeNull();
    }
    // 默认按输出排序 ⇒ 900 那行在最前，它的条形是满格
    expect(bars[0].getAttribute("aria-valuenow")).toBe("900");

    // 上游 TableRow 自带 hover:bg-muted/50（这是新增行为，可以接受），但合计行不是
    // 数据行，不该跟着亮 —— 它必须有 hover:bg-transparent，且**不能**再留着 hover:bg-muted/50
    // （只断言前者不够：合并失效时两个都在，而它会亮）。
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    const totalRow = rows[rows.length - 1] as HTMLElement;
    expect(totalRow.className).toContain("hover:bg-transparent");
    expect(totalRow.className).not.toContain("hover:bg-muted/50");
  });
});
