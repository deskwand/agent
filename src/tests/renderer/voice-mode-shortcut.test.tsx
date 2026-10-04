// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceModeShortcut } from "../../renderer/hooks/useVoiceModeShortcut";

function Harness({ onToggle }: { onToggle: () => void }) {
  useVoiceModeShortcut(onToggle);
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

function render(onToggle: () => void) {
  act(() => {
    root = createRoot(container);
    root.render(<Harness onToggle={onToggle} />);
  });
}

function press(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", init));
  });
}

describe("useVoiceModeShortcut", () => {
  it("fires on Cmd+Shift+Space", () => {
    const onToggle = vi.fn();
    render(onToggle);
    press({ code: "Space", key: " ", metaKey: true, shiftKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("fires on Ctrl+Shift+Space too (non-macOS)", () => {
    const onToggle = vi.fn();
    render(onToggle);
    press({ code: "Space", key: " ", ctrlKey: true, shiftKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("ignores a bare Space, and Space with only one modifier", () => {
    const onToggle = vi.fn();
    render(onToggle);
    press({ code: "Space", key: " " });
    press({ code: "Space", key: " ", metaKey: true });
    press({ code: "Space", key: " ", shiftKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("ignores other keys with the same modifiers", () => {
    const onToggle = vi.fn();
    render(onToggle);
    press({ code: "KeyV", key: "v", metaKey: true, shiftKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("stops listening after unmount", () => {
    const onToggle = vi.fn();
    render(onToggle);
    act(() => root.unmount());
    press({ code: "Space", key: " ", metaKey: true, shiftKey: true });
    expect(onToggle).not.toHaveBeenCalled();
  });
});
