import { app } from "electron";
import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { splitThinkTagBlocks } from "./think-tag-parser";

// ── Locale detection ────────────────────────────────────────────────

export function getLocale(): string {
  return (app.getLocale() ?? "en");
}

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

export function toUserFacingErrorText(errorText: string, _locale?: string): string {
  const locale = _locale ?? getLocale();
  const zh = locale.startsWith("zh");
  const lower = errorText.toLowerCase();
  if (lower.includes("first_response_timeout")) {
    return zh
      ? "模型响应超时，请稍后重试或检查模型/网关负载。"
      : "Model response timed out. Please retry or check the model/gateway load.";
  }
  if (lower.includes("empty_success_result")) {
    return zh
      ? "模型返回空结果，可能是兼容性问题，请重试或切换协议。"
      : "Model returned empty result. Possible compatibility issue. Please retry or switch protocol.";
  }
  if (
    /\b400\b/.test(errorText) ||
    lower.includes("bad request") ||
    lower.includes("invalid request")
  ) {
    return zh
      ? `请求被拒绝（400），请检查模型名称、协议和 API 端点。\n原始错误: ${errorText}`
      : `Request rejected (400). Check model name, protocol and API endpoint.\nOriginal error: ${errorText}`;
  }
  if (
    /\b(401|403)\b/.test(errorText) ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  ) {
    return zh
      ? `认证失败，请检查 API Key 是否正确或已过期。\n原始错误: ${errorText}`
      : `Authentication failed. Check if your API key is correct or has expired.\nOriginal error: ${errorText}`;
  }
  if (
    /\b429\b/.test(errorText) ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  ) {
    return zh
      ? `请求被限流（429），请稍后重试。\n原始错误: ${errorText}`
      : `Rate limited (429). Please retry later.\nOriginal error: ${errorText}`;
  }
  if (
    /\b(5\d{2})\b/.test(errorText) ||
    lower.includes("server error") ||
    lower.includes("internal error") ||
    lower.includes("service unavailable") ||
    lower.includes("overloaded")
  ) {
    return zh
      ? `上游服务异常，正在自动重试，请稍候...\n原始错误: ${errorText}`
      : `Upstream service error. Retrying, please wait...\nOriginal error: ${errorText}`;
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
    lower.includes("retry delay")
  ) {
    return zh
      ? "网络连接中断，正在自动重试，请稍候..."
      : "Network interrupted. Retrying, please wait...";
  }
  return errorText;
}

/** Suffix appended after error messages in the chat area. */
export function getErrorSuffix(errorText: string, _locale?: string): string {
  const locale = _locale ?? getLocale();
  const zh = locale.startsWith("zh");
  if (/\b4\d{2}\b/.test(errorText)) {
    return zh ? "_请检查配置后重试。_" : "_Please check your configuration and retry._";
  }
  return zh ? "_Agent 正在自动重试，请稍候..._" : "_Retrying automatically, please wait..._";
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
