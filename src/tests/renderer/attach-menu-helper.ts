/**
 * 驱动「＋」附件菜单的小工具。
 *
 * 为什么需要它：Radix 的 `DropdownMenuTrigger` **只挂 `onPointerDown`**
 *（+ Enter/Space/ArrowDown 的 keydown），**没有 `onClick`** ✗ —— 而手写的旧触发器
 * 是 `<button onClick={…}>`，**只认 click** ✗。迁移期间两种实现并存，测试若只派发
 * 一种，就会有一半场景打不开菜单，而失败信息表现为「菜单里没有那一项」，
 * 极易误判成渲染错了 ✗。
 *
 * **所以这里两种都派发** ✓，对迁移前后都成立 ✓（计划 7 在设置下拉上用同样办法
 * 度过了迁移期，见 `settings-menu-helper.ts`）。
 *
 * ⚠️ 迁移完成后（本仓不再有手写菜单触发器时）可以只留 `pointerdown` ——
 * 但**那要等全部菜单迁完**再统一收，现在不要提前收 ✗。
 *
 * 注意：本文件**取代**了 5 个测试文件各自的 `trigger()` 辅助与 `trigger().click()`
 * 调用点。菜单**项**仍然用 `.click()` ✓ —— Radix 的 `MenuItemImpl` 有
 * `onClick: composeEventHandlers(props.onClick, handleSelect)`（读源码核实），
 * item 认 click ✓，不用动。
 */
/** 「＋」触发器。5 个测试文件原本各自按 `data-attach-trigger` 查它。 */
export function attachMenuTrigger(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    "button[data-attach-trigger]",
  );
  if (!button) throw new Error("missing attach menu trigger");
  return button;
}

/**
 * 触发一次（对旧触发器 = click、对 Radix 触发器 = pointerdown，二者都发）。
 * **会 toggle** —— 菜单开着时调用它等于关闭，与真实点击一致 ✓。
 *
 * ⚠️ 本函数**不自己包 `act`**：调用点本来就在 `await act(async () => { … })` 里 ✓
 * （嵌套 act 只会多噪音 ✗）。请保留调用点的 act ✓。
 */
export async function toggleAttachMenu(container: HTMLElement): Promise<void> {
  {
    const trigger = attachMenuTrigger(container);
    // jsdom 没有 PointerEvent，用 MouseEvent 派发同名事件即可（React 按事件名映射）
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
    trigger.click();
    // Radix 的 dismissal/焦点是在 setTimeout 里跑完的（计划 7 的教训），
    // 推一次宏任务，免得后续断言读到还没落地的状态。
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
