import { describe, expect, it } from "vitest";
import type { ContentBlock, Message } from "../../renderer/types";
import {
  buildContextBreakdown,
  categorizeMessage,
  estimateTextTokens,
} from "../../renderer/utils/context-breakdown";

describe("estimateTextTokens", () => {
  it("returns 0 for empty text", () => {
    expect(estimateTextTokens("")).toBe(0);
  });

  it("counts latin text at roughly four characters per token", () => {
    expect(estimateTextTokens("abcdefgh")).toBe(2);
  });

  it("counts CJK characters one token each", () => {
    expect(estimateTextTokens("你好世界")).toBe(4);
  });

  it("mixes CJK and latin", () => {
    // 2 CJK + 4 latin → 2 + 1
    expect(estimateTextTokens("你好abcd")).toBe(3);
  });

  it("counts each emoji as one token, not as two UTF-16 units", () => {
    expect(estimateTextTokens("🙂🙂")).toBe(2);
  });
});

function msg(role: Message["role"], content: ContentBlock[]): Message {
  return { id: "m", sessionId: "s1", role, content, timestamp: 1 };
}

const image = (): ContentBlock => ({
  type: "image",
  source: {
    type: "base64",
    media_type: "image/png",
    data: "A".repeat(400_000),
  },
});

describe("categorizeMessage", () => {
  it("reuses the cached map for the same message object", () => {
    const message = msg("assistant", [{ type: "text", text: "a".repeat(400) }]);
    expect(categorizeMessage(message)).toBe(categorizeMessage(message));
  });

  it("recomputes for a new message object with identical content", () => {
    const first = msg("assistant", [{ type: "text", text: "a".repeat(400) }]);
    const next = { ...first }; // 流式追加时是这种新对象
    expect(categorizeMessage(next)).not.toBe(categorizeMessage(first));
    expect(categorizeMessage(next).get("assistant")).toBe(100);
  });

  it("splits tool results before role, since they are role=assistant", () => {
    const message = msg("assistant", [
      { type: "tool_result", toolUseId: "t1", content: "d".repeat(400) },
    ]);
    const sums = categorizeMessage(message);
    expect(sums.get("toolResults")).toBe(100);
    expect(sums.has("assistant")).toBe(false);
  });
});

