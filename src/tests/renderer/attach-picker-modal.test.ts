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

  it("uses the app modal recipe: overlay, 720px panel capped at 88vh", () => {
    render();
    const overlay = dialog().parentElement as HTMLElement;
    expect(overlay.className).toContain("modal-overlay");
    expect(dialog().className).toContain("max-w-[720px]");
    expect(dialog().className).toContain("max-h-[88vh]");
    expect(dialog().getAttribute("aria-modal")).toBe("true");
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

  it("closes from X and from cancel without confirming", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render({ onClose, onConfirm });

    act(() => modalButton("common.cancel").click());
    act(() => modalButton("common.close").click());

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
    render();
    const overlay = dialog().parentElement as HTMLElement;
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      overlay.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it("registers and releases browser occlusion while mounted", () => {
    render();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    act(() => root.unmount());
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });
});
