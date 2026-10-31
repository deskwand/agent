// @vitest-environment jsdom
/**
 * OutputClamp：工具输出的「默认限高 + 一键展开全文」。
 *
 * jsdom 不实现布局：clientHeight / scrollHeight 恒为 0，组件量不出真实高度。
 * 约定是把「量不出来」当「已溢出」处理 ⇒ jsdom 里控件始终出现，测试因此是确定的。
 * 真实浏览器按真实高度判定（短输出不出控件）——这一条 jsdom 测不了，靠人工核。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputClamp } from "../../renderer/components/message/OutputClamp";
import i18n from "../../renderer/i18n/config";

let root: Root;
let container: HTMLDivElement;

/**
 * 真实高度分支（非 jsdom 的 0/0 兜底）靠可变的原型 getter 来测：jsdom 不做布局，
 * clientHeight / scrollHeight 恒为 0，若不桩化，这个组件唯一的判定逻辑就永远测不到。
 */
let metrics = { clientHeight: 0, scrollHeight: 0 };
let resizeCallbacks: Array<() => void> = [];

class FakeResizeObserver {
  private readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
  }

  observe(): void {
    resizeCallbacks.push(this.callback);
  }

  disconnect(): void {
    resizeCallbacks = resizeCallbacks.filter((cb) => cb !== this.callback);
  }
}

function stubLayout(next: { clientHeight: number; scrollHeight: number }) {
  metrics = next;
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  vi.stubGlobal(
    "ResizeObserver",
    FakeResizeObserver as unknown as typeof ResizeObserver,
  );
}

/** 模拟 ResizeObserver 回调（内容变长/变短后浏览器会这样做）。 */
async function fireResize(): Promise<void> {
  await act(async () => {
    for (const callback of [...resizeCallbacks]) callback();
  });
}

beforeEach(async () => {
  await i18n.changeLanguage("zh");
  metrics = { clientHeight: 0, scrollHeight: 0 };
  resizeCallbacks = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  vi.unstubAllGlobals();
  resizeCallbacks = [];
});

async function render(el: ReactElement): Promise<void> {
  await act(async () => {
    root.render(el);
  });
}

const clampBox = () =>
  container.querySelector<HTMLElement>("[data-output-clamp]")!;
const toggle = () => container.querySelector<HTMLButtonElement>("button");

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
}

describe("OutputClamp", () => {
  it("默认限高态：内联 maxHeight + overflow-y-auto，内容照常渲染", async () => {
    await render(
      createElement(
        OutputClamp,
        null,
        createElement("pre", null, "clamp-body"),
      ),
    );

    const box = clampBox();
    expect(box.dataset.outputClamp).toBe("clamped");
    expect(box.style.maxHeight).toBe("300px");
    expect(box.className).toContain("overflow-y-auto");
    expect(box.textContent).toBe("clamp-body");
  });

  it("maxHeight 可透传（工具分组列表用的是 400）", async () => {
    await render(
      createElement(OutputClamp, {
        maxHeight: 400,
        children: createElement("span", null, "x"),
      }),
    );

    expect(clampBox().style.maxHeight).toBe("400px");
  });

  it("量不出高度时控件仍然出现，文案是「显示全部输出」", async () => {
    await render(
      createElement(OutputClamp, null, createElement("span", null, "x")),
    );

    expect(toggle()).not.toBeNull();
    expect(toggle()!.textContent).toBe("显示全部输出");
  });

  it("点击后铺开全文（去掉 maxHeight 与滚动），再点收回限高态", async () => {
    await render(
      createElement(OutputClamp, null, createElement("pre", null, "full-body")),
    );

    await click(toggle()!);
    const full = clampBox();
    expect(full.dataset.outputClamp).toBe("full");
    expect(full.style.maxHeight).toBe("");
    expect(full.className).not.toContain("overflow-y-auto");
    expect(full.textContent).toBe("full-body");
    expect(toggle()!.textContent).toBe("收起输出");

    await click(toggle()!);
    const clamped = clampBox();
    expect(clamped.dataset.outputClamp).toBe("clamped");
    expect(clamped.style.maxHeight).toBe("300px");
    expect(toggle()!.textContent).toBe("显示全部输出");
  });

  it("真实布局下内容装得下就不出控件", async () => {
    stubLayout({ clientHeight: 120, scrollHeight: 120 });
    await render(
      createElement(OutputClamp, null, createElement("pre", null, "short")),
    );

    expect(clampBox().dataset.outputClamp).toBe("clamped");
    expect(toggle()).toBeNull();
  });

  it("真实布局下溢出才出控件，流式变长后由 ResizeObserver 补上", async () => {
    stubLayout({ clientHeight: 300, scrollHeight: 300 });
    await render(
      createElement(OutputClamp, null, createElement("pre", null, "stream")),
    );
    expect(toggle()).toBeNull();

    metrics = { clientHeight: 300, scrollHeight: 520 };
    await fireResize();
    expect(toggle()).not.toBeNull();
    expect(toggle()!.textContent).toBe("显示全部输出");

    // 内容变短（重试/结果替换）后控件自己收回
    metrics = { clientHeight: 300, scrollHeight: 300 };
    await fireResize();
    expect(toggle()).toBeNull();
  });

  it("有 ResizeObserver 时 0/0 不当成溢出（空内容/祖先隐藏不弹空按钮）", async () => {
    stubLayout({ clientHeight: 0, scrollHeight: 0 });
    await render(
      createElement(OutputClamp, null, createElement("span", null, "empty")),
    );

    expect(toggle()).toBeNull();
  });

  it("嵌套：内层铺开时把外层一起铺开，否则外层钳制仍然裁着", async () => {
    await render(
      createElement(OutputClamp, {
        maxHeight: 400,
        children: createElement(OutputClamp, {
          maxHeight: 300,
          children: createElement("pre", null, "nested"),
        }),
      }),
    );

    const boxes = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-output-clamp]"),
      );
    expect(boxes().map((box) => box.dataset.outputClamp)).toEqual([
      "clamped",
      "clamped",
    ]);

    // 最内层的按钮
    const innerButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((el) => el.textContent === "显示全部输出")!;
    await click(innerButton);

    expect(boxes().map((box) => box.dataset.outputClamp)).toEqual([
      "full",
      "full",
    ]);
    expect(boxes()[0].style.maxHeight).toBe("");
    expect(boxes()[1].style.maxHeight).toBe("");
  });
});
