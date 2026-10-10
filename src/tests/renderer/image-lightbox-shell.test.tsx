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
import i18n from "../../renderer/i18n/config";
import { act, forwardRef, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { ImageLightbox } from "../../renderer/components/ImageLightbox";
import { setupDialogTest } from "../dialog-test-helpers";
import type * as DialogUiModule from "../../renderer/components/ui/dialog";

// 「关闭键必须是 shadcn 的 DialogClose」这条要求在 jsdom 里观察不到 ——
// DialogClose 与自绘 `onClick={onClose}` 都是「一个按钮、点一下关掉」。
// 所以包一层代理：渲染过就记一笔，然后原样委托给真的 DialogClose
// （asChild / ref / Radix 上下文都走原实现）。其余导出（DialogContent 等）保持真实。
const { dialogCloseRenders } = vi.hoisted(() => ({
  dialogCloseRenders: { count: 0 },
}));
vi.mock("../../renderer/components/ui/dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof DialogUiModule>();
  const RealDialogClose = actual.DialogClose;
  return {
    ...actual,
    DialogClose: forwardRef<
      HTMLButtonElement,
      ComponentProps<typeof RealDialogClose>
    >((props, ref) => {
      dialogCloseRenders.count += 1;
      return <RealDialogClose {...props} ref={ref} />;
    }),
  };
});

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
    // 切到第几张暂无专测，工具条相关的不变量在 image-lightbox-toolbar-anchor.test.tsx。
    expect(shell(), "方向键不该关掉查看器").not.toBeNull();
  });
});

// 关闭键只能有一个（2026-10-10 用户截图发现：窗口右上角还有个多余的 ✕）。
//
// vendored DialogContent 末尾总会画一个 `absolute right-4 top-4` 的角标（shadcn 的
// DialogClose，可访问名是上游硬编码的英文 "Close"）；本查看器的关闭键在图片右上角的
// 工具条里（与复制同一簇、label 走 i18n）。⇒ 在调用点用 `[&>button]:hidden` 藏掉角标，
// 工具条那一处改成 Radix 的 `DialogClose asChild`，两处的关闭路径从此是同一条
// （DialogClose → onOpenChange(false) → onClose）。
describe("图片预览的关闭键", () => {
  const closeLabel = (): string => i18n.t("imageLightbox.close");

  it("DialogContent 内置的角标关闭键在调用点被屏蔽", async () => {
    await mount();
    const content = shell();
    expect(content, "内容必须存在").not.toBeNull();
    // jsdom 不跑 CSS，所以断言的是那条类名本身（同本文件 z-[100] 的写法）。
    expect(
      content!.className,
      "必须屏蔽 DialogContent 的内置角标，否则预览里有两个关闭键",
    ).toContain("[&>button]:hidden");
    // 角标仍在 DOM 里（由 CSS 隐藏），且它是 DialogContent 唯一直接子 button ——
    // 即这个选择器不会误伤工具条里的按钮（它们在 absolute w-0 h-0 锚点容器里）。
    const directButtons = Array.from(
      document.body.querySelectorAll('[role="dialog"] > button'),
    );
    expect(directButtons).toHaveLength(1);
  });

  it("工具条里恰好一个关闭键，点它恰好调一次 onClose", async () => {
    await mount();
    const toolbar = document.body.querySelector(
      '[data-testid="image-lightbox-toolbar"]',
    );
    expect(toolbar, "工具条必须渲染出来").not.toBeNull();
    const closeButtons = Array.from(toolbar!.querySelectorAll("button")).filter(
      (button) => button.getAttribute("aria-label") === closeLabel(),
    );
    expect(closeButtons, "工具条里的关闭键必须恰好一个").toHaveLength(1);

    await act(async () => {
      closeButtons[0].click();
    });
    expect(
      onClose,
      "关闭键必须经 DialogClose → onOpenChange → onClose 关掉预览",
    ).toHaveBeenCalledTimes(1);
  });

  it("关闭键来自 shadcn 的 DialogClose，而不是自绘 onClick", async () => {
    await mount();
    expect(
      dialogCloseRenders.count,
      "工具条的关闭键必须渲染自 ui/dialog 的 DialogClose（改回 onClick={onClose} 会让这条失败）",
    ).toBeGreaterThan(0);
  });
});
