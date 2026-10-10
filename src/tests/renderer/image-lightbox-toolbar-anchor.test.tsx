// @vitest-environment jsdom
//
// 工具条锚点必须落在**弹层局部坐标**里。
//
// 现象（2026-10-10 用户报障）：「预览页面右上角的按钮都不见了」——
// 图片预览打开后，右上角的工具条（复制 / 用默认程序打开 / 关闭）整个看不见，
// 但元素在 DOM 里、`visibility: visible`，只是 left/top 把工具条放到了视口外。
//
// 根因：measureToolbarAnchor 用 getBoundingClientRect 量到的是**视口**坐标，
// 而 left/top 由弹层的布局盒解析。vendored DialogContent 打开时自带
// `slide-in-from-left-1/2 slide-in-from-top-[48%] zoom-in-95`，图片解码完
// （onLoad，即本文件的触发点）往往还在动画里，量到的就是动画变换后的位置，
// 写进去等于把同一个变换算了两次：实测图片右上角在 (1262.7, 81.9)，
// 写进 left/top 的却是 (455.3, -294.8) ⇒ 工具条落在 y = -344.8。
//
// 本文件把「动画进行中」这一刻用桩 rect 钉住 —— 修好之前它必须失败。
import i18n from "../../renderer/i18n/config";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../renderer/store";
import { ImageLightbox } from "../../renderer/components/ImageLightbox";
import { setupDialogTest } from "../dialog-test-helpers";

// 实测数字：视口 1568×819，图片的布局盒 304.28 / 81.91 / 958.44×655.19。
const CONTENT_LAYOUT_WIDTH = 1568;
/** 弹层在打开动画中的视觉盒子：由实测写进 left/top 的那组值反推、与之一致。 */
const ANIMATED_CONTENT = {
  left: -744.3248125,
  top: -372.6449375,
  width: 1489.6,
  height: 778.05,
};
/** 同一时刻图片（拖拽面）的视觉盒子。 */
const ANIMATED_IMAGE_BOX = {
  x: -455.257625,
  y: -294.834,
  width: 910.515625,
  height: 622.428125,
};
/** 图片右上角在弹层里的位置 —— 工具条唯一正确的锚点。 */
const IMAGE_LOCAL_ANCHOR = { left: 1262.71875, top: 81.90625 };
/** 动画结束后的同一张图（布局坐标 = 视觉坐标）。 */
const SETTLED_IMAGE_BOX = {
  x: 304.28125,
  y: 81.90625,
  width: 958.4375,
  height: 655.1875,
};

function makeRect(r: {
  x?: number;
  y?: number;
  left?: number;
  top?: number;
  width: number;
  height: number;
}): DOMRect {
  const x = r.x ?? r.left ?? 0;
  const y = r.y ?? r.top ?? 0;
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + r.width,
    bottom: y + r.height,
    width: r.width,
    height: r.height,
    toJSON: () => ({}),
  } as unknown as DOMRect;
}

const images = [{ src: "data:image/png;base64,aGVsbG8=" }] as never;

let d: ReturnType<typeof setupDialogTest>;
let render: (node: ReactNode) => Promise<void>;
const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);

/** 桩住弹层与拖拽面的 rect；animated=true 时给出「动画进行中」的几何。 */
function stubLayout(animated: boolean) {
  const content = animated
    ? ANIMATED_CONTENT
    : { left: 0, top: 0, width: CONTENT_LAYOUT_WIDTH, height: 819 };
  const imageBox = animated ? ANIMATED_IMAGE_BOX : SETTLED_IMAGE_BOX;

  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.getAttribute("role") === "dialog") {
        return makeRect(content);
      }
      const dialogImage = document.querySelector('[role="dialog"] img');
      if (dialogImage && this === dialogImage.parentElement) {
        return makeRect(imageBox);
      }
      return makeRect({ width: 0, height: 0 });
    },
  );
  // 布局宽度（未变换）——jsdom 恒为 0，这里给弹层一个真实值。
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute("role") === "dialog" ? CONTENT_LAYOUT_WIDTH : 0;
    },
  });
}

/**
 * img 的 load / error → measureToolbarAnchor（浏览器里真实的测量时机）。
 * 两条都要量：解码完成量的是图片盒，失败量的是 alt 文本框，两者都是 img 的布局盒。
 */
