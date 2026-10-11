// @vitest-environment jsdom
//
// ScheduleEditModal 的「工作目录」浮层：手写下拉 → Radix Popover
// （计划 11 · Task 1 Step 5）。此前这个组件**零渲染覆盖**，所以这个文件是这次迁移的第一步。
//
// 它是在迁移**之前**写的 ⇒ 每条断言都必须对迁移前后都成立：
//
//   | 行为 | 迁移前（手写） | 迁移后（Popover） |
//   |---|---|---|
//   | 打开 | `<button onClick>`（只认 click） | `PopoverTrigger`（也认 click） |
//   | 面板位置 | 本地 container 内（`absolute left-0`） | portal 到 `document.body` |
//   | 点外部关 | `document` 上的 `mousedown` | DismissableLayer 的 `pointerdown`，
//   |          |  | 且 `deferPointerDownOutside: true` ⇒ 主键点击推迟到随后的 **click** |
//   | Esc 关 | **不关**（原实现根本没有 Esc 处理） | **关**（`PopoverContent` 会给） |
//
// 触发器在 container 里（两种实现都一样）；面板内容一律从 `document.body` 查
//（迁移前它在 container 内 —— 而 container 就在 body 内；迁移后它 portal 到 body）。
//
// 「面板开着」的判据不是 `role`/类名，而是**面板里的行按钮在不在**。
// ⚠️ 必须排除**触发器本身**：cwd 为空时触发器文案与「默认」项**同字**，
// 按文本查会把「没打开」判成「打开了」—— 那是假绿。
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import { ScheduleEditModal } from "../../renderer/components/ScheduleEditModal";
import { useAppStore } from "../../renderer/store";
import type { ScheduleTask, Session } from "../../renderer/types";
import { RENDERER } from "./theme-css-helpers";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_A = "/Users/me/alpha-project";
const PROJECT_B = "/Users/me/beta";

let container: HTMLDivElement;
let root: Root;

const onClose = vi.fn();
const onSaved = vi.fn();

beforeEach(() => {
  // i18n 的 LanguageDetector 按 localStorage → navigator 选语言。清掉上个用例可能
  // 留下的选择，让 `i18n.t(...)` 与组件渲染出的文案出自同一份语言状态。
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
  // 迁移后浮层经 Portal 挂在 body 下（迁移前没有），跨用例清掉免污染
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  vi.clearAllMocks();
});

async function mount(options: { workingDir?: string } = {}): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ScheduleEditModal
        task={null}
        workingDir={options.workingDir ?? ""}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
  });
}

/** 渲染任意节点（弹窗外壳用例：需要带状态的 harness，而不是裸的 onClose 桩）。 */
async function mountNode(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(node);
  });
}

/**
 * 同类型重渲染（保留 harness 内部 state），用于「弹窗开着时入口被摘掉」这类用例。
 */
async function rerender(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

/**
 * 当前的**日程弹窗**。
 *
 * 迁移前弹窗在 container 里（`container` 就在 body 下），迁移后 DialogContent 经 Portal
 * 挂到 `document.body` —— 查 container 会假绿。
 *
 * 为什么还要按标题收敛：Radix 的 `PopoverContent` 自带 `role="dialog"`（那个 portal
 * 也在 body 下），直接取 `body` 里第一个 `[role="dialog"]` 在面板也打开时并不可靠。
 * 日历标题只出现在外层弹窗里，用它把外层挑出来。
 */
function modalDialog(): HTMLElement | null {
  const titles = [
    i18n.t("schedule.calendarCreateTitle"),
    i18n.t("schedule.calendarEditTitle"),
  ];
  return (
    Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).find((el) => titles.some((title) => el.textContent?.includes(title))) ??
    null
  );
}

/**
 * Radix FocusScope 的 tabbable 候选（`tabIndex >= 0` 且 computedStyle 不是
 * `display:none` / `visibility:hidden`，与 vendored `getTabbableEdges` 同口径）。
 *
 * ⚠️ jsdom **不加载 CSS** ⇒ 被 `[&>button]:hidden` 屏蔽的 vendored 角标在这里仍算 tabbable，
 * 所以「最后一个」在真实 Electron 里其实是隐藏的、不进 Tab 序列（真实序列会早一步回绕）。
 * 本用例只证明 FocusScope 的回绕**边界**，不冒称 Electron 实际 Tab 行为已验收。
 */
