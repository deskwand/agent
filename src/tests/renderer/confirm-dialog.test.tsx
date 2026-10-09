// @vitest-environment jsdom
//
// ConfirmDialog 迁移后的行为不变量。
//
// 迁移前它手写遮罩 + 焦点管理 + occlusion；迁移后由 shadcn AlertDialog 承担外壳，
// 本测试锁的是「外壳换了，语义没变」：
//   - 打开时 occlusion 生效（原先由组件内部手写调用，现在由包装组件承担）
//   - tone="danger" / tone="primary" 两种语气都还在，且效果不同
//   - 确认与取消都回调
//   - 文案走 i18n（不硬编码中文）
//
// 为什么用 AlertDialog 而不是 Dialog：确认框是「必须回应」的阻塞场景，
// Radix 的 AlertDialog 语义（焦点锁在动作上、不响应遮罩点击关闭）更贴合，
// 这也是迁移前该组件唯一的行为（没有点击遮罩关闭）。
//
// i18n：本仓没有 vitest setupFiles，而这是第一个渲染带 useTranslation 组件的
// 测试。i18n/config 是 import 即初始化（副作用），所以这里显式 import 它。
//
// ⚠️ 查询作用域是 `document.body` 而不是本文件的 container：
// Radix 的 AlertDialogContent 经 **Portal 挂到 document.body**，不再内联在父容器里
//（原实现在 container 内）。这是迁移带来的真实行为差异，也是 Radix 默认。
// 计划 2 的其余 12 个弹窗迁移时，其测试同样需要改这个作用域。
import "../../renderer/i18n/config";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { ConfirmDialog } from "../../renderer/components/ConfirmDialog";

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  // Portal 的内容挂在 document.body 上，unmount 时 Radix 会清理；
  // 这里只清掉可能残留的弹窗节点，避免跨用例污染
  document
    .querySelectorAll(
      '[role="alertdialog"], [data-radix-popper-content-wrapper]',
    )
    .forEach((el) => el.remove());
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

function buttons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll("button"));
}

describe("ConfirmDialog", () => {
  it("renders the title and both actions", async () => {
    await render(
      <ConfirmDialog
        isOpen
        title="删除这个项目？"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.body.textContent).toContain("删除这个项目？");
    expect(buttons().length).toBeGreaterThanOrEqual(2);
  });

  it("occupies browser occlusion while open", async () => {
    // 迁移前这是组件内部手写的 useBrowserOcclusion(isOpen)；
    // 迁移后由 OccludingAlertDialog 承担，行为必须一致。
    await render(
      <ConfirmDialog
        isOpen
        title="t"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
  });

  it("releases browser occlusion when closed", async () => {
    await render(
      <ConfirmDialog
        isOpen={false}
        title="t"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("calls onConfirm and onCancel", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    await render(
      <ConfirmDialog
        isOpen
        title="t"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    // 第一个动作键是取消，最后一个是确认（与迁移前的 DOM 顺序一致）
    const all = buttons();
    await act(async () => {
      all[all.length - 1].dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => {
      all[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("honours the confirmLabel override", async () => {
    await render(
      <ConfirmDialog
        isOpen
        title="t"
        confirmLabel="确认删除"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.body.textContent).toContain("确认删除");
  });

  it("releases browser occlusion when Escape closes it", async () => {
    // Esc 的真实事件路径。Radix 的 escape-keydown 挂在 document 上，路径是
    // Esc → Radix → onOpenChange(false) → onCancel → 父级翻 isOpen → release。
    //
    // ⚠️ 必须用带状态的 Harness：本组件的 isOpen 是**父级受控**的，
    // 传字面量 true 的话，onOpenChange(false) 只会调 onCancel，
    // isOpen 不会变，弹窗不关、occlusion 也不释放。
    // 「父级必须翻 isOpen」是调用方的契约，不是本组件的缺陷。
    //
    // 这条在迁移前预期是红的（旧实现没有键盘处理），迁移后转绿。
    function Harness(): JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <ConfirmDialog
          isOpen={open}
          title="t"
          onConfirm={() => {}}
          onCancel={() => setOpen(false)}
        />
      );
    }
    await render(<Harness />);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("gives the two tones different styling", async () => {
    // tone 的有效性：danger 与 primary 必须产出不同的确认键样式。
    //
    // 不断言具体类名（例如「应含 bg-error」）—— D2 明确接受观感随 shadcn 变，
    // 锁死类名会在下次升级 vendored 组件时变成假红。
    await render(
      <ConfirmDialog
        isOpen
        title="t"
        tone="danger"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const danger = buttons()[buttons().length - 1].className;

    await render(
      <ConfirmDialog
        isOpen
        title="t"
        tone="primary"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const primary = buttons()[buttons().length - 1].className;

    expect(danger).not.toBe(primary);
  });
});
