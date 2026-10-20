// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionSearchShortcut } from "../../renderer/hooks/useSessionSearchShortcut";
import { useAppStore } from "../../renderer/store";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useSessionSearchShortcut", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onOpen = vi.fn();

  function Harness({ enabled }: { enabled?: boolean }): null {
    useSessionSearchShortcut(onOpen, enabled);
    return null;
  }

  async function mount(enabled?: boolean): Promise<void> {
    await act(async () => {
      root.render(React.createElement(Harness, { enabled }));
    });
  }

  async function press(init: KeyboardEventInit): Promise<void> {
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", bubbles: true, ...init }),
      );
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    useAppStore.setState({ sessionSearchOpen: false });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await mount();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("opens on ⌘K and on Ctrl+K", async () => {
    await press({ code: "KeyK", metaKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);

    await press({ code: "KeyK", ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("leaves ⌘⇧K (capture an idea) and ⌘⌥K alone", async () => {
    await press({ code: "KeyK", metaKey: true, shiftKey: true });
    await press({ code: "KeyK", metaKey: true, altKey: true });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores repeats, other keys and already-handled events", async () => {
    await press({ code: "KeyK", metaKey: true, repeat: true });
    await press({ code: "KeyJ", metaKey: true });

    const handled = new KeyboardEvent("keydown", {
      code: "KeyK",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    await act(async () => {
      window.dispatchEvent(handled);
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", async () => {
    await mount(false);
    await press({ code: "KeyK", metaKey: true });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps the palette open instead of toggling it closed", async () => {
    const open = () => useAppStore.getState().openSessionSearch();
    onOpen.mockImplementation(open);

    await press({ code: "KeyK", metaKey: true });
    expect(useAppStore.getState().sessionSearchOpen).toBe(true);

    await press({ code: "KeyK", metaKey: true });
    expect(useAppStore.getState().sessionSearchOpen).toBe(true);
  });
});
