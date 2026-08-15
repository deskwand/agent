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
      { id: "deepseek-v4-flash", name: "标准" },
      { id: "deepseek-v4-pro", name: "编程" },
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

describe("MergedInputChip (single-panel)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
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

  it("shows non-cloud groups plus thinking row in non-cloud mode", () => {
    render();
    click(trigger());
    const text = panel().textContent ?? "";
    expect(text).toContain("Provider A");
    expect(text).toContain("Provider B");
    expect(text).not.toContain("DeskWand 云");
    expect(text).toContain("modelMenu.thinkingWithValue");
  });

  it("shows cloud modes and custom entry when in cloud mode", () => {
    useAppStore.getState().setCloudConfig({
      serverUrl: "",
      token: "",
      isLoggedIn: true,
      email: "a@b.com",
      level: "default",
      creditsBalance: 100,
      modes: [],
    });
    render({
      model: "deepseek-v4-flash",
      activeProviderProfileKey: "custom:deskwand",
    });
    expect(trigger().textContent).not.toContain("chat.thinkingLevel");
    click(trigger());
    const text = panel().textContent ?? "";
    expect(text).toContain("标准");
    expect(text).toContain("编程");
    expect(text).toContain("modelMenu.custom");
    expect(text).not.toContain("Provider A");
  });

  it("switches to custom view on custom entry click", () => {
    useAppStore.getState().setCloudConfig({
      serverUrl: "",
      token: "",
      isLoggedIn: true,
      email: "a@b.com",
      level: "default",
      creditsBalance: 100,
      modes: [],
    });
    render({
      model: "deepseek-v4-flash",
      activeProviderProfileKey: "custom:deskwand",
    });
    click(trigger());
    const customButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("modelMenu.custom"),
    );
    click(customButton);
    const text = panel().textContent ?? "";
    expect(text).toContain("Provider A");
    expect(text).toContain("modelMenu.back");
    expect(text).toContain("modelMenu.thinkingWithValue");
  });

  it("selects a thinking level and returns to the entry view", () => {
    useAppStore.getState().setCloudConfig({
      serverUrl: "",
      token: "",
      isLoggedIn: true,
      email: "a@b.com",
      level: "default",
      creditsBalance: 100,
      modes: [],
    });
    render({
      model: "deepseek-v4-flash",
      activeProviderProfileKey: "custom:deskwand",
    });
    click(trigger());
    const customButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("modelMenu.custom"),
    );
    click(customButton);
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
    // 自动回进入前视图（custom）
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

  it("shows cloud modes and custom entry regardless of current provider", () => {
    useAppStore.getState().setCloudConfig({
      serverUrl: "",
      token: "",
      isLoggedIn: true,
      email: "a@b.com",
      level: "default",
      creditsBalance: 100,
      modes: [],
    });
    render(); // activeProviderProfileKey = "profile-a"（BYOK）
    click(trigger());
    const text = panel().textContent ?? "";
    expect(text).toContain("标准");
    expect(text).toContain("编程");
    expect(text).toContain("modelMenu.custom");
    expect(text).not.toContain("Provider A"); // BYOK 分组在「自定义」视图
  });

  it("hides cloud modes when not logged in", () => {
    render(); // cloudConfig 默认 null
    click(trigger());
    const text = panel().textContent ?? "";
    expect(text).not.toContain("标准");
    expect(text).toContain("Provider A");
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
