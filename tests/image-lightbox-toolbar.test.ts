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
    const node = container.querySelector<HTMLElement>(
      '[data-testid="image-lightbox-toolbar"]',
    );
    if (!node) throw new Error("toolbar not rendered");
    return node;
  }

  function button(label: string): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>(
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
      container.querySelectorAll(`button[aria-label="${label}"]`).length;
    expect(count("imageLightbox.close")).toBe(1);
    expect(count("imageLightbox.copy")).toBe(1);
    expect(count("imageLightbox.openExternal")).toBe(1);
  });

  it("does not zoom the image when the wheel is scrolled over the toolbar", () => {
    render();
    const image = container.querySelector("img");
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
    const image = container.querySelector("img");
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
    const root = container.firstElementChild as HTMLElement;
    const imageArea =
      container.querySelector("img")?.parentElement?.parentElement;

    // 两者都是 positioned、z-index:auto 的兄弟节点，所以后面的那个在上面。
    // 图片区铺满整个视口，工具条一旦排在它前面就会被盖住、按钮点不到
    // （点下去命中的是图片区，而图片区自己的 onClick 会关掉弹层）。
    expect(root.lastElementChild).not.toBe(imageArea);
    expect(root.lastElementChild).toBe(toolbar().parentElement);
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
});
