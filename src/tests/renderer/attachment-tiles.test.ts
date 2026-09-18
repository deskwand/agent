// @vitest-environment jsdom
//
// 用 React.createElement 而不是 JSX：本仓库的测试文件一律 .test.ts
// （vitest include 只有 {js,ts}，.tsx 不会被收走）。
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AttachmentTiles,
  type AttachmentTile,
} from "../../renderer/components/attach/AttachmentTiles";

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

const imageTile: AttachmentTile = {
  kind: "image",
  key: "img-0",
  url: "blob:x",
  alt: "a",
  onOpen: () => {},
  onRemove: () => {},
};

const fileTile: AttachmentTile = {
  kind: "file",
  key: "file-0",
  name: "plan.md",
  hint: "/repo/docs/plan.md",
  onRemove: () => {},
};

function render(tiles: AttachmentTile[]) {
  act(() => {
    root.render(React.createElement(AttachmentTiles, { tiles }));
  });
}

describe("AttachmentTiles", () => {
  it("没有附件时不渲染容器", () => {
    render([]);
    expect(container.firstElementChild).toBeNull();
  });

  it("图片与文件各渲染一个磁贴，容器横向换行", () => {
    render([imageTile, fileTile]);
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap.className).toContain("flex-wrap");
    expect(wrap.children).toHaveLength(2);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(wrap.textContent).toContain("plan.md");
  });

  it("删除键带可访问名，点击调用对应回调", () => {
    const onRemove = vi.fn();
    render([{ ...fileTile, onRemove }]);
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("attachTile.remove");
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("文件磁贴的 title 是 hint（路径或密库提示）", () => {
    render([fileTile]);
    const tile = container.querySelector("[title]")!;
    expect(tile.getAttribute("title")).toBe("/repo/docs/plan.md");
  });

  it("传了 onOpen 的文件磁贴可点击", () => {
    const onOpen = vi.fn();
    render([{ ...fileTile, onOpen }]);
    const tile = container.querySelector("[title]") as HTMLElement;
    expect(tile.className).toContain("cursor-pointer");
    act(() => tile.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("删除键的点击不会冒泡给磁贴的打开动作", () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render([{ ...fileTile, onOpen, onRemove }]);
    const button = container.querySelector("button")!;
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("没传 onOpen 的文件磁贴不可点击", () => {
    render([fileTile]);
    const tile = container.querySelector("[title]") as HTMLElement;
    expect(tile.className).not.toContain("cursor-pointer");
  });
});
