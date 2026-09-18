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
    expect(el.className).toContain("text-mention");
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
    expect(container.querySelector(".tt-anchor")).toBeNull();
  });

  it("有 tooltip 时渲染 tt-anchor 锚点", () => {
    render(
      React.createElement(ReferenceToken, {
        kind: "file",
        label: "a.ts",
        tooltip: "/abs/a.ts",
        onClick: () => {},
      }),
    );
    expect(container.querySelector(".tt-anchor")).not.toBeNull();
  });
});
