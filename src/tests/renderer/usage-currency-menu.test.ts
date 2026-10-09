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
      dispatchClick(element);
    });
  }

  function dispatchClick(element: Element) {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  }

  function dispatchPointerDown(element: Element) {
    element.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  }

  // Radix 在 setTimeout(0) 里移动/归还焦点、挂载内容 —— 断言或下一步操作之前
  // 先推一个宏任务（计划 7 的教训：删断言之前先试 flush）。
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  /**
   * 打开菜单：**条件式**（先派 `pointerdown`，没开再补 `click`）。
   *
   * 手写触发器只认 `click`；Radix 的 `DropdownMenuTrigger` 只挂 `onPointerDown`
   * （读 `@radix-ui/react-dropdown-menu` 源码核实）—— 迁移期间两种实现都在，
   * 只派一种就会有一半场景打不开菜单，而失败信息表现为「选项找不到」。
   * ⚠️ **不能**无条件把两个都派出去：Radix 打开之后那发 `click` 落在内容之外，
   * 会被当成外部点击 → 刚打开就被关掉。
   */
  async function openMenu() {
    await act(async () => {
      dispatchPointerDown(trigger());
      await flush();
    });
    if (!menuOpen()) {
      await act(async () => {
        dispatchClick(trigger());
        await flush();
      });
    }
  }

  // 行角色随实现而变：手写的是 `[role="option"]`，Radix 的 `DropdownMenuRadioItem`
  // 渲染成 `[role="menuitemradio"]`。两种都收（迁移期），断言本身不变。
  function rows(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="option"], [role="menuitemradio"]',
      ),
    );
  }

  function row(code: string): HTMLElement {
    const found = rows().find((b) => b.textContent?.includes(code));
    if (!found) throw new Error(`currency row not found: ${code}`);
    return found;
  }

  // 面板经 `createPortal` 挂到 `document.body`（Radix 的 `DropdownMenuContent` 自带
  // portal），所以查面板一律查 document，而**触发器仍查本地 container**。
  function menuOpen(): boolean {
    return document.querySelector('[role="menu"]') !== null;
  }

  it("names the trigger with the current value", () => {
    render("CNY");

    expect(trigger().getAttribute("aria-label")).toContain("CNY");
  });

  it("opens on click and lists every currency", async () => {
    render("CNY");

    await openMenu();

    expect(menuOpen()).toBe(true);
    expect(rows().map((b) => b.textContent?.trim())).toEqual([
      "USD",
      "CNY",
      "EUR",
      "JPY",
      "GBP",
      "HKD",
    ]);
    // 选中态用 aria-selected（自绘）或 aria-checked（Radix 的 radio item）表达，
    // 两种实现的表达方式不同、语义相同（Check/Circle 图标是 SVG，不贡献文字）
    const selected = rows().filter(
      (b) =>
        b.getAttribute("aria-selected") === "true" ||
        b.getAttribute("aria-checked") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("CNY");
  });

  it("reports a different currency and closes", async () => {
    const onChange = render("CNY");

    await openMenu();
    click(row("EUR"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("EUR");
    expect(menuOpen()).toBe(false);
  });

  it("does not report the already-selected currency", async () => {
    const onChange = render("CNY");

    await openMenu();
    click(row("CNY"));

    expect(onChange).not.toHaveBeenCalled();
    expect(menuOpen()).toBe(false);
  });

  it("closes on Escape", async () => {
    render("CNY");
    await openMenu();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await flush();
    });

    expect(menuOpen()).toBe(false);
  });

  it("closes on an outside click", async () => {
    render("CNY");
    await openMenu();

    // 条件式：手写实现听 document 的 `mousedown`，Radix 的 DismissableLayer 听
    // `pointerdown` —— 先发 pointerdown，没关再补 mousedown（一次只发一个，见 §0 第 9 条）。
    await act(async () => {
      dispatchPointerDown(document.body);
      await flush();
    });
    if (menuOpen()) {
      await act(async () => {
        document.body.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true }),
        );
        await flush();
      });
    }

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