function tabbables(scope: HTMLElement): HTMLElement[] {
  return Array.from(
    scope.querySelectorAll<HTMLElement>(
      "button, input, textarea, select, a[href], [tabindex]",
    ),
  ).filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return el.tabIndex >= 0;
  });
}

/** 弹窗内的按钮：按可见文案收敛（关闭矩阵用）。 */
function dialogButtonByText(label: string): HTMLButtonElement | null {
  const dialog = modalDialog();
  if (!dialog) return null;
  return (
    Array.from(dialog.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === label,
    ) ?? null
  );
}

/**
 * 弹窗内可见的错误横幅文案。
 *
 * 语义 token 小 banner 带 `role="alert"`（表单分支与删除确认分支各有一份，同一时刻只渲染其一）
 * ⇒ 用 role 查询才是有意义的「用户看得见失败原因」，按 `p` / 类名查询会假绿。
 */
function alertText(scope: HTMLElement): string {
  return scope.querySelector('[role="alert"]')?.textContent?.trim() ?? "";
}

/** 弹窗内的本地化关闭键（`[&>button]:hidden` 藏掉 vendored 英文角标后自己画的那个）。 */
function dialogCloseButton(): HTMLButtonElement | null {
  return (
    modalDialog()?.querySelector<HTMLButtonElement>(
      `button[aria-label="${i18n.t("common.close")}"]`,
    ) ?? null
  );
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

async function pointerDown(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
  });
}

/** 塞进 store 的会话 —— 组件的项目列表就是从 `sessions[].cwd` 推出来的。 */
function seedProjects(cwds: string[]): void {
  act(() => {
    useAppStore.setState({
      sessions: cwds.map(
        (cwd, index) =>
          ({
            id: `session-${index}`,
            title: `session-${index}`,
            cwd,
            isProjectMode: true,
            createdAt: 0,
            updatedAt: 0,
          }) as unknown as Session,
      ),
    });
  });
}

/**
 * 浮层在 `setTimeout(0)` 里装 document 级监听、移焦点 ⇒ 断言前先推一个宏任务。
 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * 触发器：按图标类名找 —— 它没有 aria-label，文案还会随 cwd 变（全仓先行者：
 * `sidebar-create-project.test.tsx`）。
 *
 * ⚠️ 迁移（Task 2）后触发器也在 Portal 里 ⇒ 查询作用域必须是**当前弹窗**，不是 container。
 * 仍然不在 `document.body` 里找「第一颗按钮」：跨用例的残留节点会混进来。
 */
function findTrigger(): HTMLButtonElement | null {
  const icon = modalDialog()?.querySelector("button svg.lucide-chevron-down");
  return icon ? (icon.closest("button") as HTMLButtonElement | null) : null;
}

function triggerText(): string {
  return findTrigger()?.textContent?.trim() ?? "";
}

function defaultLabel(): string {
  return i18n.t("schedule.defaultWorkspace");
}

/**
 * 面板里的行按钮（按已知文案收敛）。
 * ⚠️ 排除触发器本身：cwd 为空时它俩同字 —— 不排除的话「面板没开」也会查出行来。
 */
function findRows(labels: string[]): HTMLButtonElement[] {
  const trigger = findTrigger();
  return Array.from(document.body.querySelectorAll("button")).filter((btn) => {
    if (btn === trigger || btn.contains(trigger)) return false;
    return labels.includes(btn.textContent?.trim() ?? "");
  });
}

/** 「面板开着」的判据：第一行（「默认」项）在不在。 */
function isPanelOpen(): boolean {
  return findRows([defaultLabel()]).length > 0;
}

/**
 * 打开面板。**条件式**：先 `pointerdown`，没开再补 `click`。
 * 迁移前的触发器只认 click；迁移后的 `PopoverTrigger` 也认 click
 *（`@radix-ui/react-popover@1.2.0` `dist/index.mjs:110` → `onClick: onOpenToggle`），
 * 所以这一发对两者都成立。**无条件补 click 不行**：Radix 打开后那发 click
 * 会落在内容之外，被它自己的 DismissableLayer 当成外部点击，刚开就关。
 */
