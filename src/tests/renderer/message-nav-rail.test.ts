import { describe, it, expect } from "vitest";
import { getTurnPreviewText } from "../../renderer/components/MessageNavRail";
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
