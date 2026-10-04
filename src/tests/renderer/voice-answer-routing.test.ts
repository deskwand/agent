// @vitest-environment jsdom
//
// 回答归属：只能读**这一轮**的文字。原来取 partial 里最长的一条，一旦有新问题
// 排队就分不清新旧 —— 旧回答还在生成时，它的 partial 比新轮长，于是播放的是旧话。
import { describe, expect, it } from "vitest";
import { readVoiceAnswer } from "../../renderer/hooks/useVoiceMode";
import type { Message } from "../../renderer/types";

type AssistantLike = Pick<Message, "role" | "turnId" | "content">;

function assistant(turnId: string, text: string): AssistantLike {
  return { role: "assistant", turnId, content: [{ type: "text", text }] };
}

describe("readVoiceAnswer", () => {
  it("只读取指定轮次", () => {
    const partials = {
      old: { message: "很长的旧回答，仍在生成。", thinking: "" },
      next: { message: "新回答。", thinking: "" },
    };
    expect(readVoiceAnswer([], partials, "next")).toBe("新回答。");
    expect(readVoiceAnswer([], partials, "missing")).toBe("");
    expect(readVoiceAnswer([], partials, null)).toBe("");
  });

  it("已落库的消息与正在生成的 partial 拼起来读", () => {
    const messages = [
      assistant("old", "旧回答。"),
      assistant("next", "先检查。"),
    ];

    expect(
      readVoiceAnswer(
        messages,
        { next: { message: "检查完成。", thinking: "" } },
        "next",
      ),
    ).toBe("先检查。\n检查完成。");
  });

  it("消息落库、partial 被清掉之后，全文保持不变", () => {
    const saved = [
      assistant("next", "先检查。"),
      assistant("next", "检查完成。"),
    ];
    expect(readVoiceAnswer(saved, {}, "next")).toBe("先检查。\n检查完成。");
  });

  it("跳过非助手消息、工具块和合成文本", () => {
    const messages: AssistantLike[] = [
      {
        role: "user",
        turnId: "next",
        content: [{ type: "text", text: "用户的话" }],
      },
      {
        role: "assistant",
        turnId: "next",
        content: [
          { type: "thinking", thinking: "想一下" },
          { type: "text", text: "正文。" },
          { type: "text", text: "合成块", synthetic: true },
        ],
      },
    ];
    expect(readVoiceAnswer(messages, {}, "next")).toBe("正文。");
  });

  it("相同文字的两条消息都保留，不按内容去重", () => {
    const messages = [assistant("next", "好的。"), assistant("next", "好的。")];
    expect(readVoiceAnswer(messages, {}, "next")).toBe("好的。\n好的。");
  });
});
