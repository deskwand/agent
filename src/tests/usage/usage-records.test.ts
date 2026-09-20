import { describe, expect, it } from "vitest";
import {
  buildAuxUsageRecord,
  buildChatUsageRecord,
  buildSubagentMessageRecord,
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

describe("buildSubagentMessageRecord", () => {
  const subUsage = {
    input: 100,
    output: 20,
    cacheRead: 3000,
    cacheWrite: 0,
    totalPromptInput: 3100,
  };

  it("stores the parent session as session_id and the child only in the key", () => {
    const record = buildSubagentMessageRecord(
      "parent-session",
      "01a0a59a-15c0-7325-928f-fd929599a5e8",
      "254bd435",
      {
        timestamp: 1_760_000_000_000,
        provider: "deskwand:deepseek",
        model: "deepseek-flash",
      },
      subUsage,
      999,
    );
    expect(record).toMatchObject({
      ts: 1_760_000_000_000,
      sessionId: "parent-session",
      provider: "deskwand:deepseek",
      model: "deepseek-flash",
      source: "subagent",
      purpose: null,
      dedupKey: "submsg:01a0a59a-15c0-7325-928f-fd929599a5e8:254bd435",
      input: 100,
      output: 20,
      cacheRead: 3000,
      cacheWrite: 0,
    });
  });

  it("keeps the same key for a replayed import", () => {
    const args = [
      "p",
      "c",
      "e1",
      { timestamp: 1, provider: "x", model: "y" },
      subUsage,
      0,
    ] as const;
    expect(buildSubagentMessageRecord(...args).dedupKey).toBe(
      buildSubagentMessageRecord(...args).dedupKey,
    );
  });

  it("falls back to now when the message carries no timestamp", () => {
    const record = buildSubagentMessageRecord(
      "p",
      "c",
      "e1",
      {},
      subUsage,
      1234,
    );
    expect(record.ts).toBe(1234);
  });

  it("leaves provider/model null rather than inventing one", () => {
    const record = buildSubagentMessageRecord(
      "p",
      "c",
      "e1",
      { timestamp: 1 },
      subUsage,
      0,
    );
    expect(record.provider).toBeNull();
    expect(record.model).toBeNull();
  });
});