describe("buildContextBreakdown", () => {
  it("returns no rows when there is no usage yet", () => {
    expect(buildContextBreakdown([msg("user", [])], 0, 1_000_000).rows).toEqual(
      [],
    );
    expect(
      buildContextBreakdown([msg("user", [])], null, 1_000_000).rows,
    ).toEqual([]);
  });

  it("returns no rows when no history is loaded", () => {
    expect(buildContextBreakdown([], 50_000, 1_000_000).rows).toEqual([]);
  });

  it("splits blocks into categories and keeps the remainder as system", () => {
    const messages = [
      msg("user", [{ type: "text", text: "a".repeat(400) }]),
      msg("assistant", [
        { type: "text", text: "b".repeat(400) },
        { type: "thinking", thinking: "c".repeat(400) },
        {
          type: "tool_use",
          id: "t1",
          name: "read",
          input: { path: "x".repeat(400) },
        },
      ]),
      msg("assistant", [
        { type: "tool_result", toolUseId: "t1", content: "d".repeat(400) },
      ]),
    ];
    const result = buildContextBreakdown(messages, 10_000, 100_000);
    const byId = Object.fromEntries(result.rows.map((r) => [r.id, r.tokens]));

    expect(byId.user).toBe(100);
    expect(byId.assistant).toBe(100);
    expect(byId.thinking).toBe(100);
    expect(byId.toolCalls).toBeGreaterThan(100); // 含 name + JSON
    expect(byId.toolResults).toBe(100);
    expect(byId.system).toBeGreaterThan(0);
    // 残差法的验收：所有行加起来正好是总量
    expect(Object.values(byId).reduce((acc, n) => acc + n, 0)).toBe(10_000);
  });

  it("counts an image by a constant, not by its base64 length", () => {
    const result = buildContextBreakdown(
      [msg("user", [image()])],
      200_000,
      1_000_000,
    );
    expect(result.rows.find((r) => r.id === "media")?.tokens).toBe(1000);
  });

  it("counts file attachments by path, not by payload size", () => {
    const result = buildContextBreakdown(
      [
        msg("user", [
          {
            type: "file_attachment",
            filename: "notes.md",
            relativePath: "attachments/notes.md",
            size: 10_000_000,
          },
        ]),
      ],
      10_000,
      100_000,
    );
    expect(result.rows.find((r) => r.id === "media")?.tokens).toBeLessThan(20);
  });

  it("sorts rows by size, biggest first", () => {
    const result = buildContextBreakdown(
      [
        msg("user", [{ type: "text", text: "a".repeat(40) }]),
        msg("assistant", [{ type: "text", text: "b".repeat(4000) }]),
      ],
      20_000,
      100_000,
    );
    const tokens = result.rows.map((r) => r.tokens);
    expect(tokens).toEqual([...tokens].sort((a, b) => b - a));
  });

  it("reports per-row and free percentages against the window", () => {
    const result = buildContextBreakdown(
      [msg("user", [{ type: "text", text: "a".repeat(400) }])],
      25_000,
      100_000,
    );
    expect(result.windowTokens).toBe(100_000);
    expect(result.freeTokens).toBe(75_000);
    expect(result.freePercent).toBeCloseTo(75);
    expect(result.rows.find((r) => r.id === "system")?.percent).toBeCloseTo(
      24.9,
    );
  });

  it("maps an unknown window to null instead of a fake 0%", () => {
    const result = buildContextBreakdown(
      [msg("user", [{ type: "text", text: "a".repeat(400) }])],
      25_000,
      undefined,
    );
    expect(result.windowTokens).toBeNull();
    expect(result.freeTokens).toBeNull();
    expect(result.rows.every((r) => r.percent === 0)).toBe(true);
  });

  it("scales rows and drops the system row when compacted history exceeds the total", () => {
    const result = buildContextBreakdown(
      [
        msg("user", [{ type: "text", text: "a".repeat(40_000) }]),
        msg("assistant", [{ type: "text", text: "b".repeat(40_000) }]),
      ],
      10_000,
      100_000,
    );
    expect(result.scaled).toBe(true);
    expect(result.rows.some((r) => r.id === "system")).toBe(false);
    const sum = result.rows.reduce((acc, r) => acc + r.tokens, 0);
    expect(sum).toBeLessThanOrEqual(10_000); // 舍入修正保证不超总量
    expect(sum).toBeGreaterThan(9_900);
  });

  it("keeps a system row from the last known residual while scaling", () => {
    // 压缩后：残差算不出来，但上一次未折算时测得的系统侧份额仍然有效，
    // 不能因为折算就把最大的真实分类整个吞掉。
    const result = buildContextBreakdown(
      [
        msg("user", [{ type: "text", text: "a".repeat(40_000) }]),
        msg("assistant", [{ type: "text", text: "b".repeat(40_000) }]),
      ],
      10_000,
      100_000,
      6_000,
    );
    expect(result.rows.find((r) => r.id === "system")?.tokens).toBe(6_000);
    const sum = result.rows.reduce((acc, r) => acc + r.tokens, 0);
    expect(sum).toBe(10_000);
  });

  it("ignores a hint that does not fit the total", () => {
    const result = buildContextBreakdown(
      [msg("user", [{ type: "text", text: "a".repeat(40_000) }])],
      10_000,
      100_000,
      50_000,
    );
    expect(result.rows.some((r) => r.id === "system")).toBe(false);
    expect(result.rows.reduce((acc, r) => acc + r.tokens, 0)).toBe(10_000);
  });
});
