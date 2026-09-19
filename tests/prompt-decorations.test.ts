import { describe, it, expect } from "vitest";
import { restoreUserMessage } from "../src/renderer/utils/prompt-decorations";
import type { ContentBlock, Message } from "../src/renderer/types";

/** 真实样本（pi JSONL c5f30b16 那条），路径为中性占位。 */
const ATTACHMENT_TEXT = [
  "看看",
  "",
  "[Attached files - use Read tool to access them]:",
  "- 1.jpeg (263.6 KB) at path: .tmp/1-558dd2ae.jpeg",
].join("\n");

/** 真实样本（pi JSONL 3d5e7935 那条）的等价形态：块内含多行 Markdown + 代码块。 */
const SKILL_TEXT = [
  '<skill name="brainstorming" location="/tmp/skills/brainstorming/SKILL.md">',
  "References are relative to /tmp/skills/brainstorming.",
  "",
  "# Brainstorming Ideas Into Designs",
  "",
  "```",
  "1. [Step] → verify: [check]",
  "```",
  "</skill>",
  "",
  "消息区图片两个问题",
].join("\n");

const CARD_1_JPEG: ContentBlock = {
  type: "file_attachment",
  filename: "1.jpeg",
  relativePath: ".tmp/1-558dd2ae.jpeg",
  size: 269926,
};

function userMessage(content: ContentBlock[]): Message {
  return { id: "m1", sessionId: "s1", role: "user", content, timestamp: 1 };
}

/** 还原一条「只有一个 text 块」的用户消息，返回还原后的 content。 */
function restoredContent(raw: string): ContentBlock[] {
  return restoreUserMessage(userMessage([{ type: "text", text: raw }])).content;
}

describe("restoreUserMessage / attachment list", () => {
  it("strips the attachment list and rebuilds the file card", () => {
    expect(restoredContent(ATTACHMENT_TEXT)).toEqual([
      CARD_1_JPEG,
      { type: "text", text: "看看" },
    ]);
  });

  it("rebuilds multiple attachments including names with spaces and parens", () => {
    const raw = [
      "两个文件",
      "",
      "[Attached files - use Read tool to access them]:",
      "- image (1).png (83.0 KB) at path: .tmp/image (1).png",
      "- 简单销售报告.xlsx (12.5 KB) at path: .tmp/简单销售报告-3f2a.xlsx",
    ].join("\n");

    expect(restoredContent(raw)).toEqual([
      {
        type: "file_attachment",
        filename: "image (1).png",
        relativePath: ".tmp/image (1).png",
        size: 84992,
      },
      {
        type: "file_attachment",
        filename: "简单销售报告.xlsx",
        relativePath: ".tmp/简单销售报告-3f2a.xlsx",
        size: 12800,
      },
      { type: "text", text: "两个文件" },
    ]);
  });

  it("strips the attachment block that sits in the middle of the text", () => {
    const raw = [
      "看看",
      "",
      "[Attached files - use Read tool to access them]:",
      "- a.png (1.0 KB) at path: .tmp/a.png",
      "",
      "后面这句",
    ].join("\n");

    expect(restoredContent(raw)).toEqual([
      {
        type: "file_attachment",
        filename: "a.png",
        relativePath: ".tmp/a.png",
        size: 1024,
      },
      { type: "text", text: "看看\n后面这句" },
    ]);
  });

  it("keeps the block verbatim when no attachment line parses", () => {
    const broken = [
      "看看",
      "",
      "[Attached files - use Read tool to access them]:",
      "- 这行不是合法的附件行",
    ].join("\n");
    const message = userMessage([{ type: "text", text: broken }]);

    expect(restoreUserMessage(message)).toBe(message);
  });

  it("strips a second attachment list in the same text", () => {
    const raw = [
      "看看",
      "",
      "[Attached files - use Read tool to access them]:",
      "- a.png (1.0 KB) at path: .tmp/a.png",
      "",
      "[Attached files - use Read tool to access them]:",
      "- b.png (2.0 KB) at path: .tmp/b.png",
    ].join("\n");

    expect(restoredContent(raw)).toEqual([
      {
        type: "file_attachment",
        filename: "a.png",
        relativePath: ".tmp/a.png",
        size: 1024,
      },
      {
        type: "file_attachment",
        filename: "b.png",
        relativePath: ".tmp/b.png",
        size: 2048,
      },
      { type: "text", text: "看看" },
    ]);
  });

  it("keeps bullet lines it cannot parse instead of deleting them", () => {
    const raw = [
      "看看",
      "",
      "[Attached files - use Read tool to access them]:",
      "- a.png (1.0 KB) at path: .tmp/a.png",
      "- 用户自己写的要点",
    ].join("\n");

    expect(restoredContent(raw)).toEqual([
      {
        type: "file_attachment",
        filename: "a.png",
        relativePath: ".tmp/a.png",
        size: 1024,
      },
      { type: "text", text: "看看\n\n- 用户自己写的要点" },
    ]);
  });
});

