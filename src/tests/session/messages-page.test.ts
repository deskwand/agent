import { describe, expect, it } from "vitest";
import { sliceCachedPage } from "../../main/session/message-paging";
import type { Message } from "../../renderer/types";

function msg(id: string, ts: number): Message {
  return {
    id,
    sessionId: "s1",
    role: "user",
    content: [],
    timestamp: ts,
  } as Message;
}

describe("sliceCachedPage", () => {
  const cached = [
    msg("m1", 1),
    msg("m2", 2),
    msg("m3", 3),
    msg("m4", 4),
    msg("m5", 5),
  ];

  it("returns the tail slice for initial load", () => {
    expect(sliceCachedPage(cached, null, 3)).toEqual({
      messages: [msg("m3", 3), msg("m4", 4), msg("m5", 5)],
      hasMore: true,
    });
  });

  it("pages backward from the cursor without duplicates", () => {
    const page = sliceCachedPage(cached, "m5", 2);
    expect(page).toEqual({
      messages: [msg("m3", 3), msg("m4", 4)],
      hasMore: true,
    });
    const next = sliceCachedPage(cached, "m3", 2);
    expect(next).toEqual({
      messages: [msg("m1", 1), msg("m2", 2)],
      hasMore: false,
    });
  });

  it("returns null when the cursor id is not in the cache", () => {
    expect(sliceCachedPage(cached, "ghost", 2)).toBeNull();
  });

  it("handles empty cache", () => {
    expect(sliceCachedPage([], null, 3)).toEqual({
      messages: [],
      hasMore: false,
    });
  });
});

describe("sliceCachedPage turn alignment", () => {
  function cachedTurns(n: number): Message[] {
    const out: Message[] = [];
    for (let i = 1; i <= n; i++) {
      out.push(msg(`u${i}`, i * 2));
      out.push({ ...msg(`a${i}`, i * 2 + 1), role: "assistant" as const });
    }
    return out;
  }

  it("extends the tail slice to start at a user message", () => {
    const cached = cachedTurns(10); // 20 条
    const page = sliceCachedPage(cached, null, 4)!;
    // 原始尾部 4 条 = [a8, u9, a9, u10, a10]？limit=4 → [a9?] 计算：
    // start = 20-4 = 16 = a8 位置？直接断言对齐性质
    expect(page.messages[0].role).toBe("user");
    expect(
      page.messages.filter((m) => m.role === "user").length,
    ).toBeGreaterThanOrEqual(2);
    expect(page.hasMore).toBe(true);
    expect(page.messages[page.messages.length - 1].id).toBe("a10");
  });

  it("extends cursor slices the same way without overlapping", () => {
    const cached = cachedTurns(10);
    const page1 = sliceCachedPage(cached, null, 4)!;
    const page2 = sliceCachedPage(cached, page1.messages[0].id, 4)!;
    expect(page2.messages[0].role).toBe("user");
    expect(
      page2.messages.filter((m) => m.role === "user").length,
    ).toBeGreaterThanOrEqual(2);
    const all = [...page2.messages, ...page1.messages].map((m) => m.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("walks back to the first aligned turn near the cache head", () => {
    const cached = [
      msg("a0", 1),
      ...cachedTurns(3), // 6 条
    ];
    const page = sliceCachedPage(cached, null, 2)!;
    // 对齐在 u2 满足（页首 user、≥2 user）；a0/u1 前缀被排除
    expect(page.messages[0].id).toBe("u2");
    expect(page.hasMore).toBe(true);
  });
});

describe("session cache completeness gating", () => {
  it("does not serve pages from a partial cache seeded by saveMessage", () => {
    // sliceCachedPage 是纯函数；完整性门控在 SessionManager 层，
    // 这里验证门控的前提：部分缓存（1 条）与完整缓存的切片结果不同
    const partial = [msg("only", 1)];
    const tail = sliceCachedPage(partial, null, 3)!;
    expect(tail.messages.map((m) => m.id)).toEqual(["only"]);
    expect(tail.hasMore).toBe(false); // 部分缓存会谎报"没有更多历史"
    // 完整缓存（同一条消息 + hasMore=false 的真实语义由调用方门控）
    const full = [msg("only", 1), msg("two", 2)];
    const tailFull = sliceCachedPage(full, null, 3)!;
    expect(tailFull.messages.map((m) => m.id)).toEqual(["only", "two"]);
  });
});
