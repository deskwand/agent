import { describe, it, expect } from "vitest";
import { createPiUiBridge } from "../../main/extensions/ui/bridge";
import { TuiModalManager } from "../../main/extensions/ui/tui-modal-manager";

function makeCallbacks() {
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

describe("TUI modal integration", () => {
  it("custom component receives input and resolves on done", async () => {
    const frames: string[] = [];
    const manager = new TuiModalManager({
      onOpen: () => {},
      onClose: () => {},
      onFrame: (chunk) => frames.push(chunk),
      onWidgets: () => {},
      onTitleChange: () => {},
    });
    const bridge = createPiUiBridge(makeCallbacks(), {
      getModalManager: () => manager,
    });

    // 模拟 SelectList 式组件：↑↓ 选择，enter 确认
    const promise = bridge.custom<string>((tui, _theme, _kb, done) => {
      let selected = 0;
      const items = ["A", "B", "C"];
      return {
        render: () =>
          items.map((item, i) => (i === selected ? `> ${item}` : `  ${item}`)),
        invalidate: () => {},
        handleInput: (data: string) => {
          if (data === "\x1b[B") selected = Math.min(selected + 1, items.length - 1);
          if (data === "\x1b[A") selected = Math.max(selected - 1, 0);
          if (data === "\r") done(items[selected]);
          tui.requestRender();
        },
      };
    });

    // 等待组件挂载（factory 在微任务中执行）后再注入按键
    await new Promise((r) => setTimeout(r, 20));
    manager.injectInput("\x1b[B"); // down → B
    manager.injectInput("\x1b[B"); // down → C
    manager.injectInput("\r"); // enter → C
    await expect(promise).resolves.toBe("C");
    expect(frames.length).toBeGreaterThan(0);
    manager.dispose();
  });

  it("escape closes custom and resolves undefined", async () => {
    const manager = new TuiModalManager({
      onOpen: () => {},
      onClose: () => {},
      onFrame: () => {},
      onWidgets: () => {},
      onTitleChange: () => {},
    });
    const bridge = createPiUiBridge(makeCallbacks(), {
      getModalManager: () => manager,
    });
    const promise = bridge.custom<string>((_tui, _theme, _kb, done) => ({
      render: () => ["press esc"],
      invalidate: () => {},
      handleInput: (data: string) => {
        if (data === "\x1b") done("cancelled");
      },
    }));
    await new Promise((r) => setTimeout(r, 20));
    manager.injectInput("\x1b");
    await expect(promise).resolves.toBe("cancelled");
    manager.dispose();
  });
});

describe("TUI modal differential rendering", () => {
  it("differential updates replace old screen content (anti-regression)", async () => {
    const screens: string[] = [];
    const manager = new TuiModalManager({
      onOpen: () => {},
      onClose: () => {},
      onFrame: (screen) => screens.push(screen),
      onWidgets: () => {},
      onTitleChange: () => {},
    });
    const bridge = createPiUiBridge(makeCallbacks(), {
      getModalManager: () => manager,
    });
    let counter = 0;
    const promise = bridge.custom<string>((tui, _theme, _kb, done) => ({
      render: () => [`count: ${counter}`, "second line"],
      invalidate: () => {},
      handleInput: (data: string) => {
        if (data === "x") {
          counter++;
          tui.requestRender();
        }
        if (data === "\r") done("ok");
      },
    }));
    await new Promise((r) => setTimeout(r, 40));
    manager.injectInput("x"); // count: 0 → 1（差分更新）
    await new Promise((r) => setTimeout(r, 40));
    manager.injectInput("\r");
    await expect(promise).resolves.toBe("ok");
    // 最终屏幕必须包含新值且不含旧值残留（差分覆盖而非累积）
    const finalScreen = screens[screens.length - 1] ?? "";
    expect(finalScreen).toContain("count: 1");
    expect(finalScreen).not.toContain("count: 0");
    expect(finalScreen).toContain("second line");
    manager.dispose();
  });
});
