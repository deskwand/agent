// @vitest-environment jsdom
//
// PromptCommandFormModal 的外壳与两段式 Esc。
//
// 两段式 Esc 是这个组件既有的、有注释写明的契约：
//   搜索框里有词 → 第一次 Esc 只清搜索；再按一次才关表单。
//
// 为什么必须在**外壳层**测它：组件原来的实现是 document 级监听，
// 而 Radix 的 Esc 监听也在 document 上且在捕获阶段，会抢先关闭表单。
// 既有的 prompt-command-form-modal.test.ts 是孤立挂载组件的，看不见这个干扰。
import "../../renderer/i18n/config";
import i18n from "../../renderer/i18n/config";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { PromptCommandFormModal } from "../../renderer/components/attach/PromptCommandFormModal";
// 弹窗测试脚手架（本计划 Task 1）：container / render / shell / buttons /
// buttonByLabel / builtinCloseButton / portal 清理都由它提供，本文件不再自己搭
import { setupDialogTest } from "../dialog-test-helpers";

const onClose = vi.fn();
const onSave = vi.fn();

const initial = { name: "demo", displayName: "demo", content: "hi" };

/**
 * 脚手架来自 tests/dialog-test-helpers.ts（本计划 Task 1）。
 * 它返回的名字与本文件原本用的局部名字一致，所以下面的测试体逐字未改。
 */
let d: ReturnType<typeof setupDialogTest>;
let container: HTMLDivElement;
let render: (node: ReactNode) => Promise<void>;
let shell: () => Element | null;

function mount(
  over: Partial<Parameters<typeof PromptCommandFormModal>[0]> = {},
) {
  return render(
    <PromptCommandFormModal
      mode="create"
      initial={initial}
      saving={false}
      onSave={onSave}
      onClose={onClose}
      {...over}
    />,
  );
}

/**
 * 打开「引用技能」列表，让那个搜索框出现。
 * 两个 key 都已核对过 src/renderer/components/attach/PromptCommandFormModal.tsx：
 *   - 触发按钮文案是 chat.commandInsertSkill
 *   - 搜索框的 aria-label 是 chat.commandSkillSearchPlaceholder
 */
async function openSkillList(): Promise<HTMLInputElement> {
  const trigger = Array.from(document.body.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").includes(i18n.t("chat.commandInsertSkill")),
  );
  expect(trigger, "「引用技能」按钮必须存在").toBeTruthy();
  await act(async () => {
    trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const search = document.body.querySelector<HTMLInputElement>(
    `input[aria-label="${i18n.t("chat.commandSkillSearchPlaceholder")}"]`,
  );
  expect(search, "技能搜索框必须存在").not.toBeNull();
  return search!;
}

/** 派发一次可取消的 Esc（陷阱 2：非 cancelable 的话 preventDefault 无效）。 */
async function pressEscape(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onClose.mockClear();
  onSave.mockClear();
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  d = setupDialogTest();
  ({ container, render, shell } = d);
});

afterEach(() => {
  // 卸载 + 移除本地 container + 清 portal 节点，全在 teardown 里（见 Task 1）
  d.teardown();
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

describe("PromptCommandFormModal 外壳", () => {
  it("挂载即占用 occlusion（无 isOpen，由父级条件渲染）", async () => {
    await mount();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
  });

  it("卸载时释放 occlusion", async () => {
    await mount();
    await render(<div />);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("外部点击不关闭（原实现遮罩上没有 onClick）", async () => {
    await mount();
    await act(async () => {
      container.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      container.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      container.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(onClose, "遮罩点击不得关闭").not.toHaveBeenCalled();
    expect(shell()).not.toBeNull();
  });

  it("Esc 关闭（搜索框为空时）", async () => {
    await mount();
    await pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("两段式 Esc：搜索框有词时第一次只清搜索、第二次才关", async () => {
    // Review Focus #1。这是本任务的核心风险点。
    await mount();
    const search = await openSkillList();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "pdf");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // 第一次 Esc：只清搜索
    await pressEscape();
    expect(onClose, "第一次 Esc 不得关闭").not.toHaveBeenCalled();
    expect(shell(), "表单必须还在").not.toBeNull();

    // 第二次 Esc：关闭（恰好一次）
    await pressEscape();
    expect(onClose, "第二次 Esc 应当关闭").toHaveBeenCalledTimes(1);
  });
});
