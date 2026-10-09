// 弹窗测试的公共脚手架（见本任务的说明）。
//
// 本仓的既有风格是每个测试文件自己搭 root（90 个文件如此），但弹窗测试在
// 迁到 Radix 之后多了四件**迁移特有**的事（portal 查询、按标签找按钮、
// 取内置关闭键、清 portal 节点），它们不是通用脚手架，所以才抽出来。
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect } from "vitest";

/**
 * 清掉所有弹层 portal 节点。portal 挂在 document.body 下，不随本地 container 移除。
 *
 * 名字保留 `cleanupDialogs`：它在所有测试文件的 afterEach 里被调用，改名会波及
 * 十几个文件。但它**也清菜单**（`[role="menu"]`）—— 计划 5 起菜单同样经 portal 挂载。
 */
export function cleanupDialogs(): void {
  document
    .querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')
    .forEach((el) => el.remove());
}

export function setupDialogTest() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const render = async (node: ReactNode): Promise<void> => {
    await act(async () => {
      root.render(node);
    });
  };

  /**
   * 弹层本体。默认查 dialog；菜单传 `"menu"`。
   * 内容经 Radix 的 Portal 挂到 document.body，**不在**本文件的 container 里，
   * 所以查 body。断言「没打开」时也必须用它 —— 查 container 会因 portal 而假绿。
   */
  const shell = (role: "dialog" | "menu" = "dialog"): Element | null =>
    document.body.querySelector(`[role="${role}"]`);

  const buttons = (): HTMLButtonElement[] =>
    Array.from(document.body.querySelectorAll("button"));

  /**
   * 按 i18n 标签找按钮。
   *
   * **绝不能按索引取**：DialogContent 的渲染顺序是 `{children}` 然后
   * `<DialogPrimitive.Close>`，所以内置关闭键永远是**最后一个** button ——
   * 按索引会点到它，而报错会指向「IPC 没被调用」，与真实原因差了十万八千里。
   */
  const buttonByLabel = (label: string): HTMLButtonElement => {
    const el = buttons().find((b) => b.textContent?.trim() === label);
    expect(el, `按钮「${label}」必须存在`).toBeTruthy();
    return el as HTMLButtonElement;
  };

  /** DialogContent 的最后一个直接子 button —— 内置关闭键。 */
  const builtinCloseButton = (): HTMLButtonElement => {
    const el = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"] > button',
      ),
    ).at(-1);
    expect(el, "内置关闭键必须存在").toBeTruthy();
    return el as HTMLButtonElement;
  };

  const teardown = (): void => {
    act(() => root.unmount());
    container.remove();
    cleanupDialogs();
  };

  return {
    container,
    render,
    shell,
    buttons,
    buttonByLabel,
    builtinCloseButton,
    teardown,
  };
}
