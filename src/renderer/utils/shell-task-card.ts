// 后台终端卡的纯函数（无 React、无 store），便于单测。
import type { ShellTask } from "../../shared/shell-task";

export type ShellTaskCardState =
  | "front"
  | "detached"
  | "completed"
  | "failed"
  | "timeout"
  | "killed";

export function shellTaskCardState(args: {
  task?: ShellTask;
  hasResult: boolean;
}): ShellTaskCardState {
  if (!args.task) return args.hasResult ? "completed" : "front";
  return args.task.status;
}

export function splitShellTaskRows(tasks: Record<string, ShellTask>): {
  detached: ShellTask[];
  finished: ShellTask[];
} {
  const detached: ShellTask[] = [];
  const finished: ShellTask[] = [];
  for (const task of Object.values(tasks)) {
    if (task.status === "detached") detached.push(task);
    else finished.push(task);
  }
  return { detached, finished };
}
