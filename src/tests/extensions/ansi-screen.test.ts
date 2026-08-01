import { describe, it, expect } from "vitest";
import { AnsiScreenBuffer } from "../../main/extensions/ui/ansi-screen";

describe("AnsiScreenBuffer", () => {
  it("accumulates plain text lines", () => {
    const buf = new AnsiScreenBuffer();
    expect(buf.apply("line1\nline2\n")).toBe("line1\nline2");
  });

  it("clears a line with CSI 2K and rewrites in place (differential update)", () => {
    const buf = new AnsiScreenBuffer();
    expect(buf.apply("count: 0")).toBe("count: 0");
    expect(buf.apply("\r\x1b[2Kcount: 1")).toBe("count: 1");
    expect(buf.apply("\r\x1b[2Kcount: 2")).toBe("count: 2");
  });

  it("moves cursor up with CSI nA to update earlier lines (real TUI diff pattern)", () => {
    const buf = new AnsiScreenBuffer();
    buf.apply("> A\n  B\n  C");
    // 真实 pi-tui 差分：上移 + 行首 + 清行 + 新文本
    const updated = buf.apply("\x1b[2A\r\x1b[2K> D");
    expect(updated).toBe("> D\n  B\n  C");
  });

  it("clears screen with CSI 2J", () => {
    const buf = new AnsiScreenBuffer();
    buf.apply("old1\nold2");
    expect(buf.apply("\x1b[2Jnew1")).toBe("new1");
  });

  it("preserves SGR color sequences in the line", () => {
    const buf = new AnsiScreenBuffer();
    expect(buf.apply("plain\x1b[31mred\x1b[0m")).toBe("plain\x1b[31mred\x1b[0m");
  });

  it("ignores sync markers and cursor visibility sequences", () => {
    const buf = new AnsiScreenBuffer();
    expect(buf.apply("\x1b[?2026h\x1b[?25lhi\x1b[?25h")).toBe("hi");
  });

  it("trims trailing empty lines in snapshot", () => {
    const buf = new AnsiScreenBuffer();
    expect(buf.apply("a\n\n\n")).toBe("a");
  });
});
