// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AttachPickerModal,
  type AttachPickerModalProps,
} from "../../renderer/components/attach/AttachPickerModal";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const baseProps: AttachPickerModalProps = {
  source: "workspace",
  subtitle: "240 个文件 · /repo",
  selectedCount: 0,
  onClose: () => {},
  onConfirm: () => {},
  children: null,
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
  vi.clearAllMocks();
});

function render(props: Partial<AttachPickerModalProps> = {}) {
  act(() => {
    root.render(
      React.createElement(AttachPickerModal, { ...baseProps, ...props }),
    );
  });
}

function dialog(): HTMLElement {
  const el = document.body.querySelector("[role='dialog']");
  if (!el) throw new Error("dialog not rendered");
  return el as HTMLElement;
}

function modalButton(key: string): HTMLButtonElement {
  const found = Array.from(dialog().querySelectorAll("button")).find(
    (button) =>
      button.textContent?.includes(key) ||
      button.getAttribute("aria-label") === key,
  );
  if (!found) throw new Error(`modal button not found: ${key}`);
  return found as HTMLButtonElement;
}

describe("AttachPickerModal", () => {
  it("renders into document.body through a portal", () => {
    render();
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(document.body.querySelector("[role='dialog']")).not.toBeNull();
  });

  it("uses a Radix overlay and keeps the 720px panel capped at 88vh", () => {
    // 迁移后用 Radix 的 DialogOverlay（`fixed inset-0 z-50 bg-black/80`），
    // 不再有本仓手写的 `.modal-overlay`（那是 blur(12px)+rgba(.35) 那套）。
    // 观感变化是 D2 授权的结果；这里保住的是「有一层全屏覆盖层」与面板尺寸约束。
    render();
    const overlay = dialog().previousElementSibling as HTMLElement;
    expect(overlay?.className, "覆盖层必须存在且是全屏的").toContain(
      "bg-black/80",
    );
    expect(dialog().className).toContain("max-w-[720px]");
    expect(dialog().className).toContain("max-h-[88vh]");
    // 无障碍目标没变（弹窗对外是模态的），但 Radix 的实现方式与原组件不同：
    // 它**不设 `aria-modal`**（react-dialog 的 dist 里搜不到这个属性），
    // 而是用 `role="dialog"` + 焦点陷阱 + 把外部内容标 `aria-hidden` 来达成。
    // 所以这里断言真实机制：弹窗之外的内容对读屏隐藏。
    expect(
      container.getAttribute("aria-hidden"),
      "弹窗之外的内容必须对读屏隐藏",
    ).toBe("true");
  });

  it("shows the source title and the subtitle", () => {
    render();
    expect(dialog().textContent).toContain("attachMenu.workspace");
    expect(dialog().textContent).toContain("240 个文件 · /repo");
  });

  it("shows the empty selection label and disables confirm at zero", () => {
    const onConfirm = vi.fn();
    render({ onConfirm });
    expect(dialog().textContent).toContain("attachPicker.selectedNone");

    const confirm = modalButton("attachPicker.addCount");
    expect(confirm.disabled).toBe(true);
    act(() => confirm.click());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("enables confirm with a selection and reports it upward", () => {
    const onConfirm = vi.fn();
    render({ selectedCount: 2, onConfirm });
    expect(dialog().textContent).toContain("attachPicker.selectedCount");

    const confirm = modalButton("attachPicker.addCount");
    expect(confirm.disabled).toBe(false);
    act(() => confirm.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes from the built-in X and from cancel without confirming", () => {
    // 迁移后不再有本组件自己的 X（它和 DialogContent 内置的那个会在同一角落
    // 叠出两个关闭键）。关闭能力本身必须仍在被测 —— 只是换了个元素。
    // 内置关闭键是 DialogContent 的最后一个直接子 button，按位置取而不是按文案
    //（它的 sr-only 文案是硬编码英文 "Close"，不随 i18n 走）。
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render({ onClose, onConfirm });

    act(() => modalButton("common.cancel").click());
    const closeButton = Array.from(
      dialog().querySelectorAll<HTMLButtonElement>(":scope > button"),
    ).at(-1);
    expect(closeButton, "内置关闭键必须存在").toBeTruthy();
    act(() => closeButton!.click());

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closes on Escape pressed inside the shell", () => {
    const onClose = vi.fn();
    render({ onClose });

    act(() => {
      modalButton("common.cancel").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("still closes on Escape after the backdrop was clicked", () => {
    // 回归：点遮罩会把焦点从搜索框移走（落到 body），如果 Esc 只绑在弹窗元素上
    // 就再也收不到事件了——所以 Esc 绑在 document 上。
    const onClose = vi.fn();
    render({ onClose });

    const overlay = dialog().parentElement as HTMLElement;
    act(() => {
      overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not steal focus from the dialog when the backdrop is pressed", () => {
    // 断言改成**行为级**：原测试查的是「原生 mousedown 被 preventDefault」，
    // 那是旧实现（遮罩 onMouseDown 里 preventDefault）的机制。
    // 现在抑制走 Radix 的 onInteractOutside，preventDefault 落在 Radix 自己的
    // 事件对象上、不会回写到原生事件 —— 机制变了，要守住的行为没变：
    // 点遮罩既不关闭弹窗，也不把焦点从弹窗里搬走。
    render();
    const focusBefore = document.activeElement;
    const overlay = dialog().previousElementSibling as HTMLElement;

    act(() => {
      overlay.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      overlay.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });

    expect(dialog(), "弹窗不得被遮罩按压关闭").not.toBeNull();
    expect(document.activeElement, "焦点不该被搬走").toBe(focusBefore);
  });

  it("registers and releases browser occlusion while mounted", () => {
    render();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    act(() => root.unmount());
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });
});
