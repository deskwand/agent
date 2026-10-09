// @vitest-environment jsdom
//
// KeyDialog 的 busy 守卫。
//
// 原实现只挡 Esc（window keydown 里查 busyRef）。迁到 Radix 后关闭路径变成三条
//（Esc / 遮罩点击 / DialogContent 内置的关闭键），守卫必须统一放在 onOpenChange 里，
// 否则会漏掉两条 —— 而漏掉的后果是：请求在飞、窗口关了、用户不知道到底加成功没有。
//
// 这个文件的写法和本仓既有的 connectors 测试一致（见 key-dialog.test.tsx）。
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import i18n from "../../renderer/i18n/config";
import { KeyDialog } from "../../renderer/components/connectors/KeyDialog";

/** 一个可控的 IPC：手动决定何时 resolve，便于把弹窗停在 busy 态。 */
let resolveConnect: ((value: { ok: boolean }) => void) | null = null;
const connectWithKey = vi.fn(
  () =>
    new Promise<{ ok: boolean }>((resolve) => {
      resolveConnect = resolve;
    }),
);

const entry = {
  serverName: "demo",
  nameKey: "connectors.demo.name",
  auth: {
    kind: "key" as const,
    credentialLabelKey: "connectors.demo.credential",
    consoleUrl: "https://example.com",
  },
} as unknown as Parameters<typeof KeyDialog>[0]["entry"];

const onClose = vi.fn();
const onConnected = vi.fn();

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
 * 那样测试会红在「IPC 没被调用」，报告的位置与真实原因（点错了元素）差了十万八千里。
 */
function buttonByLabel(label: string): HTMLButtonElement {
  const el = buttons().find((b) => b.textContent?.trim() === label);
  expect(el, `按钮「${label}」必须存在`).toBeTruthy();
  return el as HTMLButtonElement;
}

function credentialInput(): HTMLInputElement {
  const el = document.body.querySelector<HTMLInputElement>(
    '[data-testid="key-credential"]',
  );
  expect(el, "凭据输入框必须存在").not.toBeNull();
  return el!;
}

/** 在输入框里打字。必须走 native setter —— React 的 `_valueTracker` 会
 *  跟踪直接赋值，导致 `input` 事件被认为是「值没变」而静默抑制 onChange。 */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    nativeSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const dialogVisible = (): boolean =>
  document.body.querySelector('[role="dialog"]') !== null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    connectors: { connectWithKey },
  };
  connectWithKey.mockClear();
  onClose.mockClear();
  onConnected.mockClear();
  resolveConnect = null;
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

describe("KeyDialog 的 busy 守卫", () => {
  it("打开后焦点落在凭据输入框上", async () => {
    // 钉住一个迁移回归：Radix 的 Presence 把内容延后一帧挂载，
    // 写在外层 useEffect(…, []) 里的 focus 会落空（实测 activeElement 是 BODY）。
    await render(
      <KeyDialog entry={entry} onClose={onClose} onConnected={onConnected} />,
    );
    expect(document.activeElement, "焦点必须在凭据输入框上，不在 body 上").toBe(
      credentialInput(),
    );
  });

  it("空闲时 Esc 关闭并释放 occlusion", async () => {
    await render(
      <KeyDialog entry={entry} onClose={onClose} onConnected={onConnected} />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("busy 期间 Esc 不关闭", async () => {
    await render(
      <KeyDialog entry={entry} onClose={onClose} onConnected={onConnected} />,
    );
    await type(credentialInput(), "sk-test");
    await act(async () => {
      buttonByLabel(i18n.t("connectors.keyDialog.submit")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(connectWithKey).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose, "busy 时 Esc 不得关闭").not.toHaveBeenCalled();
    expect(dialogVisible(), "弹窗必须还在").toBe(true);

    // 收尾：让 IPC 落地，避免悬挂的 promise 影响后续用例
    await act(async () => {
      resolveConnect?.({ ok: true });
    });
  });

  it("busy 期间点内置关闭键也不关闭", async () => {
    // 这是 Radix 引入的新路径之一：原实现根本没有关闭键，所以这条守卫是新增的。
    await render(
      <KeyDialog entry={entry} onClose={onClose} onConnected={onConnected} />,
    );
    await type(credentialInput(), "sk-test");
    await act(async () => {
      buttonByLabel(i18n.t("connectors.keyDialog.submit")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(connectWithKey).toHaveBeenCalledTimes(1);

    // 内置关闭键是 DialogContent 的最后一个直接子 button
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
      resolveConnect?.({ ok: true });
    });
  });
});
