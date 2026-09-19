// @vitest-environment jsdom
//
// 用 React.createElement 而不是 JSX：本仓库的测试文件一律 .test.ts
// （vitest include 只有 {js,ts}，.tsx 不会被收走）。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserTextWithTokens } from "../../renderer/components/message/UserTextWithTokens";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.getState().setCommandLabels(new Map([["plan", "/plan"]]));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useAppStore.getState().setCommandLabels(new Map());
});

function render(text: string) {
  act(() => {
    root.render(
      React.createElement(UserTextWithTokens, {
        text,
        resolveFilePath: (v: string) => `/cwd/${v}`,
        onFileClick: () => {},
      }),
    );
  });
}

describe("UserTextWithTokens", () => {
  it("行首技能渲染为纯名称，不出现 /skill: 前缀", () => {
    render("/skill:apple-design 帮我把间距统一一下");
    expect(container.textContent).toBe("apple-design 帮我把间距统一一下");
    expect(container.textContent).not.toContain("/skill:");
  });

  it("句中 /skill: 保持纯文本", () => {
    render("帮我用 /skill:apple-design 改");
    expect(container.textContent).toBe("帮我用 /skill:apple-design 改");
  });

  it("行首命令保留斜杠", () => {
    render("/compact 收一下");
    expect(container.textContent).toBe("/compact 收一下");
  });

  it("行首非命令的 /word 保持纯文本", () => {
    render("/tmp 目录下的文件");
    expect(container.textContent).toBe("/tmp 目录下的文件");
  });

  it("文本里的文件提及渲染成可点击 token，tooltip 是解析后的路径", () => {
    render("看下 src/a.ts 这个文件");
    const button = container.querySelector("button")!;
    expect(button.textContent).toContain("src/a.ts");
    expect(button.querySelector("[class*='underline']")).not.toBeNull();
    const anchor = container.querySelector(".tt-anchor");
    expect(anchor).not.toBeNull();
  });

  it("纯文本时只有文本，没有按钮也没有锚点", () => {
    render("今天天气不错");
    expect(container.textContent).toBe("今天天气不错");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".tt-anchor")).toBeNull();
  });
});
