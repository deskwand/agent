/**
 * 后台终端任务的类型 —— main / preload / renderer 共用。
 * 只放类型，不放逻辑：渲染进程不能 import main。
 */

export type ShellTaskStatus =
  | "detached"
  | "completed"
  | "failed"
  | "timeout"
  | "killed";

export type ShellToolName = "bash" | "powershell";

export interface ShellTask {
  /** 会话内递增，展示为 #1 / #2。 */
  id: string;
  sessionId: string;
  /** 触发它的工具调用 id —— 卡片按这个 key 找自己的任务。 */
  toolCallId: string;
  toolName: ShellToolName;
  command: string;
  cwd: string;
  /** 命令真正开始执行的时间（包装层给），durationMs 从它算。 */
  startedAt: number;
  detachedAt?: number;
  settledAt?: number;
  status: ShellTaskStatus;
  /** 最近约 8KB 输出，供界面实时尾巴。 */
  tail: string;
  /** 输出快照长度（字节量级），供界面显示大小。 */
  bytesOut: number;
  exitCode?: number;
  durationMs?: number;
  /** pi 在输出被截断时落盘的完整输出路径（details.full_output_path）。 */
  outputPath?: string;
}
