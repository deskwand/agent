/**
 * @module main/agent/shell-task-prompt
 *
 * 后台终端任务结算后回填给主 Agent 的那段文本。
 * 纯函数：不读配置、不碰界面 i18n（这是给模型看的指令，跟着会话历史走）。
 */

import type { ShellTask, ShellTaskStatus } from "../../shared/shell-task";

const TAIL_LIMIT = 4_000;

export function shouldAutoContinue(status: ShellTaskStatus): boolean {
  // 人工取消不续跑：人刚说停，不该自己又爬起来
  return status !== "killed";
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "unknown";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const rest = totalSeconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`;
}

export function buildShellTaskPrompt(task: ShellTask): string {
  const tail =
    task.tail.length > TAIL_LIMIT
      ? `${task.tail.slice(-TAIL_LIMIT)}\n[tail truncated]`
      : task.tail;
  const lines = [
    `[Background task #${task.id} ${task.status}]`,
    `Command: ${task.command}`,
    `Exit code: ${task.exitCode ?? "none"} · Duration: ${formatDuration(task.durationMs)}`,
  ];
  if (task.outputPath) lines.push(`Full output: ${task.outputPath}`);
  if (tail.trim()) lines.push("Output tail:", tail.trimEnd());
  lines.push(
    "",
    "Continue the task from here. Do not re-run the command that already finished.",
  );
  return lines.join("\n");
}