async function openPanel(): Promise<void> {
  const trigger = findTrigger();
  if (!trigger) throw new Error("找不到工作目录触发器（chevron-down 按钮）");
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  });
  await flush();
  if (isPanelOpen()) return;
  await act(async () => {
    trigger.click();
  });
  await flush();
}

/**
 * 点面板外部。三发都是**条件式**，顺序不能改：
 *   1. `pointerdown` —— Radix 的 DismissableLayer 主路径。但 `PopoverContent` 传了
 *      `deferPointerDownOutside: true`（`react-popover/dist/index.mjs:275`），主键
 *      pointerdown 只会把「外部关闭」**推迟到随后的 click**。
 *   2. `click` —— 迁移后的关闭真正落在这里。
 *   3. `mousedown` —— 迁移前那版手写监听挂的是 `document` 的 mousedown。
 */
async function clickOutside(): Promise<void> {
  const press = async (type: string) => {
    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    await flush();
  };
  await press("pointerdown");
  if (!isPanelOpen()) return;
  await press("click");
  if (!isPanelOpen()) return;
  await press("mousedown");
}

/**
 * Esc。⚠️ `cancelable: true` 不能省 —— Radix 的 DismissableLayer 收到 Escape 后会
 * `preventDefault()`（`react-dismissable-layer/dist/index.mjs:97`），事件不可取消时
 * 那是空操作（计划 6 的教训）。
 */
async function pressEscape(): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await flush();
}