async function fireImageEvent(type: "load" | "error") {
  const img = document.querySelector('[role="dialog"] img') as HTMLImageElement;
  expect(img, "弹层里的图片必须存在").not.toBeNull();
  await act(async () => {
    img.dispatchEvent(new Event(type));
  });
}

const fireImageLoad = () => fireImageEvent("load");

function anchorOf(): HTMLElement {
  const toolbar = document.body.querySelector(
    '[data-testid="image-lightbox-toolbar"]',
  ) as HTMLElement | null;
  expect(toolbar, "工具条必须渲染出来").not.toBeNull();
  return toolbar!.parentElement as HTMLElement;
}

function clearOffsetWidthStub() {
  // jsdom 在 HTMLElement.prototype 上定义了 offsetWidth（恒 0），所以必须**还原描述符**
  // 而不是 delete —— delete 之后读到的会是 undefined，整个文件后续都依赖重新桩。
  if (originalOffsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      originalOffsetWidth,
    );
  }
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  d = setupDialogTest();
  ({ render } = d);
});

afterEach(() => {
  d.teardown();
  useAppStore.setState({ browserOcclusionIds: new Set<string>() });
  vi.restoreAllMocks();
  clearOffsetWidthStub();
  vi.unstubAllGlobals();
});

describe("图片预览工具条的锚点", () => {
  it("图片在打开动画中解码完，工具条也不能被推出视口（本仓 2026-10-10 的报障）", async () => {
    stubLayout(true);
    await render(<ImageLightbox isOpen images={images} onClose={() => {}} />);
    await fireImageLoad();

    const anchor = anchorOf();
    expect(
      parseFloat(anchor.style.left),
      "锚点必须是图片右上角在弹层里的位置，不是动画途中的视口坐标",
    ).toBeCloseTo(IMAGE_LOCAL_ANCHOR.left, 3);
    expect(parseFloat(anchor.style.top)).toBeCloseTo(IMAGE_LOCAL_ANCHOR.top, 3);
    // 直接写视口坐标就是这个 bug：top 为负，工具条落在视口上方。
    // （实测值 -294.83，工具条自身再上移 8px + 高度 42px ⇒ y ≈ -344.8。）
    expect(parseFloat(anchor.style.top)).toBeGreaterThan(0);
  });

  it("动画结束后锚点与图片右上角一致", async () => {
    stubLayout(false);
    await render(<ImageLightbox isOpen images={images} onClose={() => {}} />);
    await fireImageLoad();

    const anchor = anchorOf();
    expect(parseFloat(anchor.style.left)).toBeCloseTo(
      IMAGE_LOCAL_ANCHOR.left,
      3,
    );
    expect(parseFloat(anchor.style.top)).toBeCloseTo(IMAGE_LOCAL_ANCHOR.top, 3);
  });

  it("图片加载失败时也量（坏图不能连一个可见的关闭键都没有）", async () => {
    stubLayout(false);
    await render(<ImageLightbox isOpen images={images} onClose={() => {}} />);

    const toolbar = document.body.querySelector(
      '[data-testid="image-lightbox-toolbar"]',
    ) as HTMLElement;
    expect(toolbar.className, "还没量到盒子时应保持 invisible").toContain(
      "invisible",
    );

    await fireImageEvent("error");
    expect(
      toolbar.className,
      "坏图也要把工具条画出来 —— 本查看器唯一的关闭键就在里面",
    ).not.toContain("invisible");
  });

  it("量到盒子后工具条不再是 invisible，动作按钮真的画出来", async () => {
    stubLayout(false);
    await render(<ImageLightbox isOpen images={images} onClose={() => {}} />);

    const toolbar = document.body.querySelector(
      '[data-testid="image-lightbox-toolbar"]',
    ) as HTMLElement;
    expect(toolbar.className, "还没量到盒子时应保持 invisible").toContain(
      "invisible",
    );

    await fireImageLoad();
    expect(toolbar.className).not.toContain("invisible");
    // 无 filePath 时没有「用默认程序打开」，只剩复制与关闭。
    const labels = Array.from(toolbar.querySelectorAll("button")).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      i18n.t("imageLightbox.copy"),
      i18n.t("imageLightbox.close"),
    ]);
  });
});
