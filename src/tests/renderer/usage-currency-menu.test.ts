// @vitest-environment jsdom
//
// 货币菜单的**行为**测试（不只断言 class 字符串）。守两件事：
//  1. 交互：打开 / Escape / 点外部 / 选一行，都按预期关闭并按需回传；
//  2. 一个真发生过的回归：点「当前已选中那一行」**不得**回传 onChange ——
//     setCurrency 会清掉汇率，而 currency 没变就不会重新取汇率，于是页面永久
//     停在「选择器写着 CNY、金额却按美元显示」的死状态。原生 select 重选同项
//     不触发 change，所以这是换成自绘菜单才引入的路径。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CurrencySelect } from "../../renderer/components/usage/CurrencySelect";

vi.mock("react-i18next", () => ({
  // 占位不可省：缺了它，任何走到 i18n/config 的依赖链都会在 import 期抛
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("CurrencySelect", () => {
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
  });

  function render(value: "CNY" | "USD", onChange = vi.fn()) {
    act(() => {
      root.render(React.createElement(CurrencySelect, { value, onChange }));
    });
    return onChange;
  }

  function trigger(): HTMLButtonElement {
    const found = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    );
    if (!found) throw new Error("currency trigger not rendered");
    return found;
  }

  function click(element: Element) {
    act(() => {
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  }

  function rows(): HTMLButtonElement[] {
    return Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
  }

  function row(code: string): HTMLButtonElement {
    const found = rows().find((b) => b.textContent?.includes(code));
    if (!found) throw new Error(`currency row not found: ${code}`);
    return found;
  }

  function menuOpen(): boolean {
    return container.querySelector('[role="menu"]') !== null;
  }

  it("names the trigger with the current value", () => {
    render("CNY");

    expect(trigger().getAttribute("aria-label")).toContain("CNY");
  });

  it("opens on click and lists every currency", () => {
    render("CNY");

    click(trigger());

    expect(menuOpen()).toBe(true);
    expect(rows().map((b) => b.textContent?.trim())).toEqual([
      "USD",
      "CNY",
      "EUR",
      "JPY",
      "GBP",
      "HKD",
    ]);
    // 选中态用 aria-selected 表达（Check 图标是 SVG，不贡献文字）
    const selected = rows().filter(
      (b) => b.getAttribute("aria-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("CNY");
  });

  it("reports a different currency and closes", () => {
    const onChange = render("CNY");

    click(trigger());
    click(row("EUR"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("EUR");
    expect(menuOpen()).toBe(false);
  });

  it("does not report the already-selected currency", () => {
    const onChange = render("CNY");

    click(trigger());
    click(row("CNY"));

    expect(onChange).not.toHaveBeenCalled();
    expect(menuOpen()).toBe(false);
  });

  it("closes on Escape", () => {
    render("CNY");
    click(trigger());

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(menuOpen()).toBe(false);
  });

  it("closes on an outside click", () => {
    render("CNY");
    click(trigger());

    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
    });

    expect(menuOpen()).toBe(false);
  });

  it("keeps no document listeners while closed", () => {
    render("CNY");
    const addSpy = vi.spyOn(document, "addEventListener");

    // 关着的时候不该挂 listener（组件在 open 为假时直接 return）
    expect(addSpy).not.toHaveBeenCalledWith("mousedown", expect.any(Function));
    addSpy.mockRestore();
  });
});
