import { describe, it, expect, beforeAll } from "vitest";
import { matchesKey, Key, TuiMainScreen } from "@earendil-works/pi-tui";
import {
  BorderedLoader,
  ToolExecutionComponent,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { createNoopTheme } from "../../main/extensions/ui/theme-utils";

class MemoryTerminal {
  output = "";
  start() {}
  stop() {}
  drainInput() {
    return Promise.resolve();
  }
  write(data: string) {
    this.output += data;
  }
  get columns() {
    return 60;
  }
  get rows() {
    return 20;
  }
  get kittyProtocolActive() {
    return false;
  }
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
}

describe("TUI virtual terminal spike contract", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  it("renders official components into a memory terminal", async () => {
    const term = new MemoryTerminal();
    const tui = new TuiMainScreen(term);
    const theme = createNoopTheme();
    tui.start();
    tui.addChild(new BorderedLoader(tui, theme, "Working..."));
    tui.addChild(
      new ToolExecutionComponent(
        "bash",
        "spike-1",
        { command: "echo hi" },
        undefined,
        undefined,
        tui,
        process.cwd(),
      ),
    );
    tui.requestRender();
    await new Promise((r) => setTimeout(r, 80));
    tui.stop();
    expect(term.output.length).toBeGreaterThan(0);
  });

  it("normalizes common key sequences for matchesKey", () => {
    expect(matchesKey("\x1b[A", Key.up)).toBe(true);
    expect(matchesKey("\x1b[B", Key.down)).toBe(true);
    expect(matchesKey("\x1b[1;5A", Key.ctrl("up"))).toBe(true);
    expect(matchesKey("\r", Key.enter)).toBe(true);
    expect(matchesKey("\x1b", Key.escape)).toBe(true);
  });
});
