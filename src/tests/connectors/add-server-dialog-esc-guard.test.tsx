// @vitest-environment jsdom
//
// AddServerDialog 的 busy 守卫与校验，与 KeyDialog 同形
//（见 key-dialog-esc-guard.test.tsx）。
// 区别：这个弹窗的 IPC 是 addCustomServer，入口是 textarea，
// 且它导出了一个纯函数 validateSingleServerPayload —— 那条必须原样通过。
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import i18n from "../../renderer/i18n/config";
import { AddServerDialog } from "../../renderer/components/connectors/AddServerDialog";

let resolveAdd: ((value: { ok: boolean }) => void) | null = null;
const addCustomServer = vi.fn(
  () =>
    new Promise<{ ok: boolean }>((resolve) => {
      resolveAdd = resolve;
    }),
);

const onClose = vi.fn();
const onAdded = vi.fn();

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

function buttons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll("button"));
}

/**
 * 按 i18n 标签找按钮。
 *
 * **绝不能按索引取**：DialogContent 的渲染顺序是 `{children}` 然后
 * `<DialogPrimitive.Close>`，所以内置关闭键永远是**最后一个** button ——
 * `buttons()[buttons().length - 1]` 点到的是关闭键而不是提交键。
 */
function buttonByLabel(label: string): HTMLButtonElement {
  const el = buttons().find((b) => b.textContent?.trim() === label);
  expect(el, `按钮「${label}」必须存在`).toBeTruthy();
  return el as HTMLButtonElement;
}

function payloadTextarea(): HTMLTextAreaElement {
  const el = document.body.querySelector<HTMLTextAreaElement>(
    '[data-testid="add-payload"]',
  );
  expect(el, "payload 输入框必须存在").not.toBeNull();
  return el!;
}

/** 打字。必须走 native setter —— React 的 `_valueTracker` 会跟踪直接赋值，
 *  导致 `input` 事件被认为是「值没变」而静默抑制 onChange。 */
async function type(el: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    nativeSetter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const dialogVisible = (): boolean =>
  document.body.querySelector('[role="dialog"]') !== null;

/** 一份合法的单台 server payload —— 必须过 validateSingleServerPayload。 */
const VALID_PAYLOAD = JSON.stringify({
  mcpServers: { "my-tools": { type: "stdio", command: "npx" } },
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    connectors: { addCustomServer },
  };
  addCustomServer.mockClear();
  onClose.mockClear();
  onAdded.mockClear();
  resolveAdd = null;
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document
    .querySelectorAll('[role="dialog"], [role="alertdialog"]')
    .forEach((el) => el.remove());
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

async function submit() {
  await act(async () => {
    buttonByLabel(i18n.t("connectors.action.add")).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
}

describe("AddServerDialog 的 busy 守卫", () => {
  it("打开后焦点落在 payload 输入框上", async () => {
    // 钉住迁移回归：Radix 的 Presence 把内容延后一帧挂载，
    // 写在外层 useEffect(…, []) 里的 focus 会落空（实测 activeElement 是 BODY）。
    await render(
      <AddServerDialog isOpen onClose={onClose} onAdded={onAdded} />,
    );
    expect(
      document.activeElement,
      "焦点必须在 payload 输入框上，不在 body 上",
    ).toBe(payloadTextarea());
  });

  it("空闲时 Esc 关闭", async () => {
    await render(
      <AddServerDialog isOpen onClose={onClose} onAdded={onAdded} />,
    );
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("busy 期间 Esc 不关闭", async () => {
    await render(
      <AddServerDialog isOpen onClose={onClose} onAdded={onAdded} />,
    );
    await type(payloadTextarea(), VALID_PAYLOAD);
    await submit();
    expect(addCustomServer).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose, "busy 时 Esc 不得关闭").not.toHaveBeenCalled();
    expect(dialogVisible()).toBe(true);

    await act(async () => {
      resolveAdd?.({ ok: true });
    });
  });

  it("busy 期间点内置关闭键也不关闭", async () => {
    // Radix 引入的新关闭路径，原实现根本没有关闭键。
    await render(
      <AddServerDialog isOpen onClose={onClose} onAdded={onAdded} />,
    );
    await type(payloadTextarea(), VALID_PAYLOAD);
    await submit();
    expect(addCustomServer).toHaveBeenCalledTimes(1);

    const closeButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"] > button',
      ),
    ).at(-1);
    expect(closeButton, "内置关闭键必须存在").toBeTruthy();
    await act(async () => {
      closeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClose, "busy 时关闭键不得关闭").not.toHaveBeenCalled();
    expect(dialogVisible()).toBe(true);

    await act(async () => {
      resolveAdd?.({ ok: true });
    });
  });

  it("非法 payload 不发起 IPC，且弹窗不关", async () => {
    // 顺带锁住 validateSingleServerPayload 仍在生效（它本身不该被本次迁移改动）
    await render(
      <AddServerDialog isOpen onClose={onClose} onAdded={onAdded} />,
    );
    await type(payloadTextarea(), "{ not json");
    await submit();
    expect(addCustomServer).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialogVisible()).toBe(true);
  });
});
