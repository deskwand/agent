/**
 * 驱动设置项里的自绘下拉（`SettingsSelect`）的小工具。
 *
 * 为什么不写成 `select.value = x; dispatchEvent(new Event("change"))`：
 * 那个下拉**不是原生 `<select>`** —— 原生展开菜单由操作系统绘制，跟随系统外观而不是
 * app 主题，还会被行容器裁掉（用量页的 `CurrencySelect` 已经踩过一次并写在注释里）。
 * 换成自绘菜单之后，只能"点开触发按钮 → 点选项"。
 */
import { act } from "react";

export function menuTrigger(
  container: HTMLElement,
  testId: string,
): HTMLButtonElement {
  const trigger = container.querySelector<HTMLButtonElement>(
    `[data-testid="${testId}"]`,
  );
  if (!trigger) throw new Error(`missing menu trigger: ${testId}`);
  return trigger;
}

export async function openMenu(
  container: HTMLElement,
  testId: string,
): Promise<void> {
  await act(async () => {
    menuTrigger(container, testId).click();
  });
}

/** 菜单打开时，当前列出的选项值（按显示顺序）。 */
export function optionValues(container: HTMLElement, testId: string): string[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      `[data-testid^="${testId}-option-"]`,
    ),
  ).map((option) => option.dataset.testid!.slice(`${testId}-option-`.length));
}

/** 菜单打开时，当前列出的选项**显示文字**（断言文案用它，值用 optionValues）。 */
export function optionLabels(container: HTMLElement, testId: string): string[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      `[data-testid^="${testId}-option-"]`,
    ),
  ).map((option) => option.textContent ?? "");
}

/** 打开并选中某一项（受控值不同才回传，与真实点击一致）。 */
export async function pickOption(
  container: HTMLElement,
  testId: string,
  value: string,
): Promise<void> {
  await openMenu(container, testId);
  const option = container.querySelector<HTMLButtonElement>(
    `[data-testid="${testId}-option-${value}"]`,
  );
  if (!option) throw new Error(`missing option ${value} for ${testId}`);
  await act(async () => {
    option.click();
  });
}
