import { describe, it, expect, vi } from "vitest";
import { createPiUiBridge, type UiBridgeCallbacks } from "../../main/extensions/ui/bridge";
import { TuiModalManager } from "../../main/extensions/ui/tui-modal-manager";

function makeCallbacks(): UiBridgeCallbacks {
  return {
    dialog: async () => undefined,
    notify: () => {},
    setStatus: () => {},
    setWidgetText: () => {},
    setTitle: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    setWorking: () => {},
    setThinkingLabel: () => {},
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
}

describe("session shutdown cleanup", () => {
  it("onTerminalInput subscriptions are dropped after reset", () => {
    const ui = createPiUiBridge(makeCallbacks());
    const handler = vi.fn();
    ui.onTerminalInput(handler);
    ui.notifyTerminalInput("x");
    expect(handler).toHaveBeenCalledTimes(1);
    ui.resetTerminalInputHandlers();
    ui.notifyTerminalInput("x");
    expect(handler).toHaveBeenCalledTimes(1); // 不再收到
  });

  it("closeCurrent resolves pending custom on session shutdown", async () => {
    const manager = new TuiModalManager({
      onOpen: () => {},
      onClose: () => {},
      onFrame: () => {},
      onWidgets: () => {},
      onTitleChange: () => {},
    });
    const promise = manager.openCustom<string>((_t, _th, _kb, _done) => ({
      render: () => [],
      invalidate: () => {},
    }));
    manager.closeCurrent(); // 会话关闭清理调用
    await expect(promise).resolves.toBeUndefined();
  });
});
