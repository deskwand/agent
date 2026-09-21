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
});
