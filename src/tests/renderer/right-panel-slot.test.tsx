// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RightPanelSlot } from "../../renderer/components/right-panel-slot";

const read = (relativePath: string): string =>
  readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

const globalStyles = read("src/renderer/styles/globals.css");

describe("right panel entrance motion", () => {
  it("入场只淡入，不带会创建包含块的属性", () => {
    const keyframes =
      globalStyles.match(/@keyframes fade-in \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(keyframes, "@keyframes fade-in 必须存在").toContain("opacity: 0");
    // 面板里可能挂 position:fixed 的全屏层（ReviewPanel），祖先带 transform /
    // translate / filter 之类都会让它改按 288px 面板定位。这条关键帧只动 opacity。
    expect(keyframes, "不得引入会创建包含块的属性").not.toMatch(
      /transform|translate|scale|filter|perspective|will-change|contain/,
    );
  });

  it("入场时长/曲线复用动效策略变量，且不另写一套关键帧", () => {
    expect(globalStyles).toMatch(
      /\.animate-panel-in \{\s*animation: fade-in var\(--motion-standard\) var\(--ease-ui-out\);/,
    );
    // 与 fade-in 行为一致却另起一个名字 = 两套动效各自漂移的开始
    expect(globalStyles).not.toContain("@keyframes panel-in");
  });

  it("reduce motion 名单里有它", () => {
    // 先切出那个 @media 块再断言成员，否则下面某个后置的 fade-in 规则也会让正则通过
    const block =
      globalStyles.match(
        /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/,
      )?.[1] ?? "";
    expect(block, "reduce-motion 块必须存在").not.toBe("");
    expect(block).toContain(".animate-panel-in {");
    expect(block).toContain("animation-name: fade-in !important;");
  });
});

describe("RightPanelSlot presence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderSlot = (active: boolean) =>
    act(() => {
      root.render(
        createElement(RightPanelSlot, {
          active,
          children: createElement(
            "span",
            { "data-testid": "content" },
            "panel",
          ),
        }),
      );
    });

  it("未激活过就什么都不渲染", () => {
    renderSlot(false);
    expect(container.firstElementChild).toBeNull();
  });

  it("从关闭态首次激活时，激活那一帧内容就在、带入场类、不 hidden", () => {
    renderSlot(false);
    renderSlot(true);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.classList.contains("animate-panel-in")).toBe(true);
    expect(wrapper.classList.contains("hidden")).toBe(false);
    expect(wrapper.classList.contains("flex")).toBe(true);
    expect(wrapper.classList.contains("flex-1")).toBe(true);
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
  });

  it("关闭只切 display、不卸载（保活）", () => {
    renderSlot(true);
    renderSlot(false);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains("hidden")).toBe(true);
    expect(wrapper.classList.contains("animate-panel-in")).toBe(false);
    expect(container.querySelector('[data-testid="content"]')).not.toBeNull();
  });

  it("再次激活会重新挂入场类（面板之间切换有淡入，不是硬切）", () => {
    renderSlot(true);
    renderSlot(false);
    renderSlot(true);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains("animate-panel-in")).toBe(true);
    expect(wrapper.classList.contains("hidden")).toBe(false);
  });

  it("挂载不依赖 effect（否则滑出的第一帧又是个空槽）", () => {
    // 行为层测不出来：act() 会把 effect 冲掉，改成 useEffect 也是绿的。
    // 「首帧就有内容」只能钉在实现上 —— 这个文件里不允许出现 effect。
    const source = read("src/renderer/components/right-panel-slot.tsx");
    expect(source).not.toMatch(/useEffect|useLayoutEffect/);
  });
});

describe("App wiring", () => {
  it("App 不再自建 visitedPanels（那套是 effect 里补的，等于首帧空槽）", () => {
    expect(read("src/renderer/App.tsx")).not.toContain("visitedPanels");
  });
});
