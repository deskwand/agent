import { AlarmClock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/utils/cn";
import { useSessionWakeupStore } from "../store/session-wakeups";
import { Button } from "./app-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** 最后一分钟才逐秒跳，之前每 5 秒对一次，界面安静一些。 */
const FAR_TICK_MS = 5_000;
const NEAR_TICK_MS = 1_000;
/** 剩余这么少就不报秒数了，避免读一个停住的数字。 */
const IMMINENT_MS = 10_000;
/** 主进程可能还没建好 manager（启动早期的竞态）；失败后重试一次。 */
const RETRY_MS = 500;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function startOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatClock(ts: number): string {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** tooltip 里的绝对时间：唤醒最远 7 天，所以要带日期，不能只有 HH:MM。 */
export function absoluteLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  at: number,
  now: number,
): string {
  const time = formatClock(at);
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
  if (days <= 0) return t("sessionWakeup.chipToday", { time });
  if (days === 1) return t("sessionWakeup.chipTomorrow", { time });
  const date = new Date(at);
  return t("sessionWakeup.chipOther", {
    date: `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time,
  });
}

/**
 * 主行只报倒计时：分级文案，长时间不给秒。
 *
 * 统一上取整到「最小的上报单位」再进位，否则会印出「1 小时 60 分」和「60 秒」：
 * 小单位用 ceil、大单位用 floor 又没有 carry 时，跨单位的那一刻就会溢出。
 */
export function countdownLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  remaining: number,
): string {
  if (remaining <= IMMINENT_MS) return t("sessionWakeup.imminent");
  const totalSeconds = Math.ceil(remaining / 1000);
  if (totalSeconds < 60) {
    return t("sessionWakeup.countdownSeconds", { seconds: totalSeconds });
  }
  const totalMinutes = Math.ceil(remaining / MINUTE_MS);
  if (totalMinutes < 60) {
    return t("sessionWakeup.countdownMinutes", { minutes: totalMinutes });
  }
  const totalHours = Math.ceil(remaining / HOUR_MS);
  if (totalHours < 24) {
    return t("sessionWakeup.countdownHours", {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
    });
  }
  return t("sessionWakeup.countdownDays", {
    days: Math.floor(totalHours / 24),
    hours: totalHours % 24,
  });
}

/**
 * 输入框上方的一行：下一次自动唤醒的倒计时 + 取消。
 *
 * 排版与 `ChatInputStatusBar` 同列（`min-h-5 px-1 pb-1`），没有预约时整块不渲染 ——
 * `className` 由调用方传入（与 `GuardApprovalCards` 同 idiom），空状态才不留空隙。
 *
 * 计时：单个自我重挂的 `setTimeout`，每次都重新读 `Date.now()`。不用 `setInterval`
 * 是为了让睡眠 / 系统时钟跳变自愈；换算只用「当前墙钟 - 到期时刻」，不累积误差。
 */
export function SessionWakeupChip({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const next = useSessionWakeupStore((state) => state.next[sessionId]);
  const upsert = useSessionWakeupStore((state) => state.upsert);
  const [now, setNow] = useState(() => Date.now());

  // 新预约出现的第一次渲染必须用当前时间：`now` 可能停在挂载那一刻（甚至一天前），
  // 否则首次显示会按旧时间算，最多错到 FAR_TICK_MS 之后才自己纠正。
  useEffect(() => {
    setNow(Date.now());
  }, [next?.id]);

  useEffect(() => {
    let stale = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = (attemptsLeft: number) => {
      const revision = useSessionWakeupStore.getState().revision;
      void window.electronAPI.sessionWakeup
        .next(sessionId)
        .then((view) => {
          if (stale) return;
          // 拉取期间主进程推过更新：推送比这次快照新，别把新值覆盖回去
          if (useSessionWakeupStore.getState().revision !== revision) return;
          upsert(sessionId, view);
        })
        .catch(() => {
          if (stale || attemptsLeft <= 0) return;
          retry = setTimeout(() => load(attemptsLeft - 1), RETRY_MS);
        });
    };
    load(1);
    return () => {
      stale = true;
      if (retry) clearTimeout(retry);
    };
  }, [sessionId, upsert]);

  useEffect(() => {
    if (!next) return;
    const delay = next.at - now > MINUTE_MS ? FAR_TICK_MS : NEAR_TICK_MS;
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [next, now]);

  if (!next) return null;

  const remaining = next.at - now;
  const cancelTitle = t("sessionWakeup.cancelTitle");

  return (
    <div className={cn("min-h-5 px-1 pb-1", className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlarmClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="min-w-0 cursor-default truncate">
              {countdownLabel(t, remaining)}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-normal leading-relaxed">
            {absoluteLabel(t, next.at, now)}
            {" · "}
            {next.reason}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              type="button"
              aria-label={cancelTitle}
              className="h-auto shrink-0 px-1 py-0 text-xs text-muted-foreground [&_svg]:size-3"
              onClick={() => {
                void window.electronAPI.sessionWakeup
                  .cancel(sessionId, next.id)
                  .then((removed) => {
                    // 主进程也会推 session-wakeup.update；这里先乐观清掉
                    if (removed) upsert(sessionId, null);
                  })
                  .catch(() => undefined);
              }}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{cancelTitle}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