describe("restoreUserMessage / skill block", () => {
  it("converts a skill block back into the /skill: token", () => {
    expect(restoredContent(SKILL_TEXT)).toEqual([
      { type: "text", text: "/skill:brainstorming 消息区图片两个问题" },
    ]);
  });

  it("converts consecutive skill blocks in order", () => {
    const raw = [
      '<skill name="alpha" location="/tmp/a.md">',
      "A body",
      "</skill>",
      "",
      '<skill name="beta" location="/tmp/b.md">',
      "B body",
      "</skill>",
      "",
      "评估一下",
    ].join("\n");

    expect(restoredContent(raw)).toEqual([
      { type: "text", text: "/skill:alpha /skill:beta 评估一下" },
    ]);
  });

  it("strips a skill block that is not at the head of the text", () => {
    const raw = [
      "前缀",
      "",
      '<skill name="alpha" location="/tmp/a.md">',
      "A body",
      "</skill>",
      "",
      "正文",
    ].join("\n");

    expect(restoredContent(raw)).toEqual([
      { type: "text", text: "前缀\n\n/skill:alpha 正文" },
    ]);
  });
});

describe("restoreUserMessage / block assembly", () => {
  it("keeps other blocks in order and inserts the card where the text was", () => {
    const imageBlock: ContentBlock = {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
    };

    const restored = restoreUserMessage(
      userMessage([{ type: "text", text: ATTACHMENT_TEXT }, imageBlock]),
    );

    expect(restored.content.map((block) => block.type)).toEqual([
      "file_attachment",
      "text",
      "image",
    ]);
    expect(restored.content[0]).toEqual(CARD_1_JPEG);
    expect(restored.content[2]).toBe(imageBlock);
  });

  it("drops the text block when the message only carried decorations", () => {
    const onlyDecorations = [
      "[Attached files - use Read tool to access them]:",
      "- a.png (1.0 KB) at path: .tmp/a.png",
    ].join("\n");

    expect(restoredContent(onlyDecorations).map((block) => block.type)).toEqual(
      ["file_attachment"],
    );
  });

  it("is idempotent", () => {
    const once = restoreUserMessage(
      userMessage([{ type: "text", text: ATTACHMENT_TEXT }]),
    );

    expect(restoreUserMessage(once)).toBe(once);
  });
});

describe("restoreUserMessage / guards", () => {
  it("returns the same message reference when there is no decoration", () => {
    const message = userMessage([
      {
        type: "text",
        text: "普通消息\n\n第二段 - 1.jpeg (263.6 KB) 这种不算附件行",
      },
    ]);

    expect(restoreUserMessage(message)).toBe(message);
  });

  it("does not touch an empty text block", () => {
    const message = userMessage([{ type: "text", text: "" }]);

    expect(restoreUserMessage(message)).toBe(message);
  });

  it("does not touch assistant messages", () => {
    const message: Message = {
      id: "m2",
      sessionId: "s1",
      role: "assistant",
      content: [{ type: "text", text: ATTACHMENT_TEXT }],
      timestamp: 1,
    };

    expect(restoreUserMessage(message)).toBe(message);
  });

  it("does not touch messages whose content is not an array", () => {
    const message = {
      id: "m3",
      sessionId: "s1",
      role: "user",
      content: "raw string",
      timestamp: 1,
    } as unknown as Message;

    expect(restoreUserMessage(message)).toBe(message);
  });
});
