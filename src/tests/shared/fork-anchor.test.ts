import { describe, expect, it } from "vitest";
import {
  buildForkAnchor,
  findForkAnchorIndex,
  FORK_ANCHOR_MAX_DELTA_MS,
} from "../../shared/fork-anchor";

describe("buildForkAnchor", () => {
  it("uses the first text block and keeps its length", () => {
    const anchor = buildForkAnchor({
      content: [
        { type: "text", text: "  你好  " },
        { type: "text", text: "第二段" },
      ],
    });
    expect(anchor).toBe("text:2:你好");
  });

  it("skips thinking blocks so renderer and JSONL sides agree", () => {
    // 渲染层渲染前剥掉思考块，JSONL 一侧保留 —— 锚点必须跳过它
    const withThinking = buildForkAnchor({
      content: [
        { type: "thinking", thinking: "先想想" },
        { type: "text", text: "结论" },
      ],
    });
    const stripped = buildForkAnchor({
      content: [{ type: "text", text: "结论" }],
    });
    expect(withThinking).toBe(stripped);
  });

  it("falls back to tool ids when a message has no text", () => {
    expect(
      buildForkAnchor({
        content: [
          { type: "thinking", thinking: "..." },
          { type: "tool_use", id: "call_1", name: "bash", input: {} },
        ],
      }),
    ).toBe("tool_use:call_1");
    expect(
      buildForkAnchor({
        content: [{ type: "tool_result", toolUseId: "call_1", content: "ok" }],
      }),
    ).toBe("tool_result:call_1");
  });

  it("caps very long text at 400 chars", () => {
    const anchor = buildForkAnchor({
      content: [{ type: "text", text: "x".repeat(1000) }],
    });
    expect(anchor).toBe(`text:1000:${"x".repeat(400)}`);
  });

  it("returns null without a stable block", () => {
    expect(buildForkAnchor({ content: [] })).toBeNull();
    expect(
      buildForkAnchor({
        content: [
          { type: "image", source: { data: "a", media_type: "image/png" } },
        ],
      }),
    ).toBeNull();
    expect(buildForkAnchor(null)).toBeNull();
  });
});

describe("findForkAnchorIndex", () => {
  const messages = [
    { id: "a1", content: [{ type: "text", text: "同一句" }] },
    { id: "a2", content: [{ type: "text", text: "别的" }] },
    { id: "a3", content: [{ type: "text", text: "同一句" }] },
  ];

  it("returns the last match so a repeated text lands on the recent card", () => {
    const anchor = buildForkAnchor(messages[0]);
    expect(findForkAnchorIndex(messages, anchor)).toBe(2);
  });

  it("returns -1 for a missing or empty anchor", () => {
    expect(findForkAnchorIndex(messages, "text:2:nope")).toBe(-1);
    expect(findForkAnchorIndex(messages, null)).toBe(-1);
  });
});

describe("findForkAnchorIndex with a timestamp", () => {
  const messages = [
    { id: "a1", timestamp: 1_000, content: [{ type: "text", text: "同一句" }] },
    { id: "a2", timestamp: 5_000, content: [{ type: "text", text: "同一句" }] },
    { id: "a3", timestamp: 9_000, content: [{ type: "text", text: "同一句" }] },
  ];
  const anchor = buildForkAnchor(messages[0]);

  it("picks the match closest to the clicked message timestamp", () => {
    expect(findForkAnchorIndex(messages, anchor, 1_100)).toBe(0);
    expect(findForkAnchorIndex(messages, anchor, 4_800)).toBe(1);
    expect(findForkAnchorIndex(messages, anchor, 8_000)).toBe(2);
  });

  it("falls back to the last match without a usable timestamp", () => {
    expect(findForkAnchorIndex(messages, anchor, null)).toBe(2);
    expect(findForkAnchorIndex(messages, anchor, Number.NaN)).toBe(2);
  });
});

describe("sandbox path rewriting", () => {
  // 沙盒会话里助手正文送到渲染层前会把真实沙盒路径改写成 /workspace/...
  // （JSONL 里是真实路径）—— 两边折叠路径后必须算出同一个锚点
  it("collapses path-like tokens so both sides agree", () => {
    const fromJsonl = buildForkAnchor({
      content: [
        {
          type: "text",
          text: "改好了 /Users/zoujichun/.deskwand/sandbox/abc123/src/a.ts 里的判断。",
        },
      ],
    });
    const fromRenderer = buildForkAnchor({
      content: [
        {
          type: "text",
          text: "改好了 /workspace/src/a.ts 里的判断。",
        },
      ],
    });
    expect(fromJsonl).toBe(fromRenderer);
  });

  it("keeps different texts apart", () => {
    expect(
      buildForkAnchor({
        content: [{ type: "text", text: "改好了 /workspace/a.ts" }],
      }),
    ).not.toBe(
      buildForkAnchor({
        content: [{ type: "text", text: "改坏了 /workspace/a.ts" }],
      }),
    );
  });
});

describe("findForkAnchorIndex 的接受上限", () => {
  const messages = [
    { id: "a1", timestamp: 1_000, content: [{ type: "text", text: "好的。" }] },
  ];
  const anchor = buildForkAnchor(messages[0]);

  it("rejects a match that is too far in time", () => {
    // 点的是没落盘的错误气泡（文本照样是「好的。」），不能静默分叉到别的回合
    expect(
      findForkAnchorIndex(
        messages,
        anchor,
        1_000 + FORK_ANCHOR_MAX_DELTA_MS + 1,
      ),
    ).toBe(-1);
  });

  it("still returns the only match when the timestamps are unusable", () => {
    const noTs = [{ id: "a1", content: [{ type: "text", text: "好的。" }] }];
    expect(findForkAnchorIndex(noTs, anchor, 999_999)).toBe(0);
  });
});
