import { describe, it, expect } from "vitest";
import {
  getTurnPreviewText,
  getTickOffsets,
  getTickStyles,
} from "../../renderer/components/MessageNavRail";
import type { Message } from "../../renderer/types";

function msg(blocks: Message["content"]): Message {
  return {
    id: "1",
    role: "assistant",
    content: blocks,
    sessionId: "s1",
    createdAt: 0,
    timestamp: 0,
  } as Message;
}

describe("getTurnPreviewText", () => {
  it("returns text block", () => {
    const result = getTurnPreviewText(
      msg([{ type: "text", text: "Hello world" }]),
    );
    expect(result).toEqual({ kind: "text", value: "Hello world" });
  });

  it("returns last text block when multiple", () => {
    const result = getTurnPreviewText(
      msg([
        { type: "text", text: "first" },
        { type: "text", text: "last" },
      ]),
    );
    expect(result).toEqual({ kind: "text", value: "last" });
  });

  it("returns thinking block when no text", () => {
    const result = getTurnPreviewText(
      msg([{ type: "thinking", thinking: "hmm" }]),
    );
    expect(result).toEqual({ kind: "thinking", value: "hmm" });
  });

  it("returns tool block when no text or thinking", () => {
    const result = getTurnPreviewText(
      msg([{ type: "tool_use", id: "t1", name: "bash", input: {} }]),
    );
    expect(result).toEqual({ kind: "tool", value: "bash" });
  });

  it("returns empty when no matching blocks", () => {
    const result = getTurnPreviewText(
      msg([
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png" as const,
            data: "",
          },
        },
      ]),
    );
    expect(result).toEqual({ kind: "empty" });
  });

  it("truncates long text", () => {
    const result = getTurnPreviewText(
      msg([{ type: "text", text: "a".repeat(200) }]),
      10,
    );
    expect(result).toEqual({ kind: "text", value: "a".repeat(10) + "…" });
  });

  it("handles non-array content", () => {
    const result = getTurnPreviewText({
      id: "1",
      role: "assistant",
      content: "string content" as never,
      sessionId: "s1",
      createdAt: 0,
      timestamp: 0,
    } as Message);
    expect(result).toEqual({ kind: "empty" });
  });
});

describe("getTickOffsets", () => {
  it("returns empty for n=0", () => {
    expect(getTickOffsets(400, 0)).toEqual([]);
  });

  it("returns empty for railHeight=0", () => {
    expect(getTickOffsets(0, 3)).toEqual([]);
  });

  it("centers single tick", () => {
    expect(getTickOffsets(400, 1)).toEqual([200]);
  });

  it("centers multiple ticks with gap", () => {
    // 3 ticks at gap 10: needed=20, top=(400-20)/2=190, offsets=[190,200,210]
    expect(getTickOffsets(400, 3, 10)).toEqual([190, 200, 210]);
  });

  it("compresses when rail too short", () => {
    // 5 ticks at gap 10: needed=40, railHeight=30 → compressed
    // compressed = max(4, (30-8)/4) = max(4, 5.5) = 5.5
    // offsets = [4, 9.5, 15, 20.5, 26]
    const result = getTickOffsets(30, 5, 10);
    expect(result).toHaveLength(5);
    expect(result[0]).toBeCloseTo(4);
    expect(result[1]).toBeCloseTo(9.5);
    expect(result[4]).toBeCloseTo(26);
  });

  it("uses default gap=10", () => {
    const result = getTickOffsets(300, 2);
    // needed=10, top=(300-10)/2=145, offsets=[145,155]
    expect(result).toEqual([145, 155]);
  });
});

describe("getTickStyles", () => {
  it("returns min styles when mouseY is null", () => {
    const styles = getTickStyles(null, [100, 200]);
    expect(styles).toEqual([
      { w: 8, op: 0.6, primary: false },
      { w: 8, op: 0.6, primary: false },
    ]);
  });

  it("returns min styles for empty offsets", () => {
    const styles = getTickStyles(100, []);
    expect(styles).toEqual([]);
  });

  it("marks closest tick as primary", () => {
    const styles = getTickStyles(105, [100, 200], 72, 6, 20, 0.5, 0.9);
    expect(styles[0].primary).toBe(true);
    expect(styles[1].primary).toBe(false);
  });

  it("scales width and opacity by distance", () => {
    // mouseY=100, offset=100 → dist=0 → t=1 → w=20, op=0.9
    const styles = getTickStyles(100, [100], 72, 6, 20, 0.5, 0.9);
    expect(styles[0].w).toBe(20);
    expect(styles[0].op).toBe(0.9);
  });

  it("far tick stays at min", () => {
    // offset=300, mouseY=100 → dist=200, maxDist=72 → t=0 → w=6, op=0.5
    const styles = getTickStyles(100, [300], 72, 6, 20, 0.5, 0.9);
    expect(styles[0].w).toBe(6);
    expect(styles[0].op).toBe(0.5);
  });
});
