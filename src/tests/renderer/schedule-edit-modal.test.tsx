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
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../renderer/i18n/config";
import { ScheduleEditModal } from "../../renderer/components/ScheduleEditModal";
import { useAppStore } from "../../renderer/store";
import type { Session } from "../../renderer/types";

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
 * ⚠️ 只在本用例自己的 container 里查，不在 `document.body` 里找「第一颗按钮」：
 * 跨用例的残留节点会混进来。
 */
function findTrigger(): HTMLButtonElement | null {
  const icon = container.querySelector("button svg.lucide-chevron-down");
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
