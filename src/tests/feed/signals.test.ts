import { describe, expect, it } from "vitest";
import {
  SIGNAL_MAX_QUESTIONS,
  SIGNAL_MAX_SESSIONS,
  SIGNAL_QUESTION_MAX_CHARS,
  collectSignals,
  type FeedSignalSources,
} from "../../main/feed/feed-signals";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function sources(
  overrides: Partial<FeedSignalSources> = {},
): FeedSignalSources {
  return {
    readCoreMemory: () => ({
      "interests:Rust": "Rust 异步运行时",
      "preferences:语言": "回答用中文",
      "skills:SQL": "SQLite",
    }),
    listRecentSessions: () => [
      { id: "s1", title: "调 tokio", updatedAt: NOW - DAY },
    ],
    readUserMessages: () => [
      { role: "user", text: "tokio 的 blocking pool 怎么调" },
      { role: "assistant", text: "你应该看……" },
    ],
    ...overrides,
  };
}

describe("collectSignals", () => {
  it("只取 interests 与 preferences，不取 skills", () => {
    const signals = collectSignals({
      sources: sources(),
      blockedTopics: [],
      now: NOW,
    });
    expect(signals.interests).toEqual(["Rust 异步运行时"]);
    expect(signals.preferences).toEqual(["回答用中文"]);
  });

  it("只取用户说的话，不取助手回复", () => {
    const signals = collectSignals({
      sources: sources(),
      blockedTopics: [],
      now: NOW,
    });
    expect(signals.recentQuestions).toEqual([
      { sessionTitle: "调 tokio", text: "tokio 的 blocking pool 怎么调" },
    ]);
  });

  it("超过窗口的会话不要", () => {
    const stale = sources({
      listRecentSessions: () => [
        { id: "old", title: "旧", updatedAt: NOW - 30 * DAY },
      ],
    });
    expect(
      collectSignals({ sources: stale, blockedTopics: [], now: NOW })
        .recentQuestions,
    ).toEqual([]);
  });

  it("会话最多 10 个", () => {
    const many = sources({
      listRecentSessions: () =>
        Array.from({ length: 25 }, (_, i) => ({
          id: `s${i}`,
          title: `t${i}`,
          updatedAt: NOW - i,
        })),
      readUserMessages: () => [{ role: "user", text: "x" }],
    });
    const signals = collectSignals({
      sources: many,
      blockedTopics: [],
      now: NOW,
    });
    expect(signals.recentQuestions).toHaveLength(SIGNAL_MAX_SESSIONS);
  });

  it("提问最多 60 条，每条截到 200 字", () => {
    const long = "字".repeat(500);
    const many = sources({
      listRecentSessions: () => [{ id: "s1", title: "t", updatedAt: NOW }],
      readUserMessages: () =>
        Array.from({ length: 90 }, () => ({ role: "user", text: long })),
    });
    const signals = collectSignals({
      sources: many,
      blockedTopics: [],
      now: NOW,
    });
    expect(signals.recentQuestions).toHaveLength(SIGNAL_MAX_QUESTIONS);
    expect(signals.recentQuestions[0].text).toHaveLength(
      SIGNAL_QUESTION_MAX_CHARS,
    );
  });

  it("按 blockedTopics 剔除 interests/preferences 并原样带上屏蔽列表", () => {
    const signals = collectSignals({
      sources: sources(),
      blockedTopics: ["Rust 异步运行时"],
      now: NOW,
    });
    expect(signals.interests).toEqual([]);
    expect(signals.blockedTopics).toEqual(["Rust 异步运行时"]);
  });

  it("读取源抛错时不抛，退回空信号", () => {
    const broken = sources({
      readCoreMemory: () => {
        throw new Error("boom");
      },
      listRecentSessions: () => {
        throw new Error("boom");
      },
    });
    expect(
      collectSignals({ sources: broken, blockedTopics: [], now: NOW }),
    ).toEqual({
      interests: [],
      preferences: [],
      recentQuestions: [],
      blockedTopics: [],
    });
  });

  it("单个会话读消息抛错时跳过它，其余继续", () => {
    const partial = sources({
      listRecentSessions: () => [
        { id: "bad", title: "坏", updatedAt: NOW },
        { id: "good", title: "好", updatedAt: NOW - 1 },
      ],
      readUserMessages: (sessionId) => {
        if (sessionId === "bad") throw new Error("boom");
        return [{ role: "user", text: "有效问题" }];
      },
    });
    const signals = collectSignals({
      sources: partial,
      blockedTopics: [],
      now: NOW,
    });
    expect(signals.recentQuestions).toEqual([
      { sessionTitle: "好", text: "有效问题" },
    ]);
  });
});
