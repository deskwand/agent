import { describe, it, expect, vi } from "vitest";
import { TuiModalManager } from "../../main/extensions/ui/tui-modal-manager";
import type { Component } from "@earendil-works/pi-tui";

describe("TuiModalManager", () => {
  function makeManager() {
    const events: string[] = [];
    const frames: string[] = [];
    const manager = new TuiModalManager({
      onOpen: () => events.push("open"),
      onClose: () => events.push("close"),
      onFrame: (chunk) => frames.push(chunk),
      onWidgets: () => events.push("widgets"),
      onTitleChange: () => {},
    });
    return { manager, events, frames };
  }

  it("opens a custom component and resolves with done value", async () => {
    const { manager, events } = makeManager();
    const promise = manager.openCustom<string>((_tui, _theme, _kb, done) => {
      const component: Component = {
        render: () => ["hello"],
        invalidate: () => {},
      };
      queueMicrotask(() => done("picked"));
      return component;
    });
    await expect(promise).resolves.toBe("picked");
    expect(events).toContain("open");
    expect(events).toContain("close");
  });

  it("forwards keyboard input into the terminal", async () => {
    const { manager } = makeManager();
    const inputSpy = vi.fn();
    manager.terminal.start(inputSpy as never, () => {});
    manager.injectInput("\x1b[A");
    expect(inputSpy).toHaveBeenCalledWith("\x1b[A");
  });

  it("renders widget factory into the TUI", async () => {
    const { manager, events } = makeManager();
    manager.setWidget("status", () => ({
      render: () => ["line1"],
      invalidate: () => {},
    }));
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toContain("widgets");
  });

  it("closeCurrent resolves pending custom with undefined", async () => {
    const { manager } = makeManager();
    const promise = manager.openCustom<string>((_t, _th, _kb, _done) => ({
      render: () => [],
      invalidate: () => {},
    }));
    manager.closeCurrent();
    await expect(promise).resolves.toBeUndefined();
  });
});
