// @vitest-environment jsdom
//
// SudoPasswordDialog 迁移后的不变量。
//
// 这个弹窗有两个不能丢的东西：
//   1. **不可关闭**：和 PermissionDialog 同理，它是「必须应答」的阻塞场景，
//      Esc 不得关掉它（否则 sudo 请求悬空）。
//   2. **密码擦除时机**：密码只存 ref（刻意不进 React state / 渲染周期），
//      必须在提交后、取消后、卸载时三条路径上都被清空。
//      迁到 Radix 后内容在退场动画期间会保持挂载，这条尤其要盯。
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { SudoPasswordDialog } from "../../renderer/components/SudoPasswordDialog";

const respondToSudoPassword = vi.fn();

vi.mock("../../renderer/hooks/useIPC", () => ({
  useIPC: () => ({
    respondToSudoPassword,
    respondToPermission: vi.fn(),
  }),
}));

const request = {
  toolUseId: "sudo-1",
  command: "apt-get install -y foo",
  sessionId: "session-1",
};

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

/** 弹窗里那个密码输入框。 */
function passwordInput(): HTMLInputElement {
  const el = document.body.querySelector<HTMLInputElement>(
    'input[type="password"]',
  );
  expect(el, "密码输入框必须存在").not.toBeNull();
  return el!;
}

function buttons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll("button"));
}

/** 按 i18n 标签找按钮 —— 不按索引（标签比位置稳定，也不会受内置控件影响）。 */
function buttonByLabel(label: string): HTMLButtonElement {
  const el = buttons().find((b) => b.textContent?.trim() === label);
  expect(el, `按钮「${label}」必须存在`).toBeTruthy();
  return el as HTMLButtonElement;
}

/** 在输入框里打字。
 *
 * ⚠️ 必须走**原型上的 native setter**：React 用 `_valueTracker` 跟踪 input 的值，
 * 而 tracker 包装了节点的 `value` 属性 —— 直接 `input.value = x` 会被 tracker 记下，
 * 于是 `input` 事件到达时 React 认为「值没变」→ **onChange 被静默抑制**。
 * 后果很隐蔽：提交时 `passwordRef.current` 还是空的，`handleSubmit` 在
 * `if (!pwd) return` 处直接返回，表现为「按钮点了但 IPC 一次都没调」。
 * 绕过 tracker 才会真的触发 onChange。
 */
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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  respondToSudoPassword.mockClear();
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

describe("SudoPasswordDialog", () => {
  it("常驻占用 occlusion，卸载时释放", async () => {
    await render(<SudoPasswordDialog request={request} />);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    await act(async () => {
      root.render(<div />);
    });
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("显示要执行的命令", async () => {
    await render(<SudoPasswordDialog request={request} />);
    expect(document.body.textContent).toContain("apt-get install -y foo");
  });

  it("打开后焦点落在密码输入框上", async () => {
    // 这条钉的是一个真实回归：Radix 的 `Presence` 把弹窗内容**延后一帧**挂载，
    // 所以如果聚焦逻辑写在外层组件的 `useEffect(…, [])` 里，跑的时候
    // `inputRef.current` 还是 null，focus 是个空操作。
    // 实测修复前 `document.activeElement` 是 BODY。
    // 现在输入框是独立子组件（生命周期与内容对齐），所以能拿到焦点。
    await render(<SudoPasswordDialog request={request} />);
    expect(document.activeElement, "焦点必须在密码框上，不在 body 上").toBe(
      passwordInput(),
    );
  });

  it("Esc 不关闭弹窗、也不代为应答", async () => {
    // Review Focus #2：不可关闭型弹窗
    await render(<SudoPasswordDialog request={request} />);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(respondToSudoPassword).not.toHaveBeenCalled();
  });

  it("提交后擦除输入框的值（密码不留在 DOM 里）", async () => {
    // Review Focus #4：安全契约
    await render(<SudoPasswordDialog request={request} />);
    const input = passwordInput();
    await type(input, "hunter2");

    await act(async () => {
      buttonByLabel(i18n.t("sudo.execute")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(respondToSudoPassword).toHaveBeenCalledWith("sudo-1", "hunter2");
    expect(input.value, "提交后必须立刻清空").toBe("");
  });

  it("取消后擦除输入框的值并应答 null", async () => {
    await render(<SudoPasswordDialog request={request} />);
    const input = passwordInput();
    await type(input, "hunter2");

    await act(async () => {
      buttonByLabel(i18n.t("sudo.cancel")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(respondToSudoPassword).toHaveBeenCalledWith("sudo-1", null);
    expect(input.value).toBe("");
  });

  it("卸载时擦除输入框的值", async () => {
    // 断言方式很关键：不能在卸载后查 `document.body` 里还有没有密码框 ——
    // 它为 null 只是因为组件没了，**证明不了「被擦除」**（初稿就是这么写的，
    // 是一条什么都没验的空测试）。要**先抓住元素引用**，卸载后再读它的 value：
    // 元素仍在内存里，组件 cleanup 里那次 `inputEl.value = ""` 是可观测的。
    await render(<SudoPasswordDialog request={request} />);
    const input = passwordInput();
    await type(input, "hunter2");
    expect(input.value).toBe("hunter2");

    await act(async () => {
      root.render(<div />);
    });

    expect(input.value, "卸载时的 cleanup 必须把值擦掉").toBe("");
  });
});
