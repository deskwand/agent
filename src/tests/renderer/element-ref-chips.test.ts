// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElementRefChips } from "../../renderer/components/message/ElementRefChips";
import { useAppStore } from "../../renderer/store";
import type { ElementSelectionRef } from "../../shared/ipc-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ref_: ElementSelectionRef = {
  pageUrl: "http://fixture/",
  tag: "button",
  classes: ["primary"],
  text: "开始使用",
  selector: "button.primary",
  selectorUnique: true,
  width: 132,
  height: 40,
};

const highlight = vi.fn(async () => true);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // 真实断言行为，不 mock 自家 helper
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { browser: { picker: { highlight } } },
  });
  useAppStore.setState({ rightPanelMode: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(window, "electronAPI");
  highlight.mockClear();
});

const render = (refs: ElementSelectionRef[]) =>
  act(() => {
    root.render(React.createElement(ElementRefChips, { selections: refs }));
  });

describe("ElementRefChips", () => {
  it("空列表不渲染任何东西", () => {
    render([]);
    expect(container.firstElementChild).toBeNull();
  });

  it("显示元素身份与文案", () => {
    render([ref_]);
    expect(container.textContent).toContain("button.primary");
    expect(container.textContent).toContain("开始使用");
  });

  it("点击 chip 会显示浏览器面板并回页面高亮（它存在的意义）", () => {
    render([ref_]);
    act(() => {
      container.querySelector("button")?.click();
    });
    expect(useAppStore.getState().rightPanelMode).toBe("browser");
    expect(highlight).toHaveBeenCalledWith("button.primary");
  });

  it("面板已经是 browser 模式时不再 toggle（否则会把它关掉）", () => {
    useAppStore.setState({ rightPanelMode: "browser" });
    render([ref_]);
    act(() => {
      container.querySelector("button")?.click();
    });
    expect(useAppStore.getState().rightPanelMode).toBe("browser");
    expect(highlight).toHaveBeenCalledWith("button.primary");
  });

  it("不唯一的元素带标记（复用既有键）", () => {
    render([{ ...ref_, selectorUnique: false }]);
    expect(container.textContent).toContain("attachTile.notUnique");
  });

  it("title 不在 button 上（全仓不变量）", () => {
    render([ref_]);
    expect(container.querySelector("button")?.getAttribute("title")).toBeNull();
    expect(container.querySelector("[title]")).not.toBeNull();
  });
});
