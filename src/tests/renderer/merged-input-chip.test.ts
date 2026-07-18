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

const baseThinkingOptions = [
  "off",
  "low",
  "medium",
  "high",
  "extreme",
] as never[];

const baseProps = {
  model: "model-1",
  modelOptions: makeModelOptions(),
  activeProviderProfileKey: "profile-a" as never,
  onSelectModel: vi.fn(),
  modelMenuDisabled: false,
  thinkingLevel: "medium" as never,
  thinkingLevelOptions: baseThinkingOptions,
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
    const merged = { ...baseProps, ...props };
    act(() => {
      root.render(React.createElement(MergedInputChip, merged));
    });
  }

  function panelIsOpen(): boolean {
    // The panel wrapper div has "invisible" class when closed
    const wrappers = container.querySelectorAll(
      'div.absolute.right-0.bottom-0.z-30',
    );
    for (const el of wrappers) {
      if (el.classList.contains("invisible")) return false;
      return true;
    }
    return false;
  }

  function collapsedChip(): HTMLButtonElement | null {
    // The collapsed chip has rounded-full; the panel chip has rounded-b-full
    return container.querySelector("button.rounded-full");
  }

  function getCenterModelEntry(): HTMLElement | null {
    // Center column: "chat.switchModel" text among the panel's direct children
    return Array.from(container.querySelectorAll(".px-3.py-2.rounded-lg")).find(
      (el) => el.textContent?.includes("chat.switchModel"),
    ) as HTMLElement | null;
  }

  function getCenterThinkingEntry(): HTMLElement | null {
    return Array.from(container.querySelectorAll(".px-3.py-2.rounded-lg")).find(
      (el) => el.textContent?.includes("chat.thinkingLevel"),
    ) as HTMLElement | null;
  }

  it("renders model id and thinking level in collapsed chip", () => {
    render();
    const chip = collapsedChip();
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain("model-1");
    expect(chip?.textContent).toContain("chat.thinkingLevel.medium");
    expect(panelIsOpen()).toBe(false);
  });

  it("renders fallback when model is empty and modelOptions is empty", () => {
    render({ model: "", modelOptions: [] });
    const chip = collapsedChip();
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain("chat.noModel");
  });

  it("opens panel on chip click", () => {
    render();
    const chip = collapsedChip();
    act(() => chip?.click());
    expect(panelIsOpen()).toBe(true);
  });

  it("shows center column with model and thinking anchors when panel opens", () => {
    render();
    act(() => collapsedChip()?.click());
    expect(getCenterModelEntry()).toBeTruthy();
    expect(getCenterThinkingEntry()).toBeTruthy();
  });

  it("reveals left column on hover of model anchor in center", () => {
    render();
    act(() => collapsedChip()?.click());
    // Hover center "chat.switchModel" entry
    const modelEntry = getCenterModelEntry();
    act(() => {
      modelEntry?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    // Search input should now be visible (left column is shown)
    expect(
      container.querySelector('[placeholder="chat.searchModel"]'),
    ).toBeTruthy();
  });

  it("reveals right column on hover of thinking anchor in center", () => {
    render();
    act(() => collapsedChip()?.click());
    const thinkingEntry = getCenterThinkingEntry();
    act(() => {
      thinkingEntry?.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true }),
      );
    });
    // Thinking options should be visible
    expect(container.textContent).toContain("chat.thinkingLevel.off");
    expect(container.textContent).toContain("chat.thinkingLevel.extreme");
  });

  it("calls onSelectModel when a model is clicked in left column", () => {
    const onSelectModel = vi.fn();
    render({ onSelectModel });
    act(() => collapsedChip()?.click());
    // Hover model anchor to reveal left
    act(() => {
      getCenterModelEntry()?.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true }),
      );
    });
    // Click "Model Two"
    const modelTwoBtn = Array.from(
      container.querySelectorAll('[role="option"]'),
    ).find((el) => el.textContent?.includes("Model Two")) as HTMLElement;
    act(() => modelTwoBtn?.click());
    expect(onSelectModel).toHaveBeenCalledWith("profile-a", "model-2");
  });

  it("calls onSelectThinkingLevel when option clicked in right column", () => {
    const onSelectThinkingLevel = vi.fn();
    render({ onSelectThinkingLevel });
    act(() => collapsedChip()?.click());
    // Hover thinking anchor to reveal right
    act(() => {
      getCenterThinkingEntry()?.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true }),
      );
    });
    // Click "extreme"
    const extremeBtn = Array.from(
      container.querySelectorAll('[role="option"]'),
    ).find((el) =>
      el.textContent?.includes("chat.thinkingLevel.extreme"),
    ) as HTMLElement;
    act(() => extremeBtn?.click());
    expect(onSelectThinkingLevel).toHaveBeenCalledWith("extreme");
  });

  it("closes panel when a model is selected", () => {
    render();
    act(() => collapsedChip()?.click());
    act(() => {
      getCenterModelEntry()?.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true }),
      );
    });
    const modelTwoBtn = Array.from(
      container.querySelectorAll('[role="option"]'),
    ).find((el) => el.textContent?.includes("Model Two")) as HTMLElement;
    act(() => modelTwoBtn?.click());
    expect(panelIsOpen()).toBe(false);
  });

  it("closes panel on Escape key", () => {
    render();
    act(() => collapsedChip()?.click());
    expect(panelIsOpen()).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(panelIsOpen()).toBe(false);
  });

  it("does not open panel when disabled", () => {
    render({ modelMenuDisabled: true });
    act(() => collapsedChip()?.click());
    expect(panelIsOpen()).toBe(false);
  });

  it("does not open panel when modelOptions is empty", () => {
    render({ model: "", modelOptions: [] });
    act(() => collapsedChip()?.click());
    expect(panelIsOpen()).toBe(false);
  });

  it("filters model list on search in left column", () => {
    render();
    act(() => collapsedChip()?.click());
    act(() => {
      getCenterModelEntry()?.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true }),
      );
    });
    const input = container.querySelector(
      'input[placeholder="chat.searchModel"]',
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Two");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Model Two");
    expect(container.textContent).not.toContain("Model One");
  });

  it("shows Provider A and Provider B groups in left column", () => {
    render();
    act(() => collapsedChip()?.click());
    act(() => {
      getCenterModelEntry()?.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true }),
      );
    });
    expect(container.textContent).toContain("Provider A");
    expect(container.textContent).toContain("Provider B");
  });

  it("highlights selected model in left column", () => {
    render();
    act(() => collapsedChip()?.click());
    act(() => {
      getCenterModelEntry()?.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true }),
      );
    });
    const selected = Array.from(
      container.querySelectorAll('[role="option"]'),
    ).find(
      (el) =>
        el.getAttribute("aria-selected") === "true" &&
        el.textContent?.includes("Model One"),
    );
    expect(selected).toBeTruthy();
  });
});
