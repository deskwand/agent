// 恢复历史用户消息里被注入的提示词装饰。
//
// 背景：pi 落盘的用户消息是「注入装饰后的提示词」，不是用户原话 ——
//   * `/skill:x <剩余>` 被展开成 `<skill name="x" location="…">…</skill>`；
//   * 附件在正文尾部追加 `[Attached files - use Read tool to access them]:` 清单，
//     而结构化的 file_attachment 块 pi 根本不落盘。
// 重启后渲染这条文本，技能引用就变成整篇 SKILL.md，附件就变成一段元数据文本、
// 且其中的文件名会被 file-link 误识别成不存在的路径。
//
// 本模块只做显示层还原：不碰 JSONL，也不碰喂给模型的 entries-to-messages 路径。
import type { ContentBlock, FileAttachmentContent, Message } from "../types";

/** pi 把 `/skill:x <剩余>` 展开成 `<skill name="x" location="…">…</skill>\n\n<剩余>`。
 *  不吃前导换行：技能块不在行首时（同时被注入 `<conversation_history>` 等）
 *  保留原文换行，避免把块前文字与 `/skill:x` 粘成一行。 */
const SKILL_BLOCK =
  /<skill name="([^"]+)" location="[^"]*">[\s\S]*?<\/skill>\s*/g;

/** `enhancedPrompt` 尾部的附件清单（session-manager 的 `[Attached files …]` 分支）。
 *  带 `g`：同一段文本里出现第二个清单时也要剥（真实数据只有一处，属强健性）。 */
const ATTACHED_FILES_BLOCK =
  /(\n*)\[Attached files - use Read tool to access them\]:\n((?:- [^\n]*\n?)+)/g;

/** 单行形态：`- 1.jpeg (263.6 KB) at path: .tmp/1-558dd2ae.jpeg` */
const ATTACHMENT_LINE =
  /^-\s+(.+?)\s+\((\d+(?:\.\d+)?) KB\)\s+at path:\s+(.+?)\s*$/;

/**
 * 只还原 role === "user" 的历史消息；无装饰时原样返回同一引用。
 *
 * 展示层唯一入口：解析细节（正则、附件行）都是本模块私有实现。
 */
export function restoreUserMessage(message: Message): Message {
  if (message.role !== "user" || !Array.isArray(message.content)) {
    return message;
  }

  const blocks = message.content;
  const firstTextIndex = blocks.findIndex((block) => block.type === "text");
  if (firstTextIndex === -1) return message;

  const attachments: FileAttachmentContent[] = [];
  const restored: ContentBlock[] = [];

  for (const block of blocks) {
    if (block.type !== "text") {
      restored.push(block);
      continue;
    }
    const parsed = restoreText(block.text);
    attachments.push(...parsed.attachments);
    // 装饰被剥空时不再保留空 text 块（发送时纯附件消息本来就没有 text 块）。
    if (!parsed.text && block.text) continue;
    if (parsed.text === block.text) {
      restored.push(block);
    } else {
      const cleanedTextBlock: ContentBlock = {
        type: "text",
        text: parsed.text,
      };
      restored.push(cleanedTextBlock);
    }
  }

  const changed =
    restored.length !== blocks.length ||
    restored.some((block, index) => block !== blocks[index]);
  if (!changed) return message;
  if (attachments.length === 0) return { ...message, content: restored };

  // 重建的附件块统一插到第一个 text 块的位置（真实落盘只有单个 text 块；
  // 多 text 块时附件会被提前到第一个块之前）。
  const insertAt = Math.min(firstTextIndex, restored.length);
  return {
    ...message,
    content: [
      ...restored.slice(0, insertAt),
      ...attachments,
      ...restored.slice(insertAt),
    ],
  };
}

/**
 * 剥掉单段文本里的装饰，并把附件行重建为 `file_attachment` 块。
 * 附件块头存在但没有一行能解析出附件时，整块原样保留（防误伤用户手写的相似文本）。
 */
function restoreText(raw: string): {
  text: string;
  attachments: FileAttachmentContent[];
} {
  const attachments: FileAttachmentContent[] = [];

  let text = raw.replace(
    SKILL_BLOCK,
    (_match: string, name: string) => `/skill:${name} `,
  );

  text = text.replace(
    ATTACHED_FILES_BLOCK,
    (match: string, lead: string, body: string) => {
      const parsed = parseAttachmentLines(body);
      if (parsed.attachments.length === 0) return match;
      attachments.push(...parsed.attachments);
      // 解析不出的行是用户自己的内容，留在原处 —— 只删真正认出来的附件行。
      return parsed.unparsed.length === 0
        ? ""
        : `${lead}${parsed.unparsed.join("\n")}`;
    },
  );

  return { text, attachments };
}

function parseAttachmentLines(body: string): {
  attachments: FileAttachmentContent[];
  unparsed: string[];
} {
  const attachments: FileAttachmentContent[] = [];
  const unparsed: string[] = [];
  for (const line of body.split("\n")) {
    if (line === "") continue;
    const match = ATTACHMENT_LINE.exec(line);
    if (!match) {
      unparsed.push(line);
      continue;
    }
    attachments.push({
      type: "file_attachment",
      filename: match[1],
      relativePath: match[3],
      size: Math.round(Number(match[2]) * 1024),
    });
  }
  return { attachments, unparsed };
}
