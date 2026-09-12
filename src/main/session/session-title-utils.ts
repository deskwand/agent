export {
  DEFAULT_SESSION_TITLE,
  getDefaultTitleFromPrompt,
} from "../../shared/session-title";
import {
  DEFAULT_SESSION_TITLE,
  getInitialSessionTitle,
} from "../../shared/session-title";

export type TitleDecisionInput = {
  userMessageCount: number;
  currentTitle: string;
  prompt: string;
  firstAttachmentName?: string | null;
  hasAttempted: boolean;
};

export function shouldGenerateTitle(input: TitleDecisionInput): boolean {
  if (input.hasAttempted) return false;
  if (input.userMessageCount !== 1) return false;
  const initialTitle = getInitialSessionTitle(
    input.prompt,
    input.firstAttachmentName,
  );
  return (
    input.currentTitle === initialTitle ||
    input.currentTitle === DEFAULT_SESSION_TITLE
  );
}

export function normalizeGeneratedTitle(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  const normalized = firstLine.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!normalized) return null;
  if (
    normalized.toLowerCase() === "(no content)" ||
    normalized.toLowerCase() === "(empty content)"
  ) {
    return null;
  }
  return normalized.slice(0, 120);
}

export function buildTitlePrompt(prompt: string): string {
  return [
    "Generate a short title for the following user request. Rules:",
    "- Max 15 characters (Chinese) or 6 words (English)",
    "- Reply in the same language as the user request",
    "- No quotes, numbering, or punctuation at the end",
    "",
    "请根据用户请求生成一个简短的对话标题：",
    "- 不超过15个字",
    "- 同语言输出",
    "- 不要加引号或编号",
    "",
    `User request / 用户请求：${prompt.trim()}`,
  ].join("\n");
}

/**
 * 标题生成的输入文本：
 * - 有文字 → 用文字
 * - 无文字但有附件名 → 用附件名
 * - 都没有（纯粘贴图片等）→ null，调用方据此短路，不发请求
 */
export function buildTitleInput(
  prompt: string,
  firstAttachmentName?: string | null,
): string | null {
  const text = prompt.trim();
  if (text) return text;
  return firstAttachmentName?.trim() || null;
}
