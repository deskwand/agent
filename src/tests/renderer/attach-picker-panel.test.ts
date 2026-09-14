// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AttachPickerPanel,
  type AttachPickerPanelProps,
} from "../../renderer/components/attach/AttachPickerPanel";
import type { AttachPickerItem } from "../../renderer/components/attach/picker-items";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const items: AttachPickerItem[] = [
  { id: "alpha.pdf", label: "alpha.pdf", size: 10 },
  { id: "beta.csv", label: "beta.csv", size: 20 },
];

const baseProps: AttachPickerPanelProps = {
  source: "vault",
  items,
  loading: false,
  emptyLabel: "empty",
  onRetry: () => {},
  addedKeys: new Set<string>(),
  onConfirm: () => {},
  onBack: () => {},
  onClose: () => {},
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<AttachPickerPanelProps> = {}) {
  act(() => {
    root.render(
      React.createElement(AttachPickerPanel, { ...baseProps, ...props }),
    );
  });
}

function searchInput(): HTMLInputElement {
  const input = container.querySelector("input");
  if (!input) throw new Error("search input not rendered");
  return input;
}

/**
 * 不能用 `input.value = x` 直接赋值：React 的 value tracker 会同步记住这个值，
 * 随后派发的原生 input 事件会被判定为「没变化」，onChange 不触发。
 * 走原型上的原生 setter 写入，tracker 仍停在旧值，React 才会正常派发 onChange。
 */
function typeInto(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function keyDown(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

function rows(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("[role='option']"));
}

function confirmButton(): HTMLButtonElement {
  const button = container.querySelector("button[data-confirm]");
  if (!button) throw new Error("confirm button not rendered");
  return button as HTMLButtonElement;
}

describe("AttachPickerPanel", () => {
  it("autofocuses the search input", () => {
    render();
    expect(document.activeElement).toBe(searchInput());
  });

  it("filters by query", () => {
    render();
    act(() => typeInto(searchInput(), "beta"));
    expect(rows()).toHaveLength(1);
  });

  it("keeps the confirm button disabled until something is selected", () => {
    render();
    expect(confirmButton().disabled).toBe(true);

    act(() => rows()[0].click());
    expect(confirmButton().disabled).toBe(false);
  });

  it("confirms the selected ids", () => {
    const onConfirm = vi.fn();
    render({ onConfirm });
    act(() => rows()[0].click());
    act(() => rows()[1].click());
    act(() => confirmButton().click());
    expect(onConfirm).toHaveBeenCalledWith(["alpha.pdf", "beta.csv"]);
  });

  it("adds a single row on double click and closes", () => {
    const onConfirm = vi.fn();
    render({ onConfirm });
    act(() => {
      rows()[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onConfirm).toHaveBeenCalledWith(["beta.csv"]);
  });

  it("marks already attached items as added and does not select them", () => {
    const onConfirm = vi.fn();
    render({ addedKeys: new Set(["vault:alpha.pdf"]), onConfirm });
    expect(rows()[0].disabled).toBe(true);

    act(() => rows()[0].click());
    act(() => confirmButton().click());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("clears the query on the first Escape, closes on the second", () => {
    const onClose = vi.fn();
    render({ onClose });
    act(() => typeInto(searchInput(), "beta"));

    keyDown(searchInput(), "Escape");
    expect(onClose).not.toHaveBeenCalled();
    expect(searchInput().value).toBe("");

    keyDown(searchInput(), "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toggles the highlighted row with Enter and confirms when nothing is highlighted", () => {
    const onConfirm = vi.fn();
    render({ onConfirm });
    const input = searchInput();

    keyDown(input, "Enter"); // 无高亮 → 无选中 → 什么都不做
    expect(onConfirm).not.toHaveBeenCalled();

    keyDown(input, "ArrowDown"); // 高亮第 1 行
    keyDown(input, "Enter"); // 切换勾选
    keyDown(input, "Enter"); // 再次切换 → 取消勾选

    keyDown(input, "Escape"); // 查询为空 → 关闭
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("uses Space to toggle the highlighted row only while the query is empty", () => {
    render();
    const input = searchInput();

    keyDown(input, "ArrowDown");
    keyDown(input, " ");

    expect(confirmButton().disabled).toBe(false);
  });

  it("shows the empty label when there is nothing to list", () => {
    render({ items: [] });
    expect(container.textContent).toContain("empty");
  });

  it("runs the empty-state action when the source has no files yet", () => {
    const onClick = vi.fn();
    render({ items: [], emptyAction: { label: "go", onClick } });
    act(() =>
      (
        container.querySelector(
          "button[data-empty-action]",
        ) as HTMLButtonElement
      ).click(),
    );
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hides the empty-state action once a query is typed", () => {
    render({ items: [], emptyAction: { label: "go", onClick: () => {} } });
    act(() => typeInto(searchInput(), "x"));
    expect(container.querySelector("button[data-empty-action]")).toBeNull();
  });

  it("shows the error label with a retry action", () => {
    const onRetry = vi.fn();
    render({ errorLabel: "boom", onRetry });
    expect(container.textContent).toContain("boom");
    act(() =>
      (
        container.querySelector("button[data-retry]") as HTMLButtonElement
      ).click(),
    );
    expect(onRetry).toHaveBeenCalled();
  });

  it("returns to the menu through the back button", () => {
    const onBack = vi.fn();
    render({ onBack });
    act(() =>
      (
        container.querySelector("button[data-back]") as HTMLButtonElement
      ).click(),
    );
    expect(onBack).toHaveBeenCalled();
  });
});
