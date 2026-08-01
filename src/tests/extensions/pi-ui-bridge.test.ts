import { describe, it, expect, vi } from "vitest";
import {
  createPiUiBridge,
  type UiBridgeCallbacks,
} from "../../main/extensions/ui/bridge";
import { TuiModalManager } from "../../main/extensions/ui/tui-modal-manager";

function makeCallbacks(): UiBridgeCallbacks & { dialogCalls: unknown[] } {
  const dialogCalls: unknown[] = [];
  return {
    dialogCalls,
    dialog: async (request) => {
      dialogCalls.push(request);
      return "ok";
    },
    notify: () => {},
    setStatus: () => {},
    setWidgetText: () => {},
    setTitle: () => {},
    setEditorText: () => {},
    getEditorText: () => "current",
    setWorking: () => {},
    setThinkingLabel: () => {},
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
}

describe("createPiUiBridge", () => {
  it("routes select through dialog callback with RPC-shaped request", async () => {
    const cb = makeCallbacks();
    const ui = createPiUiBridge(cb);
    const result = await ui.select("Pick", ["A", "B"], { timeout: 5000 });
    expect(cb.dialogCalls).toHaveLength(1);
    const req = cb.dialogCalls[0] as {
      method: string;
      title: string;
      options: string[];
      timeout: number;
      type: string;
    };
    expect(req.type).toBe("extension_ui_request");
    expect(req.method).toBe("select");
    expect(req.title).toBe("Pick");
    expect(req.options).toEqual(["A", "B"]);
    expect(req.timeout).toBe(5000);
    expect(result).toBe("ok");
  });

  it("confirm resolves false on timeout when dialog hangs", async () => {
    const cb = makeCallbacks();
    cb.dialog = () => new Promise(() => {});
    const ui = createPiUiBridge(cb);
    const result = await ui.confirm("Sure?", "Really?", { timeout: 20 });
    expect(result).toBe(false);
  });

  it("custom() returns undefined without a modal manager (RPC degradation)", async () => {
    const ui = createPiUiBridge(makeCallbacks());
    const result = await ui.custom(() => ({
      render: () => [],
      invalidate: () => {},
    }));
    expect(result).toBeUndefined();
  });

  it("custom() routes through TuiModalManager when provided", async () => {
    const cb = makeCallbacks();
    let manager: TuiModalManager | undefined;
    const ui = createPiUiBridge(cb, { getModalManager: () => manager });
    expect(
      await ui.custom(() => ({ render: () => [], invalidate: () => {} })),
    ).toBeUndefined();
    const modalEvents: string[] = [];
    manager = new TuiModalManager({
      onOpen: () => modalEvents.push("open"),
      onClose: () => modalEvents.push("close"),
      onFrame: () => {},
      onWidgets: () => {},
      onTitleChange: () => {},
    });
    const result = await ui.custom<string>((_t, _th, _kb, done) => {
      queueMicrotask(() => done("ok"));
      return { render: () => ["x"], invalidate: () => {} };
    });
    expect(result).toBe("ok");
    expect(modalEvents).toContain("open");
    expect(modalEvents).toContain("close");
    manager.dispose();
  });

  it("onTerminalInput handlers receive forwarded input", () => {
    const ui = createPiUiBridge(makeCallbacks());
    const handler = vi.fn();
    ui.onTerminalInput(handler);
    ui.notifyTerminalInput("\x1b[A");
    expect(handler).toHaveBeenCalledWith("\x1b[A");
  });

  it("setTheme fails gracefully", () => {
    const ui = createPiUiBridge(makeCallbacks());
    expect(ui.setTheme("dark").success).toBe(false);
  });

  it("pasteToEditor delegates to setEditorText", () => {
    const cb = makeCallbacks();
    const spy = vi.fn();
    cb.setEditorText = spy;
    createPiUiBridge(cb).pasteToEditor("pasted");
    expect(spy).toHaveBeenCalledWith("pasted");
  });

  it("theme property resolves to a Theme instance", () => {
    const ui = createPiUiBridge(makeCallbacks());
    expect(ui.theme.fg("accent", "x")).toBeTruthy();
  });
});
