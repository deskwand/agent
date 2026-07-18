// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MergedInputChip } from "../../renderer/components/MergedInputChip";
import type { ModelOptionGroup } from "../../renderer/components/ChatInputBottomBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const modelOptions: ModelOptionGroup[] = [
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

describe("MergedInputChip", () => {
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

  function primaryMenu(): HTMLElement {
    return container.querySelector('[role="menu"]')!;
  }

  function modelRow(): HTMLButtonElement {
    return container.querySelector(
      'button[aria-haspopup="listbox"][aria-label="chat.model"]',
    )!;
  }

  function thinkingRow(): HTMLButtonElement {
    return container.querySelector(
      'button[aria-haspopup="listbox"][aria-label="chat.thinkingLevel"]',
    )!;
  }

  function modelList(): HTMLElement {
    return container.querySelector(
      '[role="listbox"][aria-label="chat.model"]',
    )!;
  }

  function thinkingList(): HTMLElement {
    return container.querySelector(
      '[role="listbox"][aria-label="chat.thinkingLevel"]',
    )!;
  }

  function hover(element: Element) {
    act(() => {
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
  }

  it("renders one trigger chip with model and thinking level", () => {
    render();
    expect(
      container.querySelectorAll('button[aria-haspopup="menu"]'),
    ).toHaveLength(1);
    expect(trigger().textContent).toContain("model-1");
    expect(trigger().textContent).toContain("chat.thinkingLevel.medium");
  });

  it("opens a compact fixed menu and expands the trigger to the same width", () => {
    render();
    expect(trigger().className).not.toContain("w-[15rem]");

    act(() => trigger().click());

    const menu = primaryMenu();
    expect(menu.getAttribute("aria-hidden")).toBe("false");
    expect(menu.className).toContain("right-0");
    expect(menu.className).toContain("bottom-[calc(100%+8px)]");
    expect(menu.className).toContain("w-[15rem]");
    expect(menu.className).not.toContain("w-[17rem]");
    expect(menu.className).toContain("flex-col");
    expect(menu.className).toContain("p-1");
    expect(menu.className).not.toContain("p-1.5");
    expect(trigger().className).toContain("w-[15rem]");
    expect(modelRow().className).toContain("h-9");
    expect(modelRow().className).not.toContain("h-11");
    expect(thinkingRow().className).toContain("h-9");
    expect(thinkingRow().className).not.toContain("h-11");
  });

  it("shows current values and chevrons in the two primary rows", () => {
    render();
    act(() => trigger().click());

    expect(modelRow().textContent).toContain("model-1");
    expect(thinkingRow().textContent).toContain("chat.thinkingLevel.medium");
    expect(modelRow().querySelector("svg")).toBeTruthy();
    expect(thinkingRow().querySelector("svg")).toBeTruthy();
  });

  it("opens the complete model submenu to the left on hover", () => {
    render();
    act(() => trigger().click());
    vi.spyOn(primaryMenu(), "getBoundingClientRect").mockReturnValue({
      bottom: 420,
    } as DOMRect);
    hover(modelRow());

    const list = modelList();
    expect(list.getAttribute("aria-hidden")).toBe("false");
    expect(list.className).toContain("absolute");
    expect(list.className).toContain("right-[calc(100%+4px)]");
    expect(list.className).toContain("bottom-0");
    expect(list.className).not.toContain("top-0");
    expect(list.className).not.toContain("max-h-[80vh]");
    // Reserve the 40px titlebar plus a 16px visual margin.
    expect(list.style.maxHeight).toBe("364px");
    expect(list.className).toContain("overflow-y-auto");
    expect(list.querySelector("input")?.className).toContain("sticky");
    expect(list.textContent).toContain("Provider A");
    expect(list.textContent).toContain("Provider B");
    expect(list.textContent).toContain("Model One");
    expect(list.textContent).toContain("Model Two");
    expect(list.textContent).toContain("Model Three");
    for (const option of list.querySelectorAll('[role="option"]')) {
      expect(option.className).toContain("h-9");
    }
  });

  it("opens every thinking option to the right on hover", () => {
    render();
    act(() => trigger().click());
    hover(thinkingRow());

    const list = thinkingList();
    expect(list.getAttribute("aria-hidden")).toBe("false");
    expect(list.className).toContain("absolute");
    expect(list.className).toContain("left-[calc(100%+4px)]");
    expect(list.className).toContain("bottom-0");
    expect(list.className).not.toContain("top-0");
    expect(list.className).not.toContain("max-h-");
    expect(list.className).not.toContain("overflow-y-auto");
    for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"]) {
      expect(list.textContent).toContain(`chat.thinkingLevel.${level}`);
    }
    for (const option of list.querySelectorAll('[role="option"]')) {
      expect(option.className).toContain("h-9");
    }
  });

  it("switches from the model submenu to the thinking submenu", () => {
    render();
    act(() => trigger().click());
    hover(modelRow());
    expect(modelList().getAttribute("aria-hidden")).toBe("false");

    hover(thinkingRow());
    expect(modelList().getAttribute("aria-hidden")).toBe("true");
    expect(thinkingList().getAttribute("aria-hidden")).toBe("false");
  });

  it("keeps the primary menu open after model selection", () => {
    const onSelectModel = vi.fn();
    render({ onSelectModel });
    act(() => trigger().click());
    hover(modelRow());

    const modelTwo = Array.from(
      modelList().querySelectorAll('[role="option"]'),
    ).find((element) =>
      element.textContent?.includes("Model Two"),
    ) as HTMLElement;
    act(() => modelTwo.click());

    expect(onSelectModel).toHaveBeenCalledWith("profile-a", "model-2");
    expect(primaryMenu().getAttribute("aria-hidden")).toBe("false");
  });

  it("keeps the primary menu open after thinking selection", () => {
    const onSelectThinkingLevel = vi.fn();
    render({ onSelectThinkingLevel });
    act(() => trigger().click());
    hover(thinkingRow());

    const extreme = Array.from(
      thinkingList().querySelectorAll('[role="option"]'),
    ).find((element) =>
      element.textContent?.includes("chat.thinkingLevel.xhigh"),
    ) as HTMLElement;
    act(() => extreme.click());

    expect(onSelectThinkingLevel).toHaveBeenCalledWith("xhigh");
    expect(primaryMenu().getAttribute("aria-hidden")).toBe("false");
  });

  it("filters the model submenu without closing it", () => {
    render();
    act(() => trigger().click());
    hover(modelRow());

    const input = modelList().querySelector("input")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Two");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(modelList().textContent).toContain("Model Two");
    expect(modelList().textContent).not.toContain("Model One");
    expect(primaryMenu().getAttribute("aria-hidden")).toBe("false");
  });

  it("closes on outside click", () => {
    render();
    act(() => trigger().click());
    expect(primaryMenu().getAttribute("aria-hidden")).toBe("false");

    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
    });
    expect(primaryMenu().getAttribute("aria-hidden")).toBe("true");
  });

  it("closes on Escape", () => {
    render();
    act(() => trigger().click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(primaryMenu().getAttribute("aria-hidden")).toBe("true");
  });

  it("does not open while disabled or without models", () => {
    render({ modelMenuDisabled: true });
    act(() => trigger().click());
    expect(primaryMenu().getAttribute("aria-hidden")).toBe("true");

    act(() => {
      root.render(
        React.createElement(MergedInputChip, {
          ...baseProps,
          model: "",
          modelOptions: [],
        }),
      );
    });
    act(() => trigger().click());
    expect(primaryMenu().getAttribute("aria-hidden")).toBe("true");
  });
});
