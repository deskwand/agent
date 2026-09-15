// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MergedInputChip } from "../../renderer/components/MergedInputChip";
import type { ModelOptionGroup } from "../../renderer/components/ChatInputBottomBar";
import { useAppStore } from "../../renderer/store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const modelOptions: ModelOptionGroup[] = [
  {
    profileKey: "custom:deskwand" as never,
    groupLabel: "DeskWand 云",
    items: [
      { id: "deepseek-flash", name: "deepseek-flash" },
      { id: "deepseek-v4-pro", name: "deepseek-v4-pro" },
    ],
  },
  {
    profileKey: "profile-a" as never,
    groupLabel: "Provider A",
    items: [
      { id: "model-1", name: "Model One" },
      { id: "model-2", name: "Model Two" },
    ],
  },
  {
    profileKey: "profile-b" as never,
    groupLabel: "Provider B",
    items: [{ id: "model-3", name: "Model Three" }],
  },
];

const thinkingLevelOptions = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as never[];

const baseProps = {
  model: "model-1",
  modelOptions,
  activeProviderProfileKey: "profile-a" as never,
  onSelectModel: vi.fn(),
  modelMenuDisabled: false,
  thinkingLevel: "medium" as never,
  thinkingLevelOptions,
  onSelectThinkingLevel: vi.fn(),
};

function loginCloud() {
  useAppStore.getState().setCloudConfig({
    serverUrl: "",
    token: "",
    isLoggedIn: true,
    email: "a@b.com",
    level: "default",
    balanceMicroUsd: 100,
  });
}

describe("MergedInputChip (single-panel)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const realGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
    vi.clearAllMocks();
    useAppStore.getState().setCloudConfig(null);
  });

  function render(props = {}) {
    act(() => {
      root.render(
        React.createElement(MergedInputChip, { ...baseProps, ...props }),
      );
    });
  }

  function trigger(): HTMLButtonElement {
    return container.querySelector('button[aria-haspopup="menu"]')!;
  }

  // jsdom 没有布局，手动给出面板底部坐标，模拟 WelcomeView 中输入框垂直居中、
  // 面板上方空间不足的场景（真实修复前的值可参考菜单高度 ≈ 100vh - 12rem）。
  function stubPanelBottom(bottom: number) {
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute?.("role") === "menu") {
        return {
          top: bottom - 100,
          bottom,
          left: 0,
          right: 0,
          width: 0,
          height: 100,
          x: 0,
          y: bottom - 100,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return realGetBoundingClientRect.call(this);
    };
  }

  function panel(): HTMLElement {
    return container.querySelector('[role="menu"]')!;
  }

  function click(el: Element | undefined) {
    if (!el) throw new Error("element not found");
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("renders one trigger chip with model and thinking level", () => {
    render();
    expect(trigger().textContent).toContain("Model One");
    expect(trigger().textContent).toContain("chat.thinkingLevel.medium");
  });

  it("opens the panel on chip click", () => {
    render();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(panel()).toBeDefined();
  });

  it("carries the shared panel shell tokens", () => {
    render();
    click(trigger());
    expect(panel().className).toContain("shadow-elevated");
    expect(panel().className).toContain("border-border-subtle");
    expect(panel().className).not.toContain("shadow-soft");
  });

  it("caps the panel to the space available above the chip", () => {
    render();
    stubPanelBottom(300);
    click(trigger());
    // 300 - 48(标题栏安全区)
    expect(panel().style.maxHeight).toBe("252px");
  });

  it("keeps the 32rem ceiling when there is plenty of room", () => {
    render();
    stubPanelBottom(2000);
    click(trigger());
    expect(panel().style.maxHeight).toBe("512px");
  });

  it("shows every group plus thinking row when logged out", () => {
    render();
    click(trigger());
    const text = panel().textContent ?? "";
    expect(text).toContain("Provider A");
    expect(text).toContain("Provider B");
    expect(text).not.toContain("DeskWand 云");
    expect(text).toContain("modelMenu.thinkingWithValue");
  });

  it("shows the cloud group and user providers in the same panel", () => {
    loginCloud();
    render({
      model: "deepseek-flash",
      activeProviderProfileKey: "custom:deskwand",
      thinkingLevel: "xhigh",
    });
    // 思考档不再由模式锁定，折叠态要显示用户当前档位（非默认档）
    expect(trigger().textContent).toContain("chat.thinkingLevel.xhigh");
    click(trigger());
    const text = panel().textContent ?? "";
    expect(text).toContain("DeskWand 云");
    expect(text).toContain("deepseek-flash");
    expect(text).toContain("deepseek-v4-pro");
    expect(text).toContain("Provider A");
    // 思考行就是列表层的最后一行：没有任何中间层入口排在它后面
    expect(text.endsWith("modelMenu.thinkingWithValue")).toBe(true);
  });

  it("shows the cloud group for BYOK providers too", () => {
    loginCloud();
    render(); // activeProviderProfileKey = "profile-a"（BYOK）
    click(trigger());
    const text = panel().textContent ?? "";
    expect(text).toContain("DeskWand 云");
    expect(text).toContain("deepseek-flash");
    expect(text).toContain("deepseek-v4-pro");
    expect(text).toContain("Provider A");
  });

  it("puts the cloud group first regardless of config order", () => {
    loginCloud();
    const cloudLast: ModelOptionGroup[] = [
      ...modelOptions.filter((g) => g.profileKey !== "custom:deskwand"),
      modelOptions.find((g) => g.profileKey === "custom:deskwand")!,
    ];
    render({ modelOptions: cloudLast });
    click(trigger());
    const text = panel().textContent ?? "";
    // 分组标题按 DOM 顺序出现在 textContent 里，用下标比较断言顺序
    expect(text.indexOf("DeskWand 云")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("DeskWand 云")).toBeLessThan(
      text.indexOf("Provider A"),
    );
  });

  it("selects a thinking level and returns to the list view", () => {
    loginCloud();
    render({
      model: "deepseek-flash",
      activeProviderProfileKey: "custom:deskwand",
    });
    click(trigger());
    // 列表层直接可见思考行，不需要先钻进「自定义」视图
    const thinkingRow = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("modelMenu.thinkingWithValue"),
    );
    click(thinkingRow);
    expect(panel().textContent).toContain("chat.thinkingLevel.high");
    const highButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("chat.thinkingLevel.high"),
    );
    click(highButton);
    expect(baseProps.onSelectThinkingLevel).toHaveBeenCalledWith("high");
    // 自动回列表层，仍看得到分组
    expect(panel().textContent).toContain("Provider A");
  });

  it("closes on outside click", () => {
    render();
    click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("hides the cloud group when not logged in", () => {
    render(); // cloudConfig 默认 null
    click(trigger());
    const text = panel().textContent ?? "";
    expect(text).not.toContain("deepseek-flash");
    expect(text).toContain("Provider A");
  });

  it("shows the no-match row when every group is hidden", () => {
    // 未登录时云分组被过滤掉；列表为空也要给出空态行，且思考行仍在（设计文档已记录的行为偏差）
    render({
      modelOptions: modelOptions.filter(
        (g) => g.profileKey === "custom:deskwand",
      ),
    });
    click(trigger());
    const text = panel().textContent ?? "";
    expect(text).toContain("chat.noModelMatch");
    expect(text).toContain("modelMenu.thinkingWithValue");
  });

  it("shows no-match row when search filters everything out", () => {
    render();
    click(trigger());
    const input = panel().querySelector("input");
    expect(input).toBeDefined();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "zzz-nothing");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(panel().textContent).toContain("chat.noModelMatch");
  });
});