describe("ScheduleEditModal 的工作目录浮层（手写下拉 → Popover）", () => {
  it("未打开时：触发器渲染当前选择，面板一行都没有", async () => {
    await mount();
    expect(findTrigger(), "触发器必须存在（chevron-down 按钮）").not.toBeNull();
    expect(triggerText()).toBe(defaultLabel());
    expect(isPanelOpen()).toBe(false);
  });

  it("workingDir 决定初始触发器文案", async () => {
    await mount({ workingDir: PROJECT_A });
    expect(triggerText()).toBe("alpha-project");
  });

  it("打开：默认项在最前、项目行去重排序，面板宽度仍是 w-56", async () => {
    seedProjects([PROJECT_B, PROJECT_A, PROJECT_A]);
    await mount();
    await openPanel();
    const rows = findRows([defaultLabel(), "alpha-project", "beta"]);
    expect(rows.map((row) => row.textContent?.trim())).toEqual([
      defaultLabel(),
      "alpha-project",
      "beta",
    ]);
    // 面板 = 行按钮的父元素。宽度是本次迁移显式保留的契约（原实现就是 w-56）。
    // 这里查的是面板自身的类名，**不**参与「面板开着没有」的判定。
    expect(rows[0].parentElement?.className).toContain("w-56");
  });

  it("选中态：当前 cwd 那一行带 Check 图标，其余不带", async () => {
    seedProjects([PROJECT_A]);
    await mount();
    await openPanel();
    const rows = findRows([defaultLabel(), "alpha-project"]);
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("svg.lucide-check")).not.toBeNull();
    expect(rows[1].querySelector("svg.lucide-check")).toBeNull();
  });

  it("点项目行：cwd 写入并关闭面板，触发器换成该项目名", async () => {
    seedProjects([PROJECT_A]);
    await mount();
    await openPanel();
    const rows = findRows(["alpha-project"]);
    expect(rows).toHaveLength(1);
    await act(async () => {
      rows[0].click();
    });
    await flush();
    expect(isPanelOpen()).toBe(false);
    expect(triggerText()).toBe("alpha-project");
  });

  it("点面板外部：关闭", async () => {
    await mount();
    await openPanel();
    expect(isPanelOpen()).toBe(true);
    await clickOutside();
    expect(isPanelOpen()).toBe(false);
  });

  it("Esc：迁移后由 PopoverContent 关闭（契约变更 #1）", async () => {
    // ⚠️ 契约变更 #1：这是整次迁移唯一被这张网抓住的行为差异。
    // 基线（旧实现）的那一版断言是 `toBe(true)` —— 原实现没有 Esc 处理，面板不关；
    // 迁到 Popover 后 Radix 的 DismissableLayer 提供了 Esc ⇒ 断言翻成 `toBe(false)`。
    await mount();
    await openPanel();
    await pressEscape();
    expect(isPanelOpen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 2：弹窗外壳迁移（自建遮罩 → OccludingDialog + vendored DialogContent）
// ---------------------------------------------------------------------------

/**
 * 带状态的 harness：父级按 open 条件挂载弹窗（与 ScheduleView 的写法一致：
 * `{modalOpen && <ScheduleEditModal … />}`），opener 是 React 树里的真实按钮。
 *
 * ⚠️ opener 不能手动 `container.appendChild`：`root.render()` 会清掉 container 里的
 * 既有子节点，手动挂的节点首帧就被 React 移除，`onOpenAutoFocus` 会捕获到 BODY。
 */
function ModalHarness({
  onRestoreFocus,
  showOpener = true,
  task = null,
  prefillDate,
}: {
  onRestoreFocus?: () => void;
  showOpener?: boolean;
  task?: ScheduleTask | null;
  prefillDate?: Date;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  return (
    <>
      {showOpener && (
        <button
          ref={openerRef}
          type="button"
          data-testid="opener"
          onClick={() => setOpen(true)}
        >
          open
        </button>
      )}
      {/* ScheduleView 根容器的忠实替身：真实可聚焦（tabIndex=-1，不进 Tab 顺序） */}
      <div ref={fallbackRef} data-testid="fallback" tabIndex={-1} />
      {open && (
        <ScheduleEditModal
          task={task}
          workingDir=""
          prefillDate={prefillDate}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          onSaved={onSaved}
          onRestoreFocus={
            onRestoreFocus
              ? () => {
                  onRestoreFocus();
                  fallbackRef.current?.focus({ preventScroll: true });
                }
              : undefined
          }
        />
      )}
    </>
  );
}

function openerButton(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(
    '[data-testid="opener"]',
  );
  expect(el, "opener 必须存在").not.toBeNull();
  return el as HTMLButtonElement;
}

/** 聚焦 opener → 点开弹窗（jsdom 的 click 不会自动聚焦，必须显式 focus）。 */
async function openFromOpener(): Promise<void> {
  const opener = openerButton();
  opener.focus();
  expect(document.activeElement).toBe(opener);
  await click(opener);
  await flush();
}

/** 遮罩层：DialogPortal 里 Overlay 是 Content 的前一个兄弟。 */
function overlay(): Element | null {
  return modalDialog()?.previousElementSibling ?? null;
}

/** 点遮罩关闭：modal Content 传 `deferPointerDownOutside: true` ⇒ pointerdown + click 两发。 */
async function clickOverlay(): Promise<void> {
  const panel = overlay();
  expect(panel, "遮罩层必须存在").not.toBeNull();
  await pointerDown(panel as Element);
  await click(panel as Element);
  await flush();
}

describe("日程弹窗外壳（自建遮罩 → OccludingDialog）", () => {
  it("渲染进 role=dialog 并占用 occlusion，且不调用 onClose", async () => {
    await mount();
    const dialog = modalDialog();
    expect(dialog, "必须迁移成 role=dialog 的 Radix 弹窗").not.toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("遮罩点击关闭一次并释放 occlusion（矩阵：外部点击允许）", async () => {
    await mountNode(<ModalHarness />);
    await openFromOpener();
    const panel = overlay();
    expect(panel, "遮罩层必须存在").not.toBeNull();
    // Radix 的 modal Content 传 `deferPointerDownOutside: true`：pointerdown 只登记，
    // 真正的 dismiss 落在紧随其后的 click 上。
    await pointerDown(panel as Element);
    expect(onClose, "pointerdown 本身还不该关").not.toHaveBeenCalled();
    await click(panel as Element);
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(modalDialog()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("Escape 不关闭外层（矩阵：禁止），弹窗与 occlusion 原样", async () => {
    await mountNode(<ModalHarness />);
    await openFromOpener();
    await pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    expect(modalDialog()).not.toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
  });

  it("header 关闭键（DialogClose + 本地化 aria-label）关闭一次", async () => {
    await mountNode(<ModalHarness />);
    await openFromOpener();
    const btn = dialogCloseButton();
    expect(
      btn,
      "本地化 aria-label=common.close 的 header 关闭键必须存在",
    ).not.toBeNull();
    await click(btn as HTMLButtonElement);
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(modalDialog()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("vendored 内置角标被调用点屏蔽（否则多一个英文关闭键）", async () => {
    await mount();
    const dialog = modalDialog();
    expect(dialog, "内容必须存在").not.toBeNull();
    expect(
      dialog!.className,
      "必须屏蔽 DialogContent 的内置英文角标",
    ).toContain("[&>button]:hidden");
    // 角标仍在 DOM 里（由 CSS 隐藏），且是 DialogContent 唯一的直接子 button。
    expect(
      document.body.querySelectorAll('[role="dialog"] > button'),
      "直接子 button 恰好是内置角标那一个",
    ).toHaveLength(1);
  });

  it("取消按钮关闭一次（矩阵：取消允许）", async () => {
    await mountNode(<ModalHarness />);
    await openFromOpener();
    const cancel = dialogButtonByText(i18n.t("common.cancel"));
    expect(cancel, "取消按钮必须存在").not.toBeNull();
    await click(cancel as HTMLButtonElement);
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(modalDialog()).toBeNull();
  });

  it("原生日期输入保持原生（不装进 Radix 控件）", async () => {
    await mountNode(<ModalHarness />);
    await openFromOpener();
    const dialog = modalDialog();
    // ⚠️ 先断言弹窗在：`dialog?.querySelector(...)` 在弹窗缺失时给的是 `undefined`，
    // 而 `expect(undefined).not.toBeNull()` 会**假绿**（本轮实测踩到过）。
    expect(dialog, "弹窗必须在").not.toBeNull();
    const date = (dialog as HTMLElement).querySelector('input[type="date"]');
    expect(date, "Once 模式的 date 输入必须还在").not.toBeNull();
  });
});

describe("日程弹窗内的嵌套 Popover：Escape 只关自己", () => {
  it("第一次 Escape 关面板，第二次外层仍不被 Escape 关闭", async () => {
    seedProjects([PROJECT_A]);
    await mountNode(<ModalHarness />);
    await openFromOpener();
    await openPanel();
    expect(isPanelOpen()).toBe(true);

    await pressEscape();
    expect(isPanelOpen(), "第一次 Escape 只关 Popover").toBe(false);
    expect(modalDialog(), "外层弹窗仍在").not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await pressEscape();
    expect(modalDialog(), "第二次 Escape 也不能关外层").not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("日程弹窗回焦", () => {
  it("打开后焦点进入弹窗", async () => {
    await mountNode(<ModalHarness />);
    await openFromOpener();
    const dialog = modalDialog();
    expect(dialog).not.toBeNull();
    expect(
      dialog?.contains(document.activeElement),
      "焦点必须落在弹窗内（Radix FocusScope 的默认行为）",
    ).toBe(true);
  });

  it("关闭后焦点回到 opener", async () => {
    await mountNode(<ModalHarness />);
    await openFromOpener();
    await click(dialogCloseButton() as HTMLButtonElement);
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement, "关闭后必须回到 opener").toBe(
      openerButton(),
    );
  });

  it("opener 已被移除时走 onRestoreFocus fallback（真实可聚焦节点）", async () => {
    const onRestoreFocus = vi.fn();
    await mountNode(<ModalHarness onRestoreFocus={onRestoreFocus} />);
    await openFromOpener();
    // 同一组件类型重渲染保留 open 状态，只是把 opener 摘掉（列表刷新 / 删除）
    await rerender(
      <ModalHarness onRestoreFocus={onRestoreFocus} showOpener={false} />,
    );
    await click(dialogCloseButton() as HTMLButtonElement);
    await flush();
    expect(
      onRestoreFocus,
      "回不到原目标时用父级 fallback",
    ).toHaveBeenCalledTimes(1);
    const fallback = container.querySelector('[data-testid="fallback"]');
    expect(fallback, "fallback 节点必须存在").not.toBeNull();
    expect(document.activeElement, "fallback 节点必须拿到焦点").toBe(fallback);
  });

  it("Tab 边界：最后一个 tabbable 上按 Tab 回绕到第一个（FocusScope 边界）", async () => {
    await mountNode(<ModalHarness />);
    await openFromOpener();
    const dialog = modalDialog();
    expect(dialog).not.toBeNull();

    const nodes = tabbables(dialog as HTMLElement);
    expect(
      nodes.length,
      "弹窗里必须有多个可聚焦项才谈得上边界",
    ).toBeGreaterThan(1);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];

    last.focus();
    expect(document.activeElement, "先站在最后一个 tabbable 上").toBe(last);
    await act(async () => {
      last.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flush();

    expect(
      document.activeElement,
      "最后一个 tabbable 上 Tab 必须回绕到第一个（不是只断言 containment）",
    ).toBe(first);
  });
});

/**
 * ScheduleView 侧的回焦接线（源码扫描，不搭 IPC 桩 —— 与 Task 1 的
 * SettingsSkills 接线同一条理由：挂载 ScheduleView 要拉起整套 schedule IPC）。
 */
describe("ScheduleView 的回焦接线", () => {
  const src = (): string =>
    fs.readFileSync(path.join(RENDERER, "components/ScheduleView.tsx"), "utf8");

  it("根容器是可聚焦的 fallback（ref + tabIndex=-1），不隐藏原生焦点", () => {
    const source = src();
    expect(source.length).toBeGreaterThan(1000);
    // 不锁死换行形状（prettier 会把长 className 折行），只锁「同一个开标签上两件套都在」
    expect(source, "根容器必须是 ref=rootRef + tabIndex=-1").toMatch(
      /ref=\{rootRef\}\s+tabIndex=\{-1\}/,
    );
    expect(source, "rootRef 必须是 HTMLDivElement ref").toContain(
      "const rootRef = useRef<HTMLDivElement>(null)",
    );
    const start = source.search(/ref=\{rootRef\}/);
    expect(start, "找不到根容器的 ref").toBeGreaterThan(-1);
    const tag = source.slice(start, source.indexOf(">", start));
    expect(tag, "根容器不得隐藏原生焦点可见性").not.toContain("outline");
  });

  it("传入的 onRestoreFocus 聚焦根容器且带 preventScroll", () => {
    expect(src()).toContain(
      "onRestoreFocus={() => rootRef.current?.focus({ preventScroll: true })}",
    );
  });
});

// ---------------------------------------------------------------------------
// 异步保存 / 删除期间的关闭矩阵（真实 useScheduleForm + schedule 服务桩）
// ---------------------------------------------------------------------------
function installScheduleService(): {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    schedule: { create, update, delete: remove, list: vi.fn(async () => []) },
  };
  return { create, update, remove };
}

/** 后天 + 09:00（弹窗把 prefillDate 拼成 `YYYY-MM-DD T09:00` ⇒ 必须留足余量，
 *  否则当天的 09:00 已经过去，submitTask 会以 futureTimeRequired 提前返回）。 */
function futurePrefill(): Date {
  return new Date(Date.now() + 48 * 60 * 60 * 1000);
}

const EDIT_TASK: ScheduleTask = {
  id: "task-1",
  title: "probe",
  prompt: "do things",
  cwd: "/Users/me/alpha-project",
  runAt: Date.now() + 60 * 60 * 1000,
  nextRunAt: null,
  scheduleConfig: null,
  repeatEvery: null,
  repeatUnit: null,
  enabled: true,
  lastRunAt: null,
  lastRunSessionId: null,
  lastError: null,
  createdAt: 0,
  updatedAt: 0,
};

/** 在新建弹窗里打字（native setter，否则 React 的 _valueTracker 抑制 onChange）。 */
async function typePrompt(value: string): Promise<void> {
  const box = modalDialog()?.querySelector<HTMLTextAreaElement>("textarea");
  if (!box) throw new Error("prompt 文本域必须存在");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function saveButton(): HTMLButtonElement {
  const el = dialogButtonByText(i18n.t("schedule.createTask"));
  if (!el) throw new Error("保存按钮必须存在");
  return el;
}

describe("日程弹窗：异步保存 / 删除期间的关闭矩阵", () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("提交挂起（busy=true）：保存与「删除」禁用，但 X / 取消 / 遮罩仍各关闭一次", async () => {
    for (const kind of ["X", "取消", "遮罩"] as const) {
      const svc = installScheduleService();
      svc.create.mockReturnValue(new Promise(() => {})); // 永久挂起
      await mountNode(<ModalHarness prefillDate={futurePrefill()} />);
      await openFromOpener();

      await typePrompt("probe prompt");
      const save = saveButton();
      await click(save);
      expect(svc.create, "提交必须真的发出").toHaveBeenCalledTimes(1);
      expect(save.disabled, "busy 时保存禁用").toBe(true);
      const cancel = dialogButtonByText(i18n.t("common.cancel"));
      expect(cancel?.disabled, "busy 时取消不禁用（矩阵：原取消保留）").toBe(
        false,
      );

      if (kind === "X") {
        await click(dialogCloseButton() as HTMLButtonElement);
      } else if (kind === "取消") {
        await click(cancel as HTMLButtonElement);
      } else {
        await clickOverlay();
      }
      await flush();

      expect(onClose, `busy 时 ${kind} 必须关闭一次`).toHaveBeenCalledTimes(1);
      expect(modalDialog()).toBeNull();
      expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);

      act(() => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
      onClose.mockClear();
      onSaved.mockClear();
    }
  });

  it("提交成功：载荷不变、onSaved 与 onClose 各一次", async () => {
    const svc = installScheduleService();
    svc.create.mockResolvedValue({ id: "created" });
    await mountNode(<ModalHarness prefillDate={futurePrefill()} />);
    await openFromOpener();
    await typePrompt("probe prompt");

    await click(saveButton());
    await flush();

    expect(svc.create).toHaveBeenCalledTimes(1);
    const payload = svc.create.mock.calls[0][0] as {
      prompt: string;
      runAt: number;
    };
    expect(payload.prompt).toBe("probe prompt");
    expect(payload.runAt, "runAt 仍是未来的时间戳").toBeGreaterThan(Date.now());
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(modalDialog()).toBeNull();
  });

  it("提交失败（service reject）：弹窗不关闭、输入保留、错误可见、不触发 onSaved/onClose", async () => {
    const svc = installScheduleService();
    svc.create.mockRejectedValue(new Error("disk full"));
    await mountNode(<ModalHarness prefillDate={futurePrefill()} />);
    await openFromOpener();
    await typePrompt("probe prompt");
    const runAtBefore =
      modalDialog()?.querySelector<HTMLInputElement>(
        'input[type="date"]',
      )?.value;
    expect(runAtBefore, "prefill 的日期必须已填好").toBeTruthy();

    await click(saveButton());
    await flush();

    expect(svc.create, "请求确实发出去了").toHaveBeenCalledTimes(1);
    // brief「失败不丢输入」：submitTask 在内部 catch 写 form.error 后正常 return，
    // 关闭必须由真正的成功信号（hook 的 onSaved）驱动，而不是 await 之后无条件 onClose。
    expect(onClose, "保存失败不得关闭弹窗").not.toHaveBeenCalled();
    expect(onSaved, "失败不得触发 refresh").not.toHaveBeenCalled();
    const dialog = modalDialog();
    expect(dialog, "弹窗必须仍在").not.toBeNull();
    expect(
      dialog?.querySelector<HTMLTextAreaElement>("textarea")?.value,
      "prompt 原值必须保留",
    ).toBe("probe prompt");
    expect(
      dialog?.querySelector<HTMLInputElement>('input[type="date"]')?.value,
      "runAt 原值必须保留",
    ).toBe(runAtBefore);
    expect(alertText(dialog as HTMLElement), "失败原因必须可见").toContain(
      "disk full",
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    expect(saveButton().disabled, "失败后保存恢复可用").toBe(false);
  });

  it("校验失败（daily 无时间）：弹窗不关闭、输入保留、错误可见、不触发回调", async () => {
    const svc = installScheduleService();
    await mountNode(<ModalHarness prefillDate={futurePrefill()} />);
    await openFromOpener();
    await typePrompt("probe prompt");
    await click(
      dialogButtonByText(i18n.t("schedule.modeDaily")) as HTMLButtonElement,
    );
    // daily 模式默认选中 08:00，删掉它 ⇒ scheduleConfig 变 null ⇒ 触发 dailyTimesRequired
    const chipRemove = Array.from(
      modalDialog()?.querySelectorAll("button") ?? [],
    ).find((btn) => btn.textContent?.trim() === "×");
    expect(chipRemove, "08:00 chip 的删除键必须存在").toBeTruthy();
    await click(chipRemove as HTMLButtonElement);
    await flush();

    await click(saveButton());
    await flush();

    expect(svc.create, "校验失败不得发出请求").not.toHaveBeenCalled();
    expect(onClose, "校验失败不得关闭弹窗").not.toHaveBeenCalled();
    expect(onSaved, "校验失败不得触发 refresh").not.toHaveBeenCalled();
    const dialog = modalDialog();
    expect(dialog, "弹窗必须仍在").not.toBeNull();
    expect(
      dialog?.querySelector<HTMLTextAreaElement>("textarea")?.value,
      "prompt 原值必须保留",
    ).toBe("probe prompt");
    expect(alertText(dialog as HTMLElement), "校验错误必须可见").toContain(
      i18n.t("schedule.dailyTimesRequired"),
    );
  });

  it("删除挂起（busy=true）：确认删除禁用、取消回表单、X 仍可关闭一次", async () => {
    const svc = installScheduleService();
    svc.remove.mockReturnValue(new Promise(() => {}));
    await mountNode(<ModalHarness task={EDIT_TASK} />);
    await openFromOpener();

    await click(
      dialogButtonByText(i18n.t("common.delete")) as HTMLButtonElement,
    );
    await click(
      dialogButtonByText(i18n.t("schedule.confirmDelete")) as HTMLButtonElement,
    );
    expect(svc.remove).toHaveBeenCalledWith("task-1");
    await flush();
    expect(
      dialogButtonByText(i18n.t("schedule.confirmDelete"))?.disabled,
      "busy 时确认删除禁用",
    ).toBe(true);

    // 确认分支的「取消」只是回到表单（不是关闭弹窗），删除请求仍在飞
    await click(
      dialogButtonByText(i18n.t("common.cancel")) as HTMLButtonElement,
    );
    await flush();
    expect(onClose, "确认分支的取消不该关闭弹窗").not.toHaveBeenCalled();
    expect(modalDialog()).not.toBeNull();
    expect(
      modalDialog()?.querySelector("textarea"),
      "必须回到表单视图",
    ).not.toBeNull();

    // busy 期间 X 仍允许关闭（矩阵：原 X 允许）
    await click(dialogCloseButton() as HTMLButtonElement);
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(modalDialog()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("删除成功：onClose 一次并释放 occlusion", async () => {
    const svc = installScheduleService();
    let resolveDelete!: (value: unknown) => void;
    svc.remove.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );
    await mountNode(<ModalHarness task={EDIT_TASK} />);
    await openFromOpener();
    await click(
      dialogButtonByText(i18n.t("common.delete")) as HTMLButtonElement,
    );
    await click(
      dialogButtonByText(i18n.t("schedule.confirmDelete")) as HTMLButtonElement,
    );

    await act(async () => {
      resolveDelete(undefined);
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();

    expect(svc.remove).toHaveBeenCalledWith("task-1");
    expect(onSaved, "删除成功也必须刷新列表一次").toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(modalDialog()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("删除失败：不关闭、确认分支可见错误、回到表单后草稿保留", async () => {
    const svc = installScheduleService();
    svc.remove.mockRejectedValue(new Error("delete failed"));
    await mountNode(<ModalHarness task={EDIT_TASK} />);
    await openFromOpener();
    // 先改草稿：删除失败后不能把用户编辑的内容丢掉
    await typePrompt("edited draft");
    await click(
      dialogButtonByText(i18n.t("common.delete")) as HTMLButtonElement,
    );
    await click(
      dialogButtonByText(i18n.t("schedule.confirmDelete")) as HTMLButtonElement,
    );
    await flush();

    expect(onClose, "删除失败不得关闭弹窗").not.toHaveBeenCalled();
    const dialog = modalDialog();
    expect(dialog, "弹窗必须仍在").not.toBeNull();
    expect(dialog?.querySelector("p")?.textContent, "仍在确认分支").toContain(
      i18n.t("schedule.deleteConfirmTitle"),
    );
    // 确认分支原先不渲染 form.error ⇒ 失败原因不可见；现在必须可见（role=alert 小 banner）
    expect(
      alertText(dialog as HTMLElement),
      "确认分支失败原因必须可见",
    ).toContain("delete failed");
    expect(
      dialogButtonByText(i18n.t("schedule.confirmDelete"))?.disabled,
      "失败后确认按钮必须恢复可用",
    ).toBe(false);

    // 取消回表单：草稿仍在
    await click(
      dialogButtonByText(i18n.t("common.cancel")) as HTMLButtonElement,
    );
    await flush();
    expect(modalDialog(), "取消只是回表单").not.toBeNull();
    expect(
      modalDialog()?.querySelector<HTMLTextAreaElement>("textarea")?.value,
      "删除失败后草稿必须保留",
    ).toBe("edited draft");
  });
});
