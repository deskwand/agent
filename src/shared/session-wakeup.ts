/**
 * 普通会话自我唤醒的共享类型与常量（主进程 / preload / 渲染层共用）。
 */

export interface SessionWakeup {
  id: string;
  sessionId: string;
  runAt: number;
  reason: string;
  createdAt: number;
}

/** 渲染层 chip 展示的下一次唤醒。`id` 供取消用。 */
export interface SessionWakeupView {
  id: string;
  at: number;
  reason: string;
}

/** 与常驻智能体一致：至少 1 分钟后才允许唤醒。 */
export const MIN_SESSION_WAKEUP_DELAY_MS = 60_000;
/** 每个会话最多同时挂着几个待执行预约。 */
export const MAX_PENDING_SESSION_WAKEUPS = 3;
/** 最远只能排到 7 天后。 */
export const MAX_SESSION_WAKEUP_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
/** 连续自我唤醒链上限：中间没有用户消息时最多醒这么多次。 */
export const MAX_SELF_WAKE_CHAIN = 6;
