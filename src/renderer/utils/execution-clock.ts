/**
 * @module renderer/utils/execution-clock
 *
 * 回合计时的共用零件。「5s 收尾窗口」在这里只定义一次：
 * 渲染层用它决定「本轮耗时」停留多久，store 用它决定一段新的 running
 * 是上一轮的续跑还是新任务。两边共用一个判定函数，就不存在
 * 一个用 `<`、一个用 `<=` 的偏差。
 */
import type { SessionExecutionClock } from "../store";

/** 收尾窗口时长（毫秒）。 */
export const TURN_CLOCK_LINGER_MS = 5_000;

/** `endAt` 距今是否仍在收尾窗口内（4.999s 内算同一任务，恰好 5.000s 不算）。 */
export function isLingering(
  clock: SessionExecutionClock,
  now: number,
): boolean {
  return clock.endAt !== null && now - clock.endAt < TURN_CLOCK_LINGER_MS;
}

/**
 * 紧凑耗时 token：`12s` / `1m23s` / `1h05m`。
 *
 * 分钟位与秒位补零是为了宽度稳定——状态栏每秒重渲染，`1m5s` → `1m10s`
 * 会把右侧内容推来推去。单位刻意不做 i18n，与仓库既有的
 * `SubagentSteps.tsx` 的 `durationText`、`AgentRunContainer` 的 `{durationSec}s`
 * 保持一致；句子外壳走 i18n。
 */
export function formatDurationShort(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600)
    return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(s / 3600);
  return `${h}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}
