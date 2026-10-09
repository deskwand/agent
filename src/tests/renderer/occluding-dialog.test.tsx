// @vitest-environment jsdom
//
// occlusion 包装组件的不变量。
//
// 为什么这层包装必须存在（spec §6.2）：`useBrowserOcclusion` 是 store 里的引用计数，
// 用来在内置浏览器面板打开时把弹窗盖在它上面。原先 14 个弹窗各自手写调用 ——
// 漏一处**不报错、不红测试**，只在浏览器面板可见时静默被盖住。
// 包装组件把「纪律」变成「结构」：新弹窗天然继承。
//
// 本文件同时是 spec U2 的验证：两个包装组件同时打开再依次关闭，
// 计数必须正确收敛到 0（引用计数不被提前归零）。
//
// 覆盖的失败模式（对应计划 Review Focus）：
//   #1 弹窗打开期间父组件被卸载 → 计数必须释放，否则浏览器面板永久隐藏
//   #2 open=false 挂载 → 不应占用计数
//   #3 状态变更关闭（Esc / 遮罩点击都走这条 onOpenChange 分岔点）→ 必须释放
//   #4 两个包装同时打开再依次关闭 → 计数正确收敛
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import {
  OccludingAlertDialog,
  OccludingDialog,
} from "../../renderer/components/ui/occluding-dialog";
import {
  AlertDialogContent,
  AlertDialogTitle,
} from "../../renderer/components/ui/alert-dialog";
import {
  DialogContent,
  DialogTitle,
} from "../../renderer/components/ui/dialog";

function occlusionCount(): number {
  return useAppStore.getState().browserOcclusionIds.size;
}

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
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

describe("OccludingDialog", () => {
  it("acquires occlusion while open", async () => {
    await render(
      <OccludingDialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogTitle>t</DialogTitle>
        </DialogContent>
      </OccludingDialog>,
    );
    expect(occlusionCount()).toBe(1);
  });

  it("does not acquire occlusion when mounted closed", async () => {
    // Review Focus #2：open=false 挂载不应占用计数
    await render(
      <OccludingDialog open={false} onOpenChange={() => {}}>
        <DialogContent>
          <DialogTitle>t</DialogTitle>
        </DialogContent>
      </OccludingDialog>,
    );
    expect(occlusionCount()).toBe(0);
  });

  it("releases occlusion when open flips to false", async () => {
    // Review Focus #3 的分岔点：Esc 与遮罩点击最终都经由 onOpenChange
    // 让父级翻转 open，因此这条覆盖的是那条释放路径本身。
    function Harness(): JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            close
          </button>
          <OccludingDialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogTitle>t</DialogTitle>
            </DialogContent>
          </OccludingDialog>
        </>
      );
    }
    await render(<Harness />);
    expect(occlusionCount()).toBe(1);

    const btn = container.querySelector("button")!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(occlusionCount()).toBe(0);
  });

  it("releases occlusion when unmounted while open", async () => {
    // Review Focus #1：父组件在弹窗打开时被卸载 —— 不释放会让浏览器面板永久隐藏
    await render(
      <OccludingDialog open onOpenChange={() => {}}>
        <DialogContent>
          <DialogTitle>t</DialogTitle>
        </DialogContent>
      </OccludingDialog>,
    );
    expect(occlusionCount()).toBe(1);

    await act(async () => {
      root.render(<div />);
    });
    expect(occlusionCount()).toBe(0);
  });
});

describe("两个弹窗同时打开（spec U2）", () => {
  it("keeps occlusion until the last one closes", async () => {
    function Harness(): JSX.Element {
      const [a, setA] = useState(true);
      const [b, setB] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setA(false)}>
            close-a
          </button>
          <button type="button" onClick={() => setB(false)}>
            close-b
          </button>
          <OccludingDialog open={a} onOpenChange={setA}>
            <DialogContent>
              <DialogTitle>a</DialogTitle>
            </DialogContent>
          </OccludingDialog>
          <OccludingAlertDialog open={b} onOpenChange={setB}>
            <AlertDialogContent>
              <AlertDialogTitle>b</AlertDialogTitle>
            </AlertDialogContent>
          </OccludingAlertDialog>
        </>
      );
    }
    await render(<Harness />);
    expect(occlusionCount()).toBe(2);

    const [closeA, closeB] = Array.from(container.querySelectorAll("button"));
    await act(async () => {
      closeA.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(occlusionCount()).toBe(1);

    await act(async () => {
      closeB.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(occlusionCount()).toBe(0);
  });
});
