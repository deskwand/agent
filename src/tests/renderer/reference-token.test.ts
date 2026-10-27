// @vitest-environment jsdom
//
// 用 React.createElement 而不是 JSX：本仓库的测试文件一律 .test.ts
// （vitest include 只有 {js,ts}，.tsx 不会被收走）。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferenceToken } from "../../renderer/components/ReferenceToken";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactElement) {
  act(() => root.render(node));
}

describe("ReferenceToken", () => {
  it("技能渲染纯名称 + 语义色 + 图标，不带下划线、不可点击", () => {
    render(
      React.createElement(ReferenceToken, {
        kind: "skill",
        label: "apple-design",
      }),
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.textContent).toBe("apple-design");
    expect(el.className).toContain("text-primary");
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[class*='underline']")).toBeNull();
  });

  it("命令保留斜杠原文", () => {
    render(
      React.createElement(ReferenceToken, {
        kind: "command",
        label: "/compact",
      }),
    );
    expect(container.textContent).toBe("/compact");
  });

  it("文件带下划线且可点击，点击回调当前值", () => {
    const onClick = vi.fn();
    render(
      React.createElement(ReferenceToken, {
        kind: "file",
        label: "src/a.ts",
        onClick,
      }),
    );
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("src/a.ts");
    // 下划线画在标签的 span 上（文字才需要下划线，按钮盒子不需要）
    expect(button.querySelector("[class*='underline']")).not.toBeNull();
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("tooltip 为空时不额外包一层（避免给每个 token 加无意义锚点）", () => {
    render(React.createElement(ReferenceToken, { kind: "skill", label: "x" }));
    // ⚠️ 2026-10-09：`.tt-anchor` 是**老组件**给子元素套的那层 `<span>` ✗（`Tooltip.tsx` 的类 ✓），
    // 迁到 `app-tooltip`（`TooltipTrigger asChild` ✓）后**按设计没有了** ✗✓。
    // **意图一字未变** ✓（「**空 label ⇒ 不包 Tooltip、不产生气泡**」✓），换**新代理** ✗✓：
    // Radix 的 `TooltipTrigger` 会在触发器元素本身写 `data-state` ✓ ⇒ 它不在 = 没被包 ✓✓。
    expect(container.querySelector("[data-state]")).toBeNull();
  });

  it("有 tooltip 时该元素成为 Tooltip 触发器", () => {
    render(
      React.createElement(ReferenceToken, {
        kind: "file",
        label: "a.ts",
        tooltip: "/abs/a.ts",
        onClick: () => {},
      }),
    );
    // 同上 ✓：`data-state` 在 = 这个元素**已注册为 Tooltip 触发器** ✓✓
    //（比 `.tt-anchor` 更强 ✓ —— 它证明的是「被 Radix 接管了」✓，而不只是「被套了一层」✓）。
    expect(container.querySelector("[data-state]")).not.toBeNull();
  });

  it("可点击 token 不继承 Button 的 whitespace-nowrap（长路径必须能折行）", () => {
    // 2026-10-26 用户报障：气泡里的长文件路径把整列撑出屏幕。根因是迁移到 shadcn
    // `<Button>` 后 base 带了 `whitespace-nowrap`，`break-all` 被它压住 ⇒ 一个 680px 的
    // 路径 chip 在 672px 的正文里不折行、被聊天列裁掉。这里锁住合并后的类串：
    // nowrap 必须被调用方的 pre-wrap 顶掉（`cn` 同族合并，jsdom 量不了布局，就锁机制）。
    render(
      React.createElement(ReferenceToken, {
        kind: "file",
        label: `/Users/someone/${"a".repeat(200)}.plist`,
        onClick: () => {},
      }),
    );
    const button = container.querySelector("button")!;
    expect(button.className).not.toMatch(/\bwhitespace-nowrap\b/);
    expect(button.className).toMatch(/\bwhitespace-pre-wrap\b/);
  });
});
