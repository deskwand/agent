// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageLightbox } from "../src/renderer/components/ImageLightbox";

// 这里的 imageCount 与 en.json 的 "{{current}} / {{total}}" 一致。
// 故意不写成 t: (key) => key —— 那样断言 "1 / 2" 永远失败（key 里没有占位符），
// 而「单图不含 /」又会恒真。插值之后两边都才真的能红。
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key === "imageLightbox.imageCount" && vars
        ? `${String(vars.current)} / ${String(vars.total)}`
        : key,
  }),
}));

const SRC = "data:image/png;base64,AA==";
const TWO_IMAGES = [
  { src: SRC, name: "one.png" },
  { src: SRC, name: "two.png" },
];

describe("ImageLightbox toolbar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onClose = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: Partial<ComponentProps<typeof ImageLightbox>> = {}) {
    act(() => {
      root.render(
        createElement(ImageLightbox, {
          isOpen: true,
          images: TWO_IMAGES,
          onClose,
          ...props,
        }),
      );
    });
  }

  function toolbar(): HTMLElement {
    const node = document.body.querySelector<HTMLElement>(
      '[data-testid="image-lightbox-toolbar"]',
    );
    if (!node) throw new Error("toolbar not rendered");
    return node;
  }

  function button(label: string): HTMLButtonElement | null {
    return document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
  }

  it("keeps the toolbar and a working close button while the image is loading", () => {
    render({ loading: true });

    expect(toolbar()).toBeTruthy();
    act(() => button("imageLightbox.close")?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides copy and open until there is a loaded image", () => {
    render({ loading: true });
    expect(button("imageLightbox.copy")).toBeNull();
    expect(button("imageLightbox.openExternal")).toBeNull();

    render({
      images: [{ src: "", name: "broken.png", filePath: "/tmp/a.png" }],
    });
    expect(button("imageLightbox.copy")).toBeNull();
    expect(button("imageLightbox.openExternal")).toBeNull();
  });

  it("offers open only when the image has a file path", () => {
    render({ images: [{ src: SRC, name: "a.png" }] });
    expect(button("imageLightbox.copy")).not.toBeNull();
    expect(button("imageLightbox.openExternal")).toBeNull();

    render({ images: [{ src: SRC, name: "a.png", filePath: "/tmp/a.png" }] });
    expect(button("imageLightbox.openExternal")).not.toBeNull();
  });

  it("shows the counter only for a multi-image set", () => {
    render();
    expect(toolbar().textContent).toContain("1 / 2");

    render({ images: [TWO_IMAGES[0]] });
    expect(toolbar().textContent).not.toContain("/");
  });

  it("renders copy, open and close exactly once (the two full-width bars are gone)", () => {
    render({ images: [{ src: SRC, name: "a.png", filePath: "/tmp/a.png" }] });
    expect(toolbar()).toBeTruthy();

    const count = (label: string) =>
      document.body.querySelectorAll(`button[aria-label="${label}"]`).length;
    expect(count("imageLightbox.close")).toBe(1);
    expect(count("imageLightbox.copy")).toBe(1);
    expect(count("imageLightbox.openExternal")).toBe(1);
  });

  it("does not zoom the image when the wheel is scrolled over the toolbar", () => {
    render();
    const image = document.body.querySelector("img");
    const before = image?.style.transform;

    act(() => {
      toolbar().dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: -1,
          clientX: 10,
          clientY: 10,
        }),
      );
    });

    expect(image?.style.transform).toBe(before);
  });

  it("closes on a click on the blank area around the image, not on the image itself", () => {
    render();
    const image = document.body.querySelector("img");
    const imageArea = image?.parentElement?.parentElement as HTMLElement;
    expect(image).not.toBeNull();
    expect(imageArea).toBeTruthy();

    act(() => {
      imageArea.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    act(() => {
      image?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the toolbar after the image area so it paints above it", () => {
    render();
    const root = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(root, "查看器内容必须存在").not.toBeNull();
    const imageArea =
      document.body.querySelector("img")?.parentElement?.parentElement;

    // 两者都是 positioned、z-index:auto 的兄弟节点，所以后面的那个在上面。
    // 图片区铺满整个视口，工具条一旦排在它前面就会被盖住、按钮点不到
    // （点下去命中的是图片区，而图片区自己的 onClick 会关掉弹层）。
    //
    // 断言写成「顺序」而不是「是最后一个子节点」：迁到 shadcn 的 Dialog 后，
    // DialogContent 会在 children **之后**再渲染一个内置关闭键，所以
    // lastElementChild 永远是那颗 X —— 它自己是 absolute 定位的，盖在工具条上
    // 无所谓，但会让「最后一个必须是工具条」这条**机制性**断言失效。
    // 要守的意图（工具条在图片区之后）没变。
    const order = Array.from(root.children);
    const toolbarIndex = order.indexOf(toolbar().parentElement as Element);
    const imageAreaIndex = order.indexOf(imageArea as Element);
    expect(imageAreaIndex, "图片区必须存在").toBeGreaterThanOrEqual(0);
    expect(toolbarIndex, "工具条必须存在").toBeGreaterThanOrEqual(0);
    expect(
      toolbarIndex,
      "工具条必须排在图片区之后，否则会被铺满视口的图片区盖住",
    ).toBeGreaterThan(imageAreaIndex);
  });

  it("hides the toolbar while the image is expected but has not been measured", () => {
    render({ loading: true });
    expect(toolbar().className).not.toContain("invisible");

    // jsdom 里 getBoundingClientRect 恒为 0，所以这就是「图片已就绪但还没量到盒子」。
    // 真实浏览器里这个窗口是图片解码的那几帧 —— 不藏的话工具条会先出现在预览区
    // 右上角（正是用户嫌「太远」的位置）再跳到图片角上。
    render();
    expect(toolbar().className).toContain("invisible");
  });

  it("keeps an intrinsic width so the close button cannot outgrow the pill", () => {
    // 工具条的定位盒子是 0×0 的锚点，工具条自己是它的绝对定位子元素
    // （left:auto / right:0 / width:auto）——可用宽度为 0 时 shrink-to-fit 会把宽度
    // 压到 min-content。子项都是 shrink-0 收不回来，只有图片名能收缩，所以在
    // 「没有图片名」（粘贴的图）时最后一个子项（关闭按钮）会溢出圆角背景。
    // 真实 Chromium 实测：塌陷 97px，内容需要 106px，关闭按钮右溢 8px。
    // jsdom 没有布局，只能守住这条类名契约。别换成 w-fit —— 那是
    // min(max-content, available)，可用宽度 0 时又塌回 min-content。
    render({ images: [{ src: SRC, name: "" }] });

    // 按空白切词断言：toContain("w-max") 会被 max-w-max / min-w-max 误判为通过。
    expect(toolbar().className.split(/\s+/)).toContain("w-max");
  });
});
