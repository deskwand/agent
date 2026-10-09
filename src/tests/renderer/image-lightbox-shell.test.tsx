// @vitest-environment jsdom
//
// ImageLightbox 的外壳不变量。
//
// 它是全屏查看器，不是标准弹窗：z-[100]（必须在标准弹窗 z-50 之上）、
// 自建键盘映射、缩放/平移、body 滚动锁。本任务只迁外壳。
//
// 两条最容易出错的：
//   1. Esc 只能**调一次** onClose —— 键盘映射里那个 case "Escape" 必须删掉，
//      否则 Radix（document 捕获阶段）与它（window）各调一次
//   2. z-index 不能降 —— 降了会被其他弹窗盖住
import "../../renderer/i18n/config";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { ImageLightbox } from "../../renderer/components/ImageLightbox";
import { setupDialogTest } from "../dialog-test-helpers";

const onClose = vi.fn();

// ImageSource 的真实形状（已核实 ImageLightbox.tsx:22）：
//   { src: string; name?: string; filePath?: string }
// **没有 alt** —— 所以标题只能用 name。
const images = [
  { src: "https://example.com/a.png", name: "a.png" },
  { src: "https://example.com/b.png", name: "b.png" },
] as never;

/**
 * 脚手架来自 tests/dialog-test-helpers.ts（计划 3）。
 * 它返回的名字与本文件原本用的局部名字一致。
 */
let d: ReturnType<typeof setupDialogTest>;
let render: (node: ReactNode) => Promise<void>;
let shell: () => Element | null;

function mount(over: Record<string, unknown> = {}) {
  return render(
    <ImageLightbox isOpen images={images} onClose={onClose} {...over} />,
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onClose.mockClear();
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  d = setupDialogTest();
  ({ render, shell } = d);
});

afterEach(() => {
  d.teardown();
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.unstubAllGlobals();
});

describe("ImageLightbox 外壳", () => {
  it("isOpen 时占用 occlusion，关闭时释放", async () => {
    await mount();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);

    await render(
      <ImageLightbox isOpen={false} images={images} onClose={onClose} />,
    );
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("卸载时释放 occlusion", async () => {
    await mount();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(1);
    await render(<div />);
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("images 为空时不渲染", async () => {
    await render(<ImageLightbox isOpen images={[]} onClose={onClose} />);
    expect(shell()).toBeNull();
    expect(useAppStore.getState().browserOcclusionIds.size).toBe(0);
  });

  it("Esc 恰好调一次 onClose（不能两次）【Review Focus #4】", async () => {
    // 本任务的核心风险点。原实现自己有一个 window 级 keydown，
    // case "Escape" 里调 onClose；Radix 也会处理 Esc（document 捕获阶段）。
    // 不删那个 case 的话这里会收到 2 次。
    await mount();
    expect(shell(), "查看器必须先存在（否则这条会空断言成真）").not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onClose, "Esc 必须恰好调一次").toHaveBeenCalledTimes(1);
  });

  it("容器仍是 z-[100]（高于标准弹窗的 z-50）【Review Focus #5】", async () => {
    // 降级会让查看器被其他弹窗盖住 —— 这是纯 CSS，jsdom 看不出层级，
    // 所以只能断言类名本身。
    await mount();
    const content = shell();
    expect(content, "内容必须存在").not.toBeNull();
    expect(content!.className, "z-100 必须保留").toContain("z-[100]");
  });

  it("左/右方向键仍能切图（键盘映射只该丢掉 Esc 那一个 case）", async () => {
    await mount();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    // 只要不抛异常、且弹窗还在（说明方向键没被当成关闭）即可；
    // 切到第几张由既有的 image-lightbox-toolbar 测试覆盖。
    expect(shell(), "方向键不该关掉查看器").not.toBeNull();
  });
});
