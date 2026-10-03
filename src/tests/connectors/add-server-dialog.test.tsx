// @vitest-environment jsdom
/**
 * 「添加」弹窗：**一次一台**的收敛在 UI 层完成（后端契约不动）。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AddServerDialog,
  validateSingleServerPayload,
} from "../../renderer/components/connectors/AddServerDialog";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../renderer/hooks/useBrowserOcclusion", () => ({
  useBrowserOcclusion: () => {},
}));

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

function render(node: React.ReactElement): void {
  act(() => {
    root.render(node);
  });
}

function textarea(): HTMLTextAreaElement {
  return container.querySelector('[data-testid="add-payload"]') as HTMLTextAreaElement;
}

function type(value: string): void {
  const box = textarea();
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function addButton(): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("connectors.action.add"),
  ) as HTMLButtonElement;
}

describe("validateSingleServerPayload", () => {
  it("接受恰好一台", () => {
    const raw = '{"mcpServers":{"a":{"command":"node"}}}';
    expect(validateSingleServerPayload(raw)).toEqual({ ok: true, payload: raw });
  });

  it("多台时回台数（文案由组件走 i18n）", () => {
    const res = validateSingleServerPayload(
      '{"mcpServers":{"a":{"command":"node"},"b":{"command":"node"}}}',
    );
    expect(res.ok).toBe(false);
    if (!res.ok && "multiServer" in res) expect(res.multiServer).toBe(2);
  });

  it("空 map 报错", () => {
    expect(validateSingleServerPayload('{"mcpServers":{}}').ok).toBe(false);
  });

  it("JSON 非法时报错", () => {
    const res = validateSingleServerPayload("{ broken");
    expect(res.ok).toBe(false);
    if (!res.ok && "error" in res) expect(res.error).toContain("invalid JSON");
  });

  it("顶层不是对象时报错", () => {
    expect(validateSingleServerPayload("[]").ok).toBe(false);
  });
});

describe("AddServerDialog", () => {
  const addCustomServer = vi.fn();

  beforeEach(() => {
    addCustomServer.mockReset();
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      connectors: { addCustomServer },
    };
  });

  it("isOpen 为假时不渲染", () => {
    render(<AddServerDialog isOpen={false} onClose={vi.fn()} onAdded={vi.fn()} />);
    expect(textarea()).toBeNull();
  });

  it("非法输入：显示错误、保留内容、不关弹窗、不发 IPC", () => {
    const onClose = vi.fn();
    render(<AddServerDialog isOpen onClose={onClose} onAdded={vi.fn()} />);
    type('{"mcpServers":{}}');
    act(() => addButton().click());

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(addCustomServer).not.toHaveBeenCalled();
    // 内容保留 —— 用户改一处即可重试，不必重贴
    expect(textarea().value).toBe('{"mcpServers":{}}');
  });

  it("成功：发一次 IPC、刷新列表、关弹窗", async () => {
    addCustomServer.mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    const onAdded = vi.fn();
    render(<AddServerDialog isOpen onClose={onClose} onAdded={onAdded} />);
    const raw = '{"mcpServers":{"my-tools":{"command":"npx"}}}';
    type(raw);
    await act(async () => {
      addButton().click();
    });

    expect(addCustomServer).toHaveBeenCalledWith({ kind: "json", payload: raw });
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("后端报错：内联显示且不关弹窗", async () => {
    addCustomServer.mockResolvedValue({ ok: false, error: 'invalid server name "My Server"' });
    const onClose = vi.fn();
    render(<AddServerDialog isOpen onClose={onClose} onAdded={vi.fn()} />);
    type('{"mcpServers":{"My Server":{"command":"npx"}}}');
    await act(async () => {
      addButton().click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "invalid server name",
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
