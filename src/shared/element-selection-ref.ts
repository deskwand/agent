/**
 * 元素引用的展示投影。放在 shared 是因为两侧都要用：主进程给宿主消息与 SDK
 * `details` 压投影，渲染层给乐观 user 消息压投影（渲染进程不能 import 主进程模块）。
 *
 * 纯函数、无依赖，便于单测。注意这是单向的：投影**不能**还原成 `ElementSelection`
 * （丢掉的字段是模型可见文本的职责），所以别拿它去喂 `element-selection-block.ts`。
 */
import type { ElementSelection, ElementSelectionRef } from "./ipc-types";

export function toElementSelectionRefs(
  selections: ElementSelection[],
): ElementSelectionRef[] {
  return selections.map((selection) => ({
    pageUrl: selection.pageUrl,
    tag: selection.tag,
    classes: selection.classes.slice(0, 2),
    text: selection.text,
    selector: selection.selector,
    selectorUnique: selection.selectorUnique,
    width: selection.rect.width,
    height: selection.rect.height,
  }));
}

export type { ElementSelectionRef };
