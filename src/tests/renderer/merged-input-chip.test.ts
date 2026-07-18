// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MergedInputChip } from "../../renderer/components/MergedInputChip";
import type { ModelOptionGroup } from "../../renderer/components/ChatInputBottomBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const makeModelOptions = (): ModelOptionGroup[] => [
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

const baseProps = {
  model: "model-1",
  modelOptions: makeModelOptions(),
  activeProviderProfileKey: "profile-a" as never,
  onSelectModel: vi.fn(),
  modelMenuDisabled: false,
  thinkingLevel: "medium" as never,
  thinkingLevelOptions: [
    "off",
    "low",
    "medium",
    "high",
    "extreme",
  ] as never[],
  onSelectThinkingLevel: vi.fn(),
  contextUsagePercentage: 56,
  contextUsageTooltip: "Context: 45K / 80K  (56%)",
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
    const merged = { ...baseProps, ...props };
    act(() => {
      root.render(React.createElement(MergedInputChip, merged));
    });
  }

  function getChipButton(): HTMLButtonElement | null {
    return container.querySelector("button");
  }

  function panelIsOpen(): boolean {
    // The panel div always exists in DOM; check for "invisible" class.
    // jsdom doesn't load Tailwind CSS, so check classList directly.
    const panel = container.querySelector(
      'div[class*="z-30"][class*="rounded-xl"]',
    ) as HTMLElement | null;
    if (!panel) return false;
    return !panel.classList.contains("invisible");
  }

  it("renders model id and thinking level in collapsed chip", () => {
    render();
    const btn = getChipButton();
    expect(btn?.textContent).toContain("model-1");
    expect(btn?.textContent).toContain("chat.thinkingLevel.medium");
    expect(panelIsOpen()).toBe(false);
  });

  it("renders fallback when model is empty and modelOptions is empty", () => {
    render({ model: "", modelOptions: [] });
    const btn = getChipButton();
    expect(btn?.textContent).toContain("chat.noModel");
  });

  it("opens panel on chip click", () => {
    render();
    const btn = getChipButton();
    act(() => btn?.click());
    expect(panelIsOpen()).toBe(true);
  });

  it("calls onSelectModel when a model is clicked in panel", () => {
    const onSelectModel = vi.fn();
    render({ onSelectModel });
    // Open panel
    act(() => getChipButton()?.click());
    // Click "Model Two" in the list
    const modelTwoBtn = Array.from(
      container.querySelectorAll('[role="option"]'),
    ).find((el) => el.textContent?.includes("Model Two")) as HTMLElement;
    act(() => modelTwoBtn?.click());
    expect(onSelectModel).toHaveBeenCalledWith("profile-a", "model-2");
  });

  it("closes panel when a model is selected", () => {
    render();
    act(() => getChipButton()?.click());
    expect(panelIsOpen()).toBe(true);
    // Click a model
    const modelTwoBtn = Array.from(
      container.querySelectorAll('[role="option"]'),
    ).find((el) => el.textContent?.includes("Model Two")) as HTMLElement;
    act(() => modelTwoBtn?.click());
    expect(panelIsOpen()).toBe(false);
  });

  it("filters model list on search", () => {
    render();
    act(() => getChipButton()?.click());
    const input = container.querySelector(
      'input[placeholder="chat.searchModel"]',
    ) as HTMLInputElement;
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(input, "Two");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Model Two");
    expect(container.textContent).not.toContain("Model One");
  });

  it("shows no match message when search filters all models", () => {
    render();
    act(() => getChipButton()?.click());
    const input = container.querySelector(
      'input[placeholder="chat.searchModel"]',
    ) as HTMLInputElement;
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeInputValueSetter?.call(input, "zzz_nonexistent");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("chat.noModelMatch");
  });

  it("calls onSelectThinkingLevel when option clicked", () => {
    const onSelectThinkingLevel = vi.fn();
    render({ onSelectThinkingLevel });
    act(() => getChipButton()?.click());
    // Click the thinking-level dropdown trigger inside the panel
    // It's the button that contains "chat.thinkingLevel.medium" inside the panel
    const thinkingTriggers = Array.from(
      container.querySelectorAll("button"),
    ).filter((el) =>
      el.textContent?.includes("chat.thinkingLevel.medium"),
    );
    // The second match is the thinking-level dropdown trigger in the right column
    act(() => thinkingTriggers[1]?.click());
    // Now click an option in the nested dropdown
    const extremeBtn = Array.from(
      container.querySelectorAll('[role="option"]'),
    ).find((el) =>
      el.textContent?.includes("chat.thinkingLevel.extreme"),
    ) as HTMLElement;
    act(() => extremeBtn?.click());
    expect(onSelectThinkingLevel).toHaveBeenCalledWith("extreme");
  });

  it("displays context info in the panel", () => {
    render();
    act(() => getChipButton()?.click());
    expect(container.textContent).toContain("Context: 45K / 80K  (56%)");
  });

  it("closes panel on Escape key", () => {
    render();
    act(() => getChipButton()?.click());
    expect(panelIsOpen()).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(panelIsOpen()).toBe(false);
  });

  it("does not open panel when disabled", () => {
    render({ modelMenuDisabled: true });
    act(() => getChipButton()?.click());
    expect(panelIsOpen()).toBe(false);
  });

  it("does not open panel when modelOptions is empty", () => {
    render({ model: "", modelOptions: [] });
    act(() => getChipButton()?.click());
    expect(panelIsOpen()).toBe(false);
  });

  it("shows Provider A and Provider B groups", () => {
    render();
    act(() => getChipButton()?.click());
    expect(container.textContent).toContain("Provider A");
    expect(container.textContent).toContain("Provider B");
  });

  it("highlights selected model with aria-selected", () => {
    render();
    act(() => getChipButton()?.click());
    const selectedOption = Array.from(
      container.querySelectorAll('[role="option"]'),
    ).find(
      (el) =>
        el.getAttribute("aria-selected") === "true" &&
        el.textContent?.includes("Model One"),
    );
    expect(selectedOption).toBeTruthy();
  });
});
