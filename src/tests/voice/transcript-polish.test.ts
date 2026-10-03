import { describe, expect, it } from "vitest";
import {
  POLISH_SYSTEM_PROMPT,
  isLengthSuspicious,
  normalizePolishedText,
} from "../../main/voice/transcript-polish";

describe("POLISH_SYSTEM_PROMPT", () => {
  it("forbids answering the user's words — the top failure mode", () => {
    // 用户说「帮我查一下明天天气」，如果模型以为自己是助手，它会真写一段天气预报
    expect(POLISH_SYSTEM_PROMPT).toMatch(/不要回应|不是助手|不做回答/);
  });

  it("forbids adding or removing information", () => {
    expect(POLISH_SYSTEM_PROMPT).toMatch(/不增加|不删除/);
  });
});

describe("normalizePolishedText", () => {
  it("strips code fences", () => {
    expect(normalizePolishedText("```\n今天天气不错。\n```")).toBe(
      "今天天气不错。",
    );
  });

  it("strips a leading label", () => {
    expect(normalizePolishedText("整理后：今天天气不错。")).toBe(
      "今天天气不错。",
    );
    expect(normalizePolishedText("整理结果:\n今天天气不错。")).toBe(
      "今天天气不错。",
    );
  });

  it("strips wrapping quotes", () => {
    expect(normalizePolishedText("“今天天气不错。”")).toBe("今天天气不错。");
    expect(normalizePolishedText('"今天天气不错。"')).toBe("今天天气不错。");
  });

  it("leaves clean text untouched", () => {
    expect(normalizePolishedText("今天天气不错。")).toBe("今天天气不错。");
  });
});

describe("isLengthSuspicious", () => {
  it("flags a result that is far too short", () => {
    expect(isLengthSuspicious("一二三四五六七八九十", "一二")).toBe(true);
  });

  it("flags a result that is far too long", () => {
    expect(
      isLengthSuspicious("今天天气不错", "今天天气不错" + "啊".repeat(30)),
    ).toBe(true);
  });

  it("accepts a modest rewrite", () => {
    expect(isLengthSuspicious("嗯那个今天天气不错", "今天天气不错。")).toBe(
      false,
    );
  });
});
