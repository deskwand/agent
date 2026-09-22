/**
 * 磁贴列表的增 / 删 / 去重。抽成纯函数一是能单测，
 * 二是"同一元素重复 pick 只留一张"这个约定原先散在 ChatInput 的
 * setState 闭包里，根本没法回归。
 */
import type { ElementSelection } from "../../shared/ipc-types";

/** 去重键：同一页面上的同一选择器 = 同一个元素 */
export function selectionKey(selection: ElementSelection): string {
  return `${selection.pageUrl}|${selection.selector}`;
}

export function addElementSelection(
  list: ElementSelection[],
  next: ElementSelection,
): ElementSelection[] {
  const key = selectionKey(next);
  if (list.some((item) => selectionKey(item) === key)) return list;
  return [...list, next];
}

export function removeElementSelection(
  list: ElementSelection[],
  key: string,
): ElementSelection[] {
  return list.filter((item) => selectionKey(item) !== key);
}
