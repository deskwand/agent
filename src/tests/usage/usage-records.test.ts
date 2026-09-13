import { describe, expect, it } from "vitest";
import {
  buildAuxUsageRecord,
  buildChatUsageRecord,
  buildSubagentUsageRecord,
} from "../../main/usage/usage-records";

const tokens = {
  input: 1,
  output: 2,
  totalPromptInput: 3,
  cacheRead: 4,
  cacheWrite: 5,
};

describe("buildChatUsageRecord", () => {
  it("keys on the message itself, so a forked copy collapses", () => {
    const rec = buildChatUsageRecord(
      "s1",
      { timestamp: 1_760_000_000_000, provider: "deepseek", model: "m1" },
      { provider: null, model: null },
      tokens,
      1_760_000_000_999,
    );
    expect(rec).toMatchObject({
      ts: 1_760_000_000_000,
      sessionId: "s1",
      source: "chat",
      purpose: null,
      // No session id in the key: forking copies the message verbatim, and a
      // session-scoped key would book the forked prefix a second time.
      dedupKey: "chat:1760000000000:1:2:4:5",
      model: "m1",
      provider: "deepseek",
      input: 1,
      output: 2,
      cacheRead: 4,
      cacheWrite: 5,
    });
  });

  it("produces the same key for the same message in a different session", () => {
    const args = [
      { timestamp: 1_760_000_000_000, provider: "deepseek", model: "m1" },
      { provider: null, model: null },
      tokens,
      1_760_000_000_999,
    ] as const;
    const original = buildChatUsageRecord("s1", ...args);
    const forked = buildChatUsageRecord("s2-fork", ...args);
    expect(forked.dedupKey).toBe(original.dedupKey);
    expect(forked.sessionId).toBe("s2-fork");
  });

  it("falls back to the session model/provider and to now", () => {
    const rec = buildChatUsageRecord(
      "s1",
      {},
      { provider: "openai", model: "m2" },
      tokens,
      1_760_000_000_999,
    );
    expect(rec).toMatchObject({
      ts: 1_760_000_000_999,
      model: "m2",
      provider: "openai",
    });
  });

  it("never emits undefined / NaN for cache fields", () => {
    const rec = buildChatUsageRecord(
      "s1",
      { timestamp: 5 },
      {},
      { input: 1, output: 2, totalPromptInput: 3 },
      9,
    );
    expect(rec.cacheRead).toBe(0);
    expect(rec.cacheWrite).toBe(0);
  });
});

describe("buildSubagentUsageRecord", () => {
  it("keys by tool call id and leaves model/provider null", () => {
    const rec = buildSubagentUsageRecord(
      "s1",
      "call-1",
      { input: 10, output: 20, cacheRead: 30, cacheWrite: 0 },
      42,
    );
    expect(rec).toMatchObject({
      ts: 42,
      source: "subagent",
      dedupKey: "sub:s1:call-1",
      model: null,
      provider: null,
      input: 10,
      output: 20,
      cacheRead: 30,
    });
  });

  it("returns null when the tool result carries no usage", () => {
    expect(buildSubagentUsageRecord("s1", "call-1", undefined, 42)).toBeNull();
  });

  it("treats missing numeric fields as 0 and ignores garbage", () => {
    const rec = buildSubagentUsageRecord(
      "s1",
      "c",
      { input: "nope" as unknown, output: 5 },
      1,
    );
    expect(rec).toMatchObject({
      input: 0,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });
});

describe("buildAuxUsageRecord", () => {
  it("carries a null dedup key and the purpose", () => {
    const rec = buildAuxUsageRecord(tokens, "title", "m1", "deepseek", "s1", 7);
    expect(rec).toMatchObject({
      ts: 7,
      source: "aux",
      purpose: "title",
      dedupKey: null,
      sessionId: "s1",
    });
  });

  it("accepts a null session", () => {
    expect(
      buildAuxUsageRecord(tokens, "memory", "m1", "deepseek", null, 7)
        .sessionId,
    ).toBeNull();
  });
});
