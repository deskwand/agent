export const DEFAULT_SESSION_TITLE = "New Session";
export const MAX_SESSION_TITLE_LENGTH = 50;

export type RenameSessionResult =
  | { success: true; title: string; updatedAt: number }
  | { success: false; error: "SESSION_NOT_FOUND" | "INVALID_TITLE" };

export function truncateSessionTitle(value: string): string {
  return value.length > MAX_SESSION_TITLE_LENGTH
    ? `${value.slice(0, Math.max(1, MAX_SESSION_TITLE_LENGTH - 3))}...`
    : value;
}

export function normalizeSessionTitle(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? truncateSessionTitle(trimmed) : null;
}

export function getDefaultTitleFromPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return DEFAULT_SESSION_TITLE;
  return truncateSessionTitle(trimmed);
}

export function getInitialSessionTitle(
  prompt: string,
  firstAttachmentName?: string | null,
): string {
  const promptTitle = getDefaultTitleFromPrompt(prompt);
  if (promptTitle !== DEFAULT_SESSION_TITLE) {
    return promptTitle;
  }

  const attachmentName = firstAttachmentName?.trim();
  if (attachmentName) {
    return truncateSessionTitle(attachmentName);
  }

  return DEFAULT_SESSION_TITLE;
}
