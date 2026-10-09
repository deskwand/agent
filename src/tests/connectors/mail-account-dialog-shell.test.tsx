// @vitest-environment jsdom
//
// MailAccountDialog 的外壳与 busy 守卫。
//
// 三件事：
//   1. 遮罩点击**不**关闭（原实现遮罩上没有 onClick）—— 与 LoginModal 相反
//   2. busy 时三条关闭路径全都要挡住（原实现只拦 Esc）
//   3. 失败的提交必须留在屏幕上（「先测后写」契约的外部表现：不跳回第一屏、不关闭）
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import i18n from "../../renderer/i18n/config";
import { MailAccountDialog } from "../../renderer/components/connectors/MailAccountDialog";
// 弹窗测试脚手架（本计划 Task 1）：container / render / shell / buttons /
// buttonByLabel / builtinCloseButton / portal 清理都由它提供，本文件不再自己搭
import { setupDialogTest } from "../dialog-test-helpers";

/** 可控的 IPC：手动决定何时 resolve，便于把弹窗停在 busy 态。 */
let resolveAdd: ((value: { ok: boolean; error?: string }) => void) | null =
  null;
const addAccount = vi.fn(
  () =>
    new Promise<{ ok: boolean; error?: string }>((resolve) => {
      resolveAdd = resolve;
    }),
);
const listAccounts = vi.fn(async () => []);

const onClose = vi.fn();
const onAdded = vi.fn();

/**
 * 脚手架来自 tests/dialog-test-helpers.ts（本计划 Task 1）。
 * 它返回的名字与本文件原本用的局部名字一致，所以下面的测试体逐字未改。
 */
let d: ReturnType<typeof setupDialogTest>;
let container: HTMLDivElement;
let render: (node: ReactNode) => Promise<void>;
let shell: () => Element | null;
let buttonByLabel: (label: string) => HTMLButtonElement;
let builtinCloseButton: () => HTMLButtonElement;

async function selectFirstProvider(): Promise<void> {
  // 第一屏是服务商网格：按钮文案来自 MAIL_PROVIDERS 的 nameKey，
  // 按 providers 的第一项取即可（不硬编码某个厂商名）。
  const { MAIL_PROVIDERS } = await import("../../shared/mail-providers");
  const first = MAIL_PROVIDERS[0];
  // 字段名是 nameKey（不是 labelKey）—— 已核对 src/shared/mail-providers.ts
  await act(async () => {
    buttonByLabel(i18n.t(first.nameKey)).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
}

/** 在受控输入框里打字。必须走 native setter —— React 的 _valueTracker
 *  会跟踪直接赋值，导致 input 事件被认为是「值没变」而静默抑制 onChange。 */
async function setValue(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    mail: { addAccount, listAccounts },
  };
  addAccount.mockClear();
  listAccounts.mockClear();
  onClose.mockClear();
  onAdded.mockClear();
  resolveAdd = null;
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  d = setupDialogTest();
  ({ container, render, shell, buttonByLabel, builtinCloseButton } = d);
});

afterEach(() => {
  // 卸载 + 移除本地 container + 清 portal 节点，全在 teardown 里（见 Task 1）
  d.teardown();
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

describe("MailAccountDialog 外壳", () => {
  it("isOpen 时占用 occlusion，关闭时释放", async () => {
    await render(
      <MailAccountDialog isOpen onClose={onClose} onAdded={onAdded} />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);

    await render(
      <MailAccountDialog isOpen={false} onClose={onClose} onAdded={onAdded} />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("卸载时释放 occlusion", async () => {
    // Review Focus #5：挂载期占着不放会让内置浏览器面板永久隐藏且无任何报错
    await render(
      <MailAccountDialog isOpen onClose={onClose} onAdded={onAdded} />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    await render(<div />);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("外部点击不关闭（原实现遮罩上没有 onClick）", async () => {
    await render(
      <MailAccountDialog isOpen onClose={onClose} onAdded={onAdded} />,
    );
    await act(async () => {
      container.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      container.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      // 陷阱 5：click 不能省，否则这条用例空转
      container.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(onClose, "遮罩点击不得关闭").not.toHaveBeenCalled();
    expect(shell()).not.toBeNull();
  });

  it("空闲时 Esc 关闭", async () => {
    await render(
      <MailAccountDialog isOpen onClose={onClose} onAdded={onAdded} />,
    );
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("busy 时 Esc 与内置关闭键都不关闭", async () => {
    await render(
      <MailAccountDialog isOpen onClose={onClose} onAdded={onAdded} />,
    );
    await selectFirstProvider();

    // 填满必填项让提交可用：邮箱地址 + 凭据
    const email = document.body.querySelector<HTMLInputElement>(
      'input[type="email"]',
    );
    const credential = document.body.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    expect(email, "邮箱输入框必须存在").not.toBeNull();
    expect(credential, "凭据输入框必须存在").not.toBeNull();
    await setValue(email!, "a@b.com");
    await setValue(credential!, "secret");

    // 提交，把弹窗停在 busy
    await act(async () => {
      buttonByLabel(i18n.t("mail.dialog.submit")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(addAccount).toHaveBeenCalledTimes(1);

    // 路径一：Esc
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onClose, "busy 时 Esc 不得关闭").not.toHaveBeenCalled();

    // 路径二：内置关闭键（迁移新增的关闭路径，原实现没有关闭键）
    await act(async () => {
      builtinCloseButton().dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onClose, "busy 时关闭键不得关闭").not.toHaveBeenCalled();
    expect(shell(), "弹窗必须还在").not.toBeNull();

    // 收尾：让 IPC 落地，避免悬挂的 promise 影响后续用例
    await act(async () => {
      resolveAdd?.({ ok: true });
    });
  });

  it("提交失败时留在屏幕上、不关闭（「先测后写」契约）", async () => {
    await render(
      <MailAccountDialog isOpen onClose={onClose} onAdded={onAdded} />,
    );
    await selectFirstProvider();
    const email = document.body.querySelector<HTMLInputElement>(
      'input[type="email"]',
    )!;
    const credential = document.body.querySelector<HTMLInputElement>(
      'input[type="password"]',
    )!;
    await setValue(email, "a@b.com");
    await setValue(credential, "bad");

    await act(async () => {
      buttonByLabel(i18n.t("mail.dialog.submit")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      resolveAdd?.({ ok: false, error: "boom" });
    });

    expect(onAdded, "失败不得报「已添加」").not.toHaveBeenCalled();
    expect(onClose, "失败不得关闭").not.toHaveBeenCalled();
    expect(shell(), "弹窗必须还在，错误留在屏幕上").not.toBeNull();
    expect(document.body.textContent).toContain("boom");
  });
});
