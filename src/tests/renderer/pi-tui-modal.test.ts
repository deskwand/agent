import { describe, it, expect } from "vitest";
import {
  sanitizeAnsiChunk,
  estimateColumns,
  estimateRows,
} from "../../renderer/components/PiTuiModal";

describe("sanitizeAnsiChunk", () => {
  it("strips CSI cursor/clear sequences but keeps SGR colors", () => {
    const input =
      "\x1b[?2026h\x1b[2A\r\x1b[2Kcount: 1\x1b[0m\x1b]8;;\x07\x1b[?2026l";
    expect(sanitizeAnsiChunk(input)).toBe("count: 1\x1b[0m");
  });

  it("keeps plain text unchanged", () => {
    expect(sanitizeAnsiChunk("hello world")).toBe("hello world");
  });
});

describe("estimateColumns/estimateRows", () => {
  it("estimates columns from pixel width", () => {
    expect(estimateColumns(720)).toBe(100);
    expect(estimateColumns(50)).toBe(10); // 最小 10
  });

  it("estimates rows from pixel height", () => {
    expect(estimateRows(420)).toBe(23);
    expect(estimateRows(20)).toBe(3); // 最小 3
  });
});
