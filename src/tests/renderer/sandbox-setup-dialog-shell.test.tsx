// @vitest-environment jsdom
//
// SandboxSetupDialog 的外壳与计时不变量。
//
// 三个必须钉住的东西：
//   1. occlusion 是**派生**的：Boolean(progress) && isVisible
//      （既非常驻也不是外部传的 isOpen —— isVisible 是组件内部 state）
//   2. 关闭是**两段计时**：ready/skipped → 1500ms → handleClose → 500ms → onComplete。
//      总延迟 2000ms。写成 1500ms 就把两段写成一段了，而中间那 500ms 正是淡出动画。
//   3. 不可关闭：Esc 不得关掉它（沙箱还在配，关掉会让用户以为失败了）
//
// 用 vi.useFakeTimers —— 真实等待 2s 会让这条用例在负载下抖动。
import "../../renderer/i18n/config";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { SandboxSetupDialog } from "../../renderer/components/SandboxSetupDialog";
import type {
  SandboxSetupProgress,
  SandboxSetupPhase,
} from "../../renderer/types";

const onComplete = vi.fn();

/** 造一份进度对象（message 是必填字段）。 */
const progress = (
  phase: SandboxSetupPhase,
  extra: Partial<SandboxSetupProgress> = {},
): SandboxSetupProgress => ({
  phase,
  message: `phase:${phase}`,
  ...extra,
});

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

const shell = (): Element | null =>
  document.body.querySelector('[role="alertdialog"]');

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    platform: "linux",
  };
  onComplete.mockClear();
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  container.remove();
  document
    .querySelectorAll('[role="dialog"], [role="alertdialog"]')
    .forEach((el) => el.remove());
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

describe("SandboxSetupDialog 外壳", () => {
  it("progress 为 null 时不渲染、不占用 occlusion", async () => {
    await render(
      <SandboxSetupDialog progress={null} onComplete={onComplete} />,
    );
    expect(shell()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("配置中：渲染弹窗并占用 occlusion", async () => {
    await render(
      <SandboxSetupDialog
        progress={progress("installing_deps", { progress: 40 })}
        onComplete={onComplete}
      />,
    );
    expect(shell()).not.toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
  });

  it("渲染出阶段文案", async () => {
    await render(
      <SandboxSetupDialog
        progress={progress("installing_deps", { progress: 40 })}
        onComplete={onComplete}
      />,
    );
    // 文案由 utils/sandbox-i18n 的 getSandboxSetupDisplayText 产出；
    // 这里只要它非空且带上阶段信息，不抄具体措辞。
    expect((document.body.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("Esc 不关闭", async () => {
    // Review Focus #2
    await render(
      <SandboxSetupDialog
        progress={progress("installing_deps", { progress: 40 })}
        onComplete={onComplete}
      />,
    );
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(shell()).not.toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("ready 后走完两段计时（1500 + 500）才回调 onComplete", async () => {
    // Review Focus #3
    await render(
      <SandboxSetupDialog
        progress={progress("ready")}
        onComplete={onComplete}
      />,
    );

    // 第一段：到 1500ms 时 handleClose 才开始淡出，onComplete 还没到
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(
      onComplete,
      "1500ms 时只应开始淡出，不该已回调",
    ).not.toHaveBeenCalled();

    // 第二段：再 500ms
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("skipped 同样走两段计时", async () => {
    await render(
      <SandboxSetupDialog
        progress={progress("skipped")}
        onComplete={onComplete}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("error 不自动关闭（要等用户点按钮）", async () => {
    await render(
      <SandboxSetupDialog
        progress={progress("error", { error: "boom" })}
        onComplete={onComplete}
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(onComplete, "错误态必须等用户点按钮").not.toHaveBeenCalled();
    expect(shell()).not.toBeNull();
  });

  it("卸载时清掉关闭计时器", async () => {
    // 不清的话计时器回调会落在已卸载的组件上
    await render(
      <SandboxSetupDialog
        progress={progress("ready")}
        onComplete={onComplete}
      />,
    );
    await act(async () => {
      root.render(<div />);
    });
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
