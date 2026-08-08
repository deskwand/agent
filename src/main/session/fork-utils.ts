import type {
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import type { ContentBlock, ImageContent, Message } from "../../renderer/types";

type PiBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  data?: string;
  mimeType?: string;
  source?: { type?: string; media_type?: string; data?: string };
};

// SessionMessageEntry.message 是 pi-ai 的联合类型（User/Assistant/ToolResult），
// 各角色的 content 类型不同，这里用宽松形状按需读取字段（与 agent-runner 宽容解析风格一致）。
type LooseAgentMessage = {
  role: string;
  content: unknown;
  toolCallId?: string;
};

/**
 * deskwand 把每次工具结果落库为独立行：role="assistant" + 单个 tool_result 块
 * （agent-runner 的 sendMessage 流程）。这类行在 JSONL 中对应 role="toolResult" 的
 * entry，不能作为分叉点，也不参与 assistant 序号对齐。
 */
export function isToolResultMessage(message: Message): boolean {
  return (
    message.content.length === 1 && message.content[0].type === "tool_result"
  );
}

/** 提取 message content 中 text 块的拼接文本（用于分叉点文本校验）。 */
export function extractEntryText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is PiBlock & { type: "text" } =>
        typeof b === "object" && b !== null && (b as PiBlock).type === "text",
    )
    .map((b) => b.text ?? "")
    .join("\n");
}

/** 图片块归一化：pi-ai 扁平式 {data,mimeType} 与 Anthropic source 式都转成 deskwand ImageContent。 */
function normalizeImageBlock(block: PiBlock): ImageContent {
  if (block.source && typeof block.source === "object") {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: (block.source.media_type as "image/png") ?? "image/png",
        data: block.source.data ?? "",
      },
    };
  }
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: (block.mimeType as "image/png") ?? "image/png",
      data: block.data ?? "",
    },
  };
}

/**
 * 顺序对齐：跳过非 message / 非 assistant entry，取第 assistantIndex 条 assistant entry，
 * 并校验其文本与目标一致（防 DB/JSONL 错位；重复文本场景下序号对齐不会错配）。
 * @throws 文本不符或越界时抛 Error
 */
export function findAssistantEntryAt(
  branch: SessionEntry[],
  assistantIndex: number,
  targetText: string,
): SessionMessageEntry {
  let seen = -1;
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const e = entry as SessionMessageEntry;
    if (e.message.role !== "assistant") continue;
    seen++;
    if (seen === assistantIndex) {
      if (extractEntryText(e.message.content) !== targetText) {
        throw new Error("无法在会话文件中定位分叉点，请重试");
      }
      return e;
    }
  }
  throw new Error("无法在会话文件中定位分叉点，请重试");
}

/** 把分叉文件的 message entry 转成 deskwand Message（全保真，保留 timestamp/turnId）。 */
export function piEntryToMessage(
  entry: SessionEntry,
  sessionId: string,
  seq: number,
): Message {
  const e = entry as SessionMessageEntry;
  const m = e.message as unknown as LooseAgentMessage;
  const timestamp = Date.parse(e.timestamp) || Date.now();
  const id = `fork-${sessionId}-${seq}`;

  if (m.role === "toolResult") {
    const blocks = Array.isArray(m.content) ? m.content : [];
    const text = extractEntryText(blocks);
    // ToolResultContent.images 是 {data, mimeType} 扁平形状（见 renderer/types ToolResultContent）
    const images = blocks
      .filter(
        (b): b is PiBlock =>
          typeof b === "object" && b !== null && b.type === "image",
      )
      .map((b) => ({
        data: b.data ?? b.source?.data ?? "",
        mimeType: b.mimeType ?? b.source?.media_type ?? "image/png",
      }));
    return {
      id,
      sessionId,
      role: "assistant",
      timestamp,
      turnId: e.id,
      content: [
        {
          type: "tool_result",
          toolUseId: m.toolCallId ?? "",
          content: text,
          ...(images.length > 0 ? { images } : {}),
        },
      ],
    };
  }

  const blocks = Array.isArray(m.content) ? m.content : [];
  const content: ContentBlock[] = blocks.map((b) => {
    if (typeof b !== "object" || b === null) {
      return { type: "text", text: JSON.stringify(b) };
    }
    const block = b as PiBlock;
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text ?? "" };
      case "thinking":
        return { type: "thinking", thinking: block.thinking ?? "" };
      case "toolCall":
        return {
          type: "tool_use",
          id: block.id ?? "",
          name: block.name ?? "",
          input: block.arguments ?? {},
        };
      case "image":
        return normalizeImageBlock(block);
      default:
        return { type: "text", text: block.text ?? JSON.stringify(block) };
    }
  });

  // 注：tool_result 的 isError/diff/errorCode 仅存在于 deskwand DB（pi JSONL 不含），
  // 物化无法还原，v1 接受丢失。

  return {
    id,
    sessionId,
    role: m.role === "user" ? "user" : "assistant",
    content,
    timestamp,
    turnId: e.id,
  };
}
