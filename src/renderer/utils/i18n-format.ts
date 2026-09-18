import i18n from "../i18n/config";

function getAppLocale(
  language = i18n.resolvedLanguage || i18n.language,
): string {
  if (language.startsWith("zh")) {
    return "zh-CN";
  }
  return "en-US";
}

export function formatAppDateTime(value: number | string | Date): string {
  return new Intl.DateTimeFormat(getAppLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatAppDate(
  value: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(
    getAppLocale(),
    options || {
      month: "short",
      day: "numeric",
    },
  ).format(new Date(value));
}

export function joinAppList(values: string[]): string {
  return values.join(getAppLocale().startsWith("zh") ? "、" : ", ");
}

/**
 * 重置时间：同一天只显示时分（"03:19"），跨天显示完整日期时间（"2026年9月20日 19:19"）。
 *
 * 不新增复合时长格式器（"1 天 21 小时后"）：参照的 Codex Status 面板用的就是绝对时间，
 * 而相对时间要另建一个格式器 + 一组 i18n key。now 可注入，便于测试。
 */
export function formatResetTime(
  resetsAt: number,
  now: number = Date.now(),
): string {
  const target = new Date(resetsAt);
  const current = new Date(now);
  const sameDay =
    target.getFullYear() === current.getFullYear() &&
    target.getMonth() === current.getMonth() &&
    target.getDate() === current.getDate();
  return sameDay
    ? formatAppDate(resetsAt, { timeStyle: "short" })
    : formatAppDateTime(resetsAt);
}
