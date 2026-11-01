/**
 * 常驻智能体的共享类型与常量（主进程 / preload / 渲染层共用）。
 */

export type AgentScheduleConfig =
  | { kind: "interval"; every: number; unit: "minute" | "hour" | "day" }
  | { kind: "daily"; times: string[] }
  | {
      kind: "weekly";
      weekdays: (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
      times: string[];
    };

/** 「运行中」由渲染层按会话 status 推导，主进程不算（避免状态过期）。 */
export type PersistentAgentStatus = "sleeping" | "paused" | "error";

export interface PersistentAgent {
  id: string;
  name: string;
  instructions: string;
  cwd: string;
  sessionId: string;
  /** 头像种子：新建时随机，与名字无关（改名不换脸）。 */
  avatarSeed: string;
  schedule: AgentScheduleConfig;
  enabled: boolean;
  /** 周期规则的下次时间（不含自主预约）。 */
  nextPeriodicAt: number | null;
  consecutiveFailures: number;
  lastWakeupAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PersistentAgentWakeup {
  id: string;
  agentId: string;
  runAt: number;
  reason: string;
  createdAt: number;
}

export interface PersistentAgentView extends PersistentAgent {
  status: PersistentAgentStatus;
  /** reason 为 null 表示周期唤醒。 */
  nextWakeup: { at: number; reason: string | null } | null;
  pendingWakeupCount: number;
}

export interface PersistentAgentCreateInput {
  name: string;
  instructions: string;
  cwd: string;
  schedule: AgentScheduleConfig;
  wakeImmediately: boolean;
  avatarSeed?: string;
}

/** 工作目录随会话绑定，建好后不能改（改了会话也不会跟着换目录）。 */
export type PersistentAgentUpdateInput = Partial<
  Pick<PersistentAgent, "name" | "instructions" | "schedule" | "avatarSeed">
>;

/** 会话丢失时写进 lastError 的固定值，渲染层按它显示文案。 */
export const AGENT_SESSION_LOST_ERROR = "session_lost";

export const AGENT_WAKEUP_TAG = "agent_wakeup";
export const MIN_WAKEUP_DELAY_MS = 60_000;
export const MAX_PENDING_WAKEUPS = 50;
export const MAX_CONSECUTIVE_FAILURES = 5;

const OPEN = `<${AGENT_WAKEUP_TAG}>`;
const CLOSE = `</${AGENT_WAKEUP_TAG}>`;

export function wrapAgentWakeup(body: string): string {
  return `${OPEN}\n${body}\n${CLOSE}`;
}

/** 整段（trim 后）恰好被标签包裹才算唤醒消息，返回其正文；否则 null。 */
export function parseAgentWakeup(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(OPEN) || !trimmed.endsWith(CLOSE)) return null;
  return trimmed.slice(OPEN.length, trimmed.length - CLOSE.length).trim();
}
