// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../renderer/i18n/config";
import { ProviderModelList } from "../../renderer/components/settings/api/provider-model-list";
import type { ProviderModelRow } from "../../renderer/utils/merge-provider-models";

let container: HTMLDivElement;
let root: Root;

function row(overrides: Partial<ProviderModelRow> = {}): ProviderModelRow {
  return {
    id: "qwen-max",
    label: "Qwen Max",
    isNew: false,
    enabled: true,
    isDefault: false,
    ...overrides,
  };
}

let onChange: ReturnType<typeof vi.fn<(rows: ProviderModelRow[]) => void>>;
let onCommit: ReturnType<typeof vi.fn<(rows: ProviderModelRow[]) => void>>;

function render(
  rows: ProviderModelRow[],
  overrides: Partial<React.ComponentProps<typeof ProviderModelList>> = {},
) {
  onChange = vi.fn<(rows: ProviderModelRow[]) => void>();
  onCommit = vi.fn<(rows: ProviderModelRow[]) => void>();
  const props = {
    rows,
    allowManual: false,
    onChange,
    onCommit,
    ...overrides,
  };
  act(() => root.render(<ProviderModelList {...props} />));
  return props;
}

function byTestId<T extends HTMLElement>(id: string): T | null {
  return container.querySelector<T>(`[data-testid="${id}"]`);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("模型列表", () => {
  it("一行只有勾选、名称、能力 chip、默认；上下文输入默认不渲染", () => {
    render([row(), row({ id: "qwen-plus", label: "Qwen Plus" })]);
    expect(byTestId("model-row-qwen-max")).toBeTruthy();
    expect(byTestId("model-capability-qwen-max")).toBeTruthy();
    expect(byTestId("model-context-qwen-max")).toBeNull();
  });

  it("点能力 chip 展开面板，面板里才有上下文与图片能力", () => {
    render([row()]);
    act(() =>
      byTestId<HTMLButtonElement>("model-capability-qwen-max")!.click(),
    );
    expect(byTestId("model-capability-panel-qwen-max")).toBeTruthy();
    expect(byTestId("model-context-qwen-max")).toBeTruthy();
    expect(byTestId("model-image-auto-qwen-max")).toBeTruthy();
    expect(byTestId("model-image-on-qwen-max")).toBeTruthy();
    expect(byTestId("model-image-off-qwen-max")).toBeTruthy();
  });

  it("改上下文 → 带上 contextWindowPinned 并提交", () => {
    render([row()]);
    act(() =>
      byTestId<HTMLButtonElement>("model-capability-qwen-max")!.click(),
    );
    const input = byTestId<HTMLInputElement>("model-context-qwen-max")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(input, "250000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // React 的 onBlur 走 focusout
    act(() =>
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );
    const committed = onCommit.mock.calls.at(-1)?.[0] as ProviderModelRow[];
    expect(committed[0].contextWindow).toBe(250000);
    expect(committed[0].contextWindowPinned).toBe(true);
  });

  it("「恢复自动」清空上下文并去掉钉住标记", () => {
    render([row({ contextWindow: 250000, contextWindowPinned: true })]);
    act(() =>
      byTestId<HTMLButtonElement>("model-capability-qwen-max")!.click(),
    );
    act(() =>
      byTestId<HTMLButtonElement>("model-capability-reset-qwen-max")!.click(),
    );
    const committed = onCommit.mock.calls.at(-1)?.[0] as ProviderModelRow[];
    expect(committed[0].contextWindow).toBeUndefined();
    expect(committed[0].contextWindowPinned).toBe(false);
  });

  it("图片改「仅文本」→ input 不含 image 且 inputPinned", () => {
    render([row({ input: ["text", "image"], inputPinned: true })]);
    act(() =>
      byTestId<HTMLButtonElement>("model-capability-qwen-max")!.click(),
    );
    act(() => byTestId<HTMLButtonElement>("model-image-off-qwen-max")!.click());
    const committed = onCommit.mock.calls.at(-1)?.[0] as ProviderModelRow[];
    expect(committed[0].input).toEqual(["text"]);
    expect(committed[0].inputPinned).toBe(true);
  });

  it("点「默认」把 isDefault 挪到该行", () => {
    render([
      row({ isDefault: true }),
      row({ id: "qwen-plus", label: "Qwen Plus" }),
    ]);
    const buttons = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent === "默认" || b.textContent === "Default",
    );
    act(() => buttons[buttons.length - 1].click());
    const committed = onCommit.mock.calls.at(-1)?.[0] as ProviderModelRow[];
    expect(committed[0].isDefault).toBe(false);
    expect(committed[1].isDefault).toBe(true);
  });

  it("不允许关掉最后一个启用模型", () => {
    render([row()]);
    act(() =>
      byTestId<HTMLInputElement>("model-row-qwen-max")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      ),
    );
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("allowManual 为 false 时没有「添加模型」；为 true 时追加一行空 id", () => {
    render([row()], { allowManual: false });
    expect(byTestId("model-add-row")).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    render([row()], { allowManual: true });
    act(() => byTestId<HTMLButtonElement>("model-add-row")!.click());
    const next = onChange.mock.calls.at(-1)?.[0] as ProviderModelRow[];
    expect(next.at(-1)?.id).toBe("");
  });

  it("搜索过滤后仍按原始下标编辑", () => {
    render([
      row({ label: "Alpha", id: "a" }),
      row({ id: "qwen-max", label: "Qwen Max" }),
    ]);
    const search = byTestId<HTMLInputElement>("model-search")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(search, "qwen");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() =>
      byTestId<HTMLButtonElement>("model-capability-qwen-max")!.click(),
    );
    expect(byTestId("model-capability-panel-qwen-max")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
