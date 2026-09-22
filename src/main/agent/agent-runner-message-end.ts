import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { splitThinkTagBlocks } from "./think-tag-parser";
import { t } from "../i18n";

type MessageEndContentBlock = TextContent | ThinkingContent | ToolCall;

type MessageEndMessage = Pick<
  AssistantMessage,
  "role" | "content" | "stopReason" | "errorMessage"
>;

interface ResolveMessageEndPayloadOptions {
  message?: MessageEndMessage;
  streamedText: string;
}

interface ResolvedMessageEndPayload {
  effectiveContent: MessageEndContentBlock[];
  errorText?: string;
  nextStreamedText: string;
  shouldEmitMessage: boolean;
}

export function toUserFacingErrorText(errorText: string): string {
  const lower = errorText.toLowerCase();
  if (lower.includes("first_response_timeout")) {
    return t("errors.modelTimeout");
  }
  if (lower.includes("empty_success_result")) {
    return t("errors.emptyResult");
  }
  if (
    /\b400\b/.test(errorText) ||
    lower.includes("bad request") ||
    lower.includes("invalid request")
  ) {
    return t("errors.badRequest", { error: errorText });
  }
  if (
    /\b(401|403)\b/.test(errorText) ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  ) {
    return t("errors.authFailed", { error: errorText });
  }
  if (
    /\b429\b/.test(errorText) ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  ) {
    return t("errors.rateLimited", { error: errorText });
  }
  if (
    /\b(5\d{2})\b/.test(errorText) ||
    lower.includes("server error") ||
    lower.includes("internal error") ||
    lower.includes("service unavailable") ||
    lower.includes("overloaded")
  ) {
    return t("errors.upstreamError", { error: errorText });
  }
  if (
    lower.includes("terminated") ||
    lower.includes("connection reset") ||
    lower.includes("connection closed") ||
    lower.includes("connection refused") ||
    lower.includes("connection error") ||
    lower.includes("fetch failed") ||
    lower.includes("other side closed") ||
    lower.includes("reset before headers") ||
    lower.includes("upstream connect") ||
    lower.includes("retry delay") ||
    lower.includes("timeout") ||
    lower.includes("timed out")
  ) {
    return t("errors.networkInterrupted");
  }
  return errorText;
}

/** Suffix appended after error messages in the chat area. */
export function getErrorSuffix(errorText: string): string {
  if (/\b4\d{2}\b/.test(errorText)) {
    return t("errors.checkConfig");
  }
  // 非 4xx 的错误要么已经由重试行表达"正在重试"，要么就是终局失败。
  // 这里再说一次"正在自动重试"会与重试行同屏矛盾。
  return "";
}

export function resolveMessageEndPayload(
  options: ResolveMessageEndPayloadOptions,
): ResolvedMessageEndPayload {
  const { message, streamedText } = options;
  const nextStreamedText = "";

  if (message?.stopReason === "error" && message.errorMessage) {
    return {
      effectiveContent: [],
      errorText: toUserFacingErrorText(message.errorMessage),
      nextStreamedText,
      shouldEmitMessage: false,
    };
  }

  const rawContent =
    Array.isArray(message?.content) && message.content.length > 0
      ? message.content
      : streamedText
        ? [{ type: "text" as const, text: streamedText }]
        : [];

  if (rawContent.length === 0) {
    return {
      effectiveContent: [],
      errorText: toUserFacingErrorText("empty_success_result"),
      nextStreamedText,
      shouldEmitMessage: false,
    };
  }

  // Post-process: split any <think>...</think> tags in text blocks into
  // separate thinking + text content blocks for proper UI rendering.
  const effectiveContent: MessageEndContentBlock[] = [];
  for (const block of rawContent) {
    if (block.type === "text") {
      const splitBlocks = splitThinkTagBlocks(block.text);
      for (const splitBlock of splitBlocks) {
        if (splitBlock.type === "thinking") {
          effectiveContent.push({
            type: "thinking",
            thinking: splitBlock.thinking,
          } as ThinkingContent);
        } else {
          effectiveContent.push({
            type: "text",
            text: splitBlock.text,
          } as TextContent);
        }
      }
    } else {
      effectiveContent.push(block);
    }
  }

  return {
    effectiveContent,
    nextStreamedText,
    shouldEmitMessage:
      effectiveContent.length > 0 &&
      (message?.role === "assistant" || !message),
  };
}
