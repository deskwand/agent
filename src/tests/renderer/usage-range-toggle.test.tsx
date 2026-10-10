// @vitest-environment jsdom
//
// 用量页的**行为**回归网：换成 ToggleGroup 后，唯一能静默断掉的就是「点档位 → 重新查
// 用量」这条链路（旧实现是 onClick 直接 setRange）。所以这里真渲染 + 真点击 +
// 断言 IPC 的 payload，而不是断言源码里有没有 ToggleGroup。
//
// ⚠️ 第一个用例在替换前就该是绿的（那是基线）；第二个用例（radiogroup / testId）在替换前
// 应当是红的 —— 它正是这次替换要带来的东西。
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

const snapshot = {
  totals: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    calls: 0,
    cost: 0,
    hitRate: null,
  },
  byDay: [],
  byHour: [],
  byModel: [
    {
      model: "A",
      provider: "p",
      input: 0,
      output: 900,
      cacheRead: 0,
      calls: 1,
      hitRate: null,
      cost: 1,
    },
  ],
};

describe("用量页的区间档位", () => {
  let container: HTMLDivElement;
  let root: Root;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn(async (msg: { type: string }) =>
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

  /** 每次 usage.query 的 payload.range，按调用顺序 */
  const ranges = () =>
    invoke.mock.calls
      .filter(([msg]) => (msg as { type: string }).type === "usage.query")
      .map(([msg]) => (msg as { payload: { range: string } }).payload.range);

  async function render() {
    const { UsageView } = await import("../../renderer/components/UsageView");
    await act(async () => {
      root.render(React.createElement(UsageView));
    });
  }

  const rangeItem = (labelKey: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]')).find(
      (node) => node.textContent === labelKey,
    )!;

  it("点「7 天」后用新的 range 重新查用量", async () => {
    await render();
    expect(ranges()).toEqual(["1d"]);

    await act(async () => {
      rangeItem("usage.range.7d").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(ranges()).toEqual(["1d", "7d"]);
    expect(rangeItem("usage.range.7d").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("区间与排序都成了 radiogroup，面板标题仍是 h2", async () => {
    await render();
    expect(
      container
        .querySelector('[data-testid="usage-range"]')
        ?.getAttribute("role"),
    ).toBe("radiogroup");
    // 排序那处同款（不带 testId，所以按总数兜底；热力图配色那处也已成组）
    expect(
      container.querySelectorAll('[role="radiogroup"]').length,
    ).toBeGreaterThanOrEqual(3);
    // 面板标题继续是真 h2：CardTitle 是 div，换掉会白丢一层标题层级
    expect(
      Array.from(container.querySelectorAll("h2")).map((n) => n.textContent),
    ).toEqual(["usage.daily", "usage.hourly", "usage.byModel"]);
  });

  it("热力图配色档也是 radiogroup", async () => {
    await render();
    expect(
      container
        .querySelector('[data-testid="usage-color-mode"]')
        ?.getAttribute("role"),
    ).toBe("radiogroup");
  });
});
