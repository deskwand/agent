export type TitleLocale = "zh" | "en";

const SCHEDULE_TITLE_PREFIX: Record<TitleLocale, string> = {
  zh: "[定时任务]",
  en: "[Scheduled]",
};
const EMPTY_TITLE_FALLBACK: Record<TitleLocale, string> = {
  zh: "未命名任务",
  en: "Untitled task",
};
const DEFAULT_SUMMARY_MAX_LENGTH = 48;
// Must match both prefixes: when the user switches language, titles created
// under the other language still carry a prefix that has to be stripped.
const PREFIX_PATTERN = /^\s*(\[定时任务\]|\[Scheduled\])\s*/;

function normalizeTitlePart(value: string): string {
  return value
    .trim()
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ");
}

function stripSchedulePrefix(value: string): string {
  return value.replace(PREFIX_PATTERN, "").trim();
}

export function summarizeSchedulePrompt(
  prompt: string,
  locale: TitleLocale,
  maxLength: number = DEFAULT_SUMMARY_MAX_LENGTH,
): string {
  const normalizedPrompt = normalizeTitlePart(prompt);
  if (!normalizedPrompt) {
    return EMPTY_TITLE_FALLBACK[locale];
  }
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return normalizedPrompt;
  }
  if (normalizedPrompt.length <= maxLength) {
    return normalizedPrompt;
  }
  return `${normalizedPrompt.slice(0, Math.max(1, maxLength - 3))}...`;
}

export function buildScheduledTaskTitle(
  titleOrSummary: string,
  locale: TitleLocale,
): string {
  const normalized = normalizeTitlePart(stripSchedulePrefix(titleOrSummary));
  const summary = normalized || EMPTY_TITLE_FALLBACK[locale];
  return `${SCHEDULE_TITLE_PREFIX[locale]} ${summary}`;
}

export function buildScheduledTaskFallbackTitle(
  prompt: string,
  locale: TitleLocale,
): string {
  return buildScheduledTaskTitle(
    summarizeSchedulePrompt(prompt, locale),
    locale,
  );
}
