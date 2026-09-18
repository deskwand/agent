export type QuotaWindowKind = "session" | "weekly";

export interface QuotaWindow {
  kind: QuotaWindowKind;
  /** 已用百分比，0-100 */
  usedPercent: number;
  /** 重置时间（epoch ms）；拿不到则不设，该副行不渲染 */
  resetsAt?: number;
}

export interface QuotaSnapshot {
  /** OAuth provider id，如 "openai-codex" */
  providerId: string;
  /** 展示名，如 "OpenAI Codex"。产品名，不走 i18n（设计文档 §5.3） */
  providerName: string;
  /** 计划名，如 "team"；拿不到则不渲染标签行的这一段 */
  planName?: string;
  /** 数组顺序即渲染顺序；缺失的窗口直接不出现在数组里 */
  windows: QuotaWindow[];
}
