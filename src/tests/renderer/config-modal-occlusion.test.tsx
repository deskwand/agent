// @vitest-environment jsdom
//
// ConfigModal 迁移后新增了 occlusion。
//
// 迁移前它有 `modal-overlay` 外壳但**漏了** useBrowserOcclusion —— 它是 14 个
// 弹窗里唯一缺失 occlusion 的那个（既有实现的不一致）。迁到 OccludingDialog 后
// 它自动获得 occlusion。
//
// 本测试把「新增 occlusion」显式钉住：如果日后有人把它当成回归去掉，
// 这里会红，并留下判断依据。
//
// 查询作用域是 `document.body`：Radix 经 Portal 挂载（见 confirm-dialog.test.tsx）。
//
// 关于关闭键：迁移后不再自己渲染右上角的 X，改用 shadcn DialogContent 内置的那个。
// 原实现自己有一个，若两个都留会在同一角落叠出两个关闭键；用 CSS 去隐藏内置键
// 既难测（jsdom 不加载 Tailwind 样式表，getComputedStyle 拿不到 display）
// 又是不必要的 hack。D2 已接受 shadcn 默认观感，故直接采用内置键。
import "../../renderer/i18n/config";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { ConfigModal } from "../../renderer/components/ConfigModal";

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
  document
    .querySelectorAll('[role="dialog"], [role="alertdialog"]')
    .forEach((el) => el.remove());
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

describe("ConfigModal", () => {
  it("occupies browser occlusion while open", async () => {
    await render(
      <ConfigModal isOpen onClose={() => {}} onSave={async () => {}} />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
  });

  it("releases occlusion when closed", async () => {
    await render(
      <ConfigModal isOpen={false} onClose={() => {}} onSave={async () => {}} />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("renders its content inside a dialog role", async () => {
    await render(
      <ConfigModal isOpen onClose={() => {}} onSave={async () => {}} />,
    );
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    // 内容仍在：设置面板的标题由 i18n 提供，断言非空即可
    expect((dialog?.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("closes through onClose when the dialog reports a close", async () => {
    // 「父级必须翻 isOpen」契约的守卫见 confirm-dialog.test.tsx；
    // 这里只锁 onOpenChange → onClose 的接线本身。
    const onClose = vi.fn();
    await render(
      <ConfigModal isOpen onClose={onClose} onSave={async () => {}} />,
    );

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalled();
  });
});
