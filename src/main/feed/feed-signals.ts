/**
 * @module main/feed/feed-signals
 *
 * 动态的兴趣信号：core memory 的关注点 + 最近会话里用户自己说出口的问题。
 * 明确不读：助手回复、工具调用结果、文件内容、附件（设计 §6.1）。
 */
import { logWarn } from "../utils/logger";

export const SIGNAL_WINDOW_DAYS = 7;
export const SIGNAL_MAX_SESSIONS = 10;
export const SIGNAL_MAX_QUESTIONS = 60;
export const SIGNAL_QUESTION_MAX_CHARS = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FeedSignals {
  interests: string[];
  preferences: string[];
  recentQuestions: { sessionTitle: string; text: string }[];
  blockedTopics: string[];
}

export interface FeedSignalSources {
  /** core memory 的 "category:key" → value 映射 */
  readCoreMemory: () => Record<string, string>;
  listRecentSessions: (
    since: number,
  ) => { id: string; title: string; updatedAt: number }[];
  readUserMessages: (sessionId: string) => { role: string; text: string }[];
}

function normalizeTopic(value: string): string {
  return value.replace(/[\s\p{P}]+/gu, "").toLowerCase();
}

function isBlocked(value: string, blocked: Set<string>): boolean {
  const normalized = normalizeTopic(value);
  for (const topic of blocked) {
    if (normalized === normalizeTopic(topic)) return true;
  }
  return false;
}

/** 读出来不抛：任何一份来源坏掉，就用剩下的那一份。 */
export function collectSignals(input: {
  sources: FeedSignalSources;
  blockedTopics: string[];
  now: number;
}): FeedSignals {
  const blocked = new Set(input.blockedTopics);
  const interests: string[] = [];
  const preferences: string[] = [];

  try {
    for (const [combinedKey, value] of Object.entries(
      input.sources.readCoreMemory(),
    )) {
      const category = combinedKey.split(":")[0];
      const trimmed = value.trim();
      if (!trimmed || isBlocked(trimmed, blocked)) continue;
      if (category === "interests") interests.push(trimmed);
      else if (category === "preferences") preferences.push(trimmed);
    }
  } catch (error) {
    logWarn("[feed] readCoreMemory failed:", error);
  }

  const recentQuestions: FeedSignals["recentQuestions"] = [];
  try {
    const since = input.now - SIGNAL_WINDOW_DAYS * DAY_MS;
    const sessions = input.sources
      .listRecentSessions(since)
      .filter((session) => session.updatedAt >= since)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SIGNAL_MAX_SESSIONS);
    for (const session of sessions) {
      let messages: { role: string; text: string }[] = [];
      try {
        messages = input.sources.readUserMessages(session.id);
      } catch (error) {
        logWarn("[feed] readUserMessages failed:", session.id, error);
        continue;
      }
      for (const message of messages) {
        if (message.role !== "user") continue;
        const text = message.text.trim().slice(0, SIGNAL_QUESTION_MAX_CHARS);
        if (!text) continue;
        recentQuestions.push({ sessionTitle: session.title, text });
        if (recentQuestions.length >= SIGNAL_MAX_QUESTIONS) break;
      }
      if (recentQuestions.length >= SIGNAL_MAX_QUESTIONS) break;
    }
  } catch (error) {
    logWarn("[feed] collectSignals sessions failed:", error);
  }

  return {
    interests,
    preferences,
    recentQuestions,
    blockedTopics: input.blockedTopics,
  };
}
