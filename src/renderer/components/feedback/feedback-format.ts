import type { FeedbackStatus, FeedbackType } from "../../../shared/feedback";

export const TYPE_LABEL_KEYS: Record<FeedbackType, string> = {
  bug: "feedback.type.bug",
  feature: "feedback.type.feature",
  other: "feedback.type.other",
};

export const STATUS_LABEL_KEYS: Record<FeedbackStatus, string> = {
  open: "feedback.status.open",
  resolved: "feedback.status.resolved",
};

export function codePointLength(value: string): number {
  return Array.from(value).length;
}
