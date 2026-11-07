import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Target,
  CirclePause,
  BadgeCheck,
  Ban,
  CircleDollarSign,
  ChevronDown,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import type { BackgroundAgentRow } from "../utils/subagent-card";
import type { SessionExecutionClock } from "../store";
import { Button } from "./app-button";

export type ChatInputStatus =
  | { type: "sending" }
  | { type: "thinking" }
  | { type: "responding" }
  | { type: "compacting" }
  | { type: "compaction-success" }
  | { type: "compaction-failed" }
  | { type: "compaction-aborted" }
  | {
      type: "goal-active";
      objective: string;
      iteration: number;
      tokensUsed?: number;
      tokenBudget?: number;
      timeUsedSeconds?: number;
      timeBudgetSeconds?: number;
      activePeriodStartedAt?: number;
    }
  | {
      type: "goal-paused";
      objective: string;
      iteration?: number;
      timeUsedSeconds?: number;
    }
  | {
      type: "goal-complete";
      objective: string;
      iteration?: number;
      timeUsedSeconds?: number;
    }
  | {
      type: "goal-blocked";
      objective: string;
      iteration?: number;
      timeUsedSeconds?: number;
    }
  | {
      type: "goal-budget-limited";
      objective: string;
      iteration: number;
      tokensUsed?: number;
      tokenBudget?: number;
      timeUsedSeconds?: number;
      timeBudgetSeconds?: number;
      activePeriodStartedAt?: number;
    }
  | {
      type: "background-agent";
      count: number;
      detail?: string;
      done?: boolean;
      /** 全部结束、但其中有失败（error/stopped/aborted）时不为"已完成"说谎。 */
      hasError?: boolean;
    }
  | null;

/** 面板上方的安全留白；与 MergedInputChip 同一套做法与取值。 */
const SUBAGENT_PANEL_TOP_SAFE_AREA_PX = 48;
/** 面板高度上限；与 MergedInputChip 的 MODEL_MENU_MAX_HEIGHT_PX 同值（512px）。 */
const SUBAGENT_PANEL_MAX_HEIGHT_PX = 512;

interface ChatInputStatusBarProps {
  status: ChatInputStatus;
  onGoalCommand?: (action: string) => void;
  /** 面板行；为空时 chip 退回纯文本（行为与今天一致）。 */
  backgroundAgentRows?: BackgroundAgentRow[];
  onSelectBackgroundAgent?: (toolCallId: string) => void;
}

// Inline keyframes for gradient text animation (currentColor-based, auto-adapts to theme).
export const gradientStyles = `
@keyframes gradient-flow {
  0%   { background-position: 200% 50%; }
  100% { background-position: -200% 50%; }
}
.gradient-text {
  background: linear-gradient(90deg, transparent, currentColor, transparent);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: gradient-flow 3s linear infinite;
}
`;

export function ChatInputStatusBar({
  status,
  onGoalCommand,
  backgroundAgentRows,
  onSelectBackgroundAgent,
}: ChatInputStatusBarProps) {
  const { t } = useTranslation();
  const rows = backgroundAgentRows ?? [];
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null);

  // 面板贴着状态栏往上长，而祖先链上有 overflow-hidden：矮窗口 / 放大字号时
  // 70vh 会超过实际可用高度、顶部被裁且点不到。按锚点上方实测可用高度取上限
  // （做法与取值同 MergedInputChip.tsx:77-85）。
  const updatePanelMaxHeight = useCallback(() => {
    const anchor = panelRef.current;
    if (!anchor) return;
    const { top } = anchor.getBoundingClientRect();
    // 无布局信息（jsdom 等）时保留 className 上的默认上限
    if (top <= 0) return;
    setPanelMaxHeight(
      Math.min(
        SUBAGENT_PANEL_MAX_HEIGHT_PX,
        Math.max(0, Math.floor(top - SUBAGENT_PANEL_TOP_SAFE_AREA_PX)),
      ),
    );
  }, []);

  // 打开时先量一次（layout 阶段，避免首帧闪烁），窗口尺寸变化时重量。
  useLayoutEffect(() => {
    if (!panelOpen) return;
    updatePanelMaxHeight();
    window.addEventListener("resize", updatePanelMaxHeight);
    return () => window.removeEventListener("resize", updatePanelMaxHeight);
  }, [panelOpen, updatePanelMaxHeight]);

  // 目标长跑期间每秒推进一次。
  // dep 是布尔量而不是 now，所以窗口内不会每秒重建 effect；
  // 窗口到期时它变 false，effect 自行清理。
  const [now, setNow] = useState(() => Date.now());
  // 只有目标长跑需要走表（回合秒表已搬到消息区底部的任务坞）。
  const isTimeLive = isGoalTimeLive(status);
  useEffect(() => {
    if (!isTimeLive) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isTimeLive]);

  // ── 右区（子代理入口）────────────────────────────────────────────
  // 常驻、不参与上面的单槽位优先级链：模型回答中/目标长跑时也必须可见。
  // 任务清单不在这里：它由消息区底部的任务坞承载（2026-11-06）。
  const hasActivity = rows.length > 0;
  // 有失败行时整枚 chip 换成失败色：动作文案搬走后，这里不再有「N 个子代理结束，
  // 其中 M 个失败」那句话，失败信号不能只剩打开面板才看得见。
  const hasError = rows.some((row) => row.status === "error");

  // 类型只在面板内不统一时才值得占宽度（同类时逐行重复纯属噪音）
  const showType = new Set(rows.map((row) => row.type)).size > 1;

  // 活动归零时把展开态一并关掉：面板渲染在 `hasActivity` 里面，不重置的话
  // panelOpen 会残留为 true，下次一有活动面板会自己弹开。
  useEffect(() => {
    if (!hasActivity) setPanelOpen(false);
  }, [hasActivity]);

  // 右区（活动库存）：面板 + chip。目标态与普通态共用同一个元素——
  // 目标长跑是本次要修的典型场景，不共用的话它在目标态下会整块消失。
  // 开关 / 外部点击关闭 / Escape 三样全交给 Radix 的 Popover —— 手写的 document
  // mousedown/keydown 监听会让面板「刚打开就被关掉」（原实现正是如此，随本次迁移删掉）。
  const rightZone = hasActivity ? (
    <Popover open={panelOpen} onOpenChange={setPanelOpen}>
      <span className="flex min-w-0 items-center">
        {panelOpen && (
          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            // role="dialog" 由 Radix 的 PopoverContent 提供，不手写（写了会重复）
            aria-label={t("activity.panelTitle")}
            style={{ maxHeight: panelMaxHeight ?? undefined }}
            // 外壳用 vendored `PopoverContent` 自己的契约（`bg-popover` + `rounded-md`
            // + `shadow-md` + 入场动画），不再盖 `MENU_PANEL_CLASS` —— 与同族的
            // `StatusPopover` 面板一致（那边 2026-10-09 迁移时就是这么定的）。
            // `p-1` 必须留着：vendored 自带 `p-4`，靠 cn()「调用方 className 在最后」压住。
            className="w-[32rem] max-w-full max-h-[min(70vh,32rem)] overflow-y-auto p-1 text-xs"
          >
            {rows.length > 0 ? (
              <div className="flex items-baseline gap-1.5 px-2 pt-1 pb-1 text-[10px] tracking-wide text-muted-foreground uppercase">
                <span>{t("activity.subagentsSection")}</span>
              </div>
            ) : null}
            {rows.map((row) => (
              <Button
                variant="ghost"
                key={row.toolCallId}
                type="button"
                onClick={() => {
                  setPanelOpen(false);
                  onSelectBackgroundAgent?.(row.toolCallId);
                }}
                // ⚠️ 这四条类必须显式写回：`<Button>` base 的 `text-sm` / `font-medium` /
                // `[&_svg]:size-4` 与缺省档的 `h-9` 会盖掉面板容器的 `text-xs`（元素上的类胜过
                // 继承值）⇒ 行内字号 14px、图标 16px，比同一面板里的计划行（12px）还大
                // （2026-10-10 用户报障「子代理面板字体大小不对」的根因；面板出生时这里是原生
                // `<button>`，四者都是继承来的）。`cn` 会把四条冲突类**整条删掉**（同族后来者胜）
                // ⇒ 不必操心样式表里的先后顺序。
                // ⚠️ `[&_svg]:size-3` 的作用面是**行内所有 svg**，不只是右侧那个状态图标 ——
                // 往这一行里再加图标的人要回读这句，否则新图标会被静默压成 12px。
                className={`flex h-auto w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-normal [&_svg]:size-3 hover:bg-hover-surface ${
                  // 已完成的行降一档：面板里可能同时有"上一轮还在跑的"和"本轮已完成的"。
                  // `error` 刻意不降 —— 失败是应该被注意到的信号。
                  row.status === "completed" ? "opacity-60" : ""
                }`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {/* ① 名字（只有面板内类型不统一时才带后缀） */}
                  <span className="truncate text-foreground">
                    {row.name ?? row.type ?? row.toolCallId}
                    {showType && row.name && row.type ? (
                      <span className="text-muted-foreground">
                        {" · "}
                        {row.type}
                      </span>
                    ) : null}
                  </span>
                  {/* ② 任务描述：始终显示（之前只在没有步骤时才出现） */}
                  {row.description ? (
                    <span className="truncate text-muted-foreground">
                      {row.description}
                    </span>
                  ) : null}
                  {/* ③ 当前动作 / 最后一步：没有就不渲染，避免与描述重复同一句话 */}
                  {row.currentLabel ? (
                    <span className="truncate font-mono text-muted-foreground">
                      {row.currentLabel}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-shrink-0 items-center gap-1 text-muted-foreground">
                  {row.stepCount > 0 && <span>{row.stepCount}</span>}
                  {row.durationMs > 0 && (
                    <span>
                      {row.durationMs < 1000
                        ? `${row.durationMs}ms`
                        : `${(row.durationMs / 1000).toFixed(1)}s`}
                    </span>
                  )}
                  {row.status === "running" ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary-text" />
                  ) : row.status === "error" ? (
                    <XCircle className="h-3 w-3 text-destructive" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                </span>
              </Button>
            ))}
          </PopoverContent>
        )}
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            type="button"
            // chip 里恒有可见文案（子代理计数），不设 aria-label —— 它会把内容整个盖掉，
            // 读屏用户就听不到「N 个子代理」了。
            // ⚠️ 这四条类必须显式写回（与面板行同一族的迁移回归）：`<Button>` base 的 `text-sm` /
            // `font-medium` / `[&_svg]:size-4` 与缺省档的 `h-9` 会盖掉这枚 chip 自己写的
            // `min-h-5`（min-height 顶不掉 36px 定高）和 chevron 的 `h-3 w-3`（`[&_svg]:size-4`
            // 的选择器是 `.cls svg`，比 `.h-3` 高一级 ⇒ 16px）。真机实测（Chromium + 构建 CSS，
            // 2026-10-10）：chip 盒 32×36px、chevron 16px、字 14px/500，而同一行左侧的状态文案是
            // 12px/高 16px ⇒ 一枚 36px 圆钮杵在 12px 文案旁边（用户报障「子代理这个图标太高了」）；
            // 写回后实测 28×20px、chevron 12px、字 12px/400 == `min-h-5`。
            // ⚠️ `[&_svg]:size-3` 的作用面是**这枚 chip 里所有 svg** —— 目前只有右侧那个
            // chevron（面板走 portal，不在此列），往 chip 里再加图标的人要回读这句。
            className="flex h-auto min-h-5 min-w-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-left text-xs font-normal text-foreground transition-colors hover:bg-selected-surface [&_svg]:size-3"
          >
            <span className={`flex-none ${hasError ? "text-destructive" : ""}`}>
              {t("activity.subagents", { count: rows.length })}
            </span>
            <ChevronDown className="h-3 w-3 flex-none text-muted-foreground" />
          </Button>
        </PopoverTrigger>
      </span>
    </Popover>
  ) : null;

  // ── Goal status rendering ──
  if (
    status &&
    (status.type === "goal-active" ||
      status.type === "goal-paused" ||
      status.type === "goal-complete" ||
      status.type === "goal-blocked" ||
      status.type === "goal-budget-limited")
  ) {
    const renderGoalIcon = (type: string) => {
      const cls = "w-3.5 h-3.5 flex-shrink-0 text-muted-foreground";
      switch (type) {
        case "goal-active":
          return <Target className={cls} />;
        case "goal-paused":
          return <CirclePause className={cls} />;
        case "goal-complete":
          return <BadgeCheck className={cls} />;
        case "goal-blocked":
          return <Ban className={cls} />;
        case "goal-budget-limited":
          return <CircleDollarSign className={cls} />;
        default:
          return null;
      }
    };

    // eslint-disable-next-line no-inner-declarations
    function formatElapsedTime(seconds: number): string {
      const s = Math.round(seconds);
      if (s < 60) return t("goal.timeLessThanMinute");
      if (s < 3600) return t("goal.timeMinutes", { n: Math.round(s / 60) });
      const h = Math.floor(s / 3600);
      const m = Math.round((s % 3600) / 60);
      if (m === 0) return t("goal.timeMinutes", { n: h * 60 });
      return t("goal.timeHoursMinutes", { h, m });
    }

    let infoText = "";
    if (status.type === "goal-active") {
      infoText = t("goal.turn", { n: status.iteration });
    } else if (status.type === "goal-paused") {
      infoText = t("goal.turnsDone", { n: status.iteration ?? 0 });
    } else if (
      status.type === "goal-complete" ||
      status.type === "goal-blocked"
    ) {
      infoText = t("goal.turnsDone", { n: status.iteration ?? 0 });
    } else if (status.type === "goal-budget-limited") {
      infoText = t("goal.lastRound");
    }

    // Append elapsed time for all goal states that have timeUsedSeconds
    const displaySeconds =
      status.timeUsedSeconds != null
        ? computeElapsedSeconds(status, now)
        : undefined;
    if (displaySeconds != null && displaySeconds > 0) {
      const isOngoing =
        status.type === "goal-active" ||
        status.type === "goal-paused" ||
        status.type === "goal-budget-limited";
      infoText += ` · ${t(isOngoing ? "goal.elapsed" : "goal.elapsedDone", { time: formatElapsedTime(displaySeconds) })}`;
    }

    return (
      <div ref={panelRef} className="relative min-h-5 px-1 pb-1">
        <style>{gradientStyles}</style>
        <div className="flex items-center gap-1.5 text-xs text-foreground">
          {renderGoalIcon(status.type)}
          <span
            className={`min-w-0 truncate ${status.type === "goal-active" ? "gradient-text" : ""}`}
          >
            {status.objective}
          </span>
          <span
            className={`flex-shrink-0 text-muted-foreground ${status.type === "goal-active" ? "gradient-text" : ""}`}
          >
            {infoText}
          </span>
          {status.type === "goal-active" && onGoalCommand && (
            <Button
              variant="ghost"
              type="button"
              className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-primary/15 text-primary-text hover:bg-primary/25 transition-[transform,background-color,color] active:scale-[0.97] h-auto font-normal"
              onClick={() => onGoalCommand("goal:pause")}
            >
              {t("goal.pause")}
            </Button>
          )}
          {status.type === "goal-paused" && onGoalCommand && (
            <>
              <Button
                variant="ghost"
                type="button"
                className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-primary/15 text-primary-text hover:bg-primary/25 transition-[transform,background-color,color] active:scale-[0.97] h-auto font-normal"
                onClick={() => onGoalCommand("goal:resume")}
              >
                {t("goal.resume")}
              </Button>
              <Button
                variant="ghost"
                type="button"
                className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-accent text-muted-foreground hover:bg-selected-surface transition-[transform,background-color,color] active:scale-[0.97] h-auto font-normal"
                onClick={() => onGoalCommand("goal:clear")}
              >
                {t("goal.clear")}
              </Button>
            </>
          )}
          {rightZone}
        </div>
      </div>
    );
  }

  // ── 非目标态 ──
  // 动作态（思考中/执行中/压缩中 + 秒表）已搬到消息区底部的任务坞；
  // 这里只剩子代理入口。没有内容时整行不渲染，也不留固定高度占位。
  if (!rightZone) return null;

  return (
    // 定位锚点放在这个容器上（而不是 chip 那个 span）：面板是它的绝对定位子元素，
    // 于是 max-w-full 就等于「聊天列可用宽度」——侧栏宽度、右侧面板、字号缩放全都自动计入。
    // panelRef 必须跟着放这里，否则外部点击关闭会把面板内的点击当成外部点击。
    <div ref={panelRef} className="relative min-h-5 px-1 pb-1">
      <div className="flex items-center gap-1.5 text-xs text-foreground">
        {rightZone}
      </div>
    </div>
  );
}

/** Pure function: resolve the single highest-priority input-area status.
 *  Testable without mounting ChatView. */
export function resolveInputStatus(params: {
  isSending: boolean;
  isCompacting: boolean;
  compactionResult: "success" | "failed" | "aborted" | null;
  shouldShowThinkingIndicator: boolean;
  isResponding: boolean;
  goalStatus?: {
    status:
      | "active"
      | "paused"
      | "complete"
      | "cleared"
      | "blocked"
      | "budget_limited";
    objective?: string;
    iteration?: number;
    tokensUsed?: number;
    tokenBudget?: number;
    timeUsedSeconds?: number;
    timeBudgetSeconds?: number;
    activePeriodStartedAt?: number;
  } | null;
  /** 面板行（运行中 + 已完成）。改掉了原来的 `backgroundAgents`：那个列表完成 1 秒后
   *  就被清空，而入口需要在跑完之后仍然可达。 */
  backgroundAgentRows: BackgroundAgentRow[];
}): ChatInputStatus {
  if (params.isCompacting) return { type: "compacting" };
  if (params.isSending) return { type: "sending" };
  if (params.compactionResult === "failed") {
    return { type: "compaction-failed" };
  }
  if (params.compactionResult === "aborted") {
    return { type: "compaction-aborted" };
  }
  if (params.compactionResult === "success") {
    return { type: "compaction-success" };
  }
  if (params.goalStatus) {
    switch (params.goalStatus.status) {
      case "active":
        return {
          type: "goal-active",
          objective: params.goalStatus.objective ?? "",
          iteration: params.goalStatus.iteration ?? 0,
          tokensUsed: params.goalStatus.tokensUsed,
          tokenBudget: params.goalStatus.tokenBudget,
          timeUsedSeconds: params.goalStatus.timeUsedSeconds,
          activePeriodStartedAt: params.goalStatus.activePeriodStartedAt,
        };
      case "paused":
        return {
          type: "goal-paused",
          objective: params.goalStatus.objective ?? "",
          iteration: params.goalStatus.iteration,
          timeUsedSeconds: params.goalStatus.timeUsedSeconds,
        };
      case "complete":
        return {
          type: "goal-complete",
          objective: params.goalStatus.objective ?? "",
          iteration: params.goalStatus.iteration,
          timeUsedSeconds: params.goalStatus.timeUsedSeconds,
        };
      case "blocked":
        return {
          type: "goal-blocked",
          objective: params.goalStatus.objective ?? "",
          iteration: params.goalStatus.iteration,
          timeUsedSeconds: params.goalStatus.timeUsedSeconds,
        };
      case "budget_limited":
        return {
          type: "goal-budget-limited",
          objective: params.goalStatus.objective ?? "",
          iteration: params.goalStatus.iteration ?? 0,
          tokensUsed: params.goalStatus.tokensUsed,
          tokenBudget: params.goalStatus.tokenBudget,
          timeUsedSeconds: params.goalStatus.timeUsedSeconds,
          timeBudgetSeconds: params.goalStatus.timeBudgetSeconds,
          activePeriodStartedAt: params.goalStatus.activePeriodStartedAt,
        };
    }
  }
  if (params.shouldShowThinkingIndicator) {
    return { type: "thinking" };
  }
  if (params.isResponding) {
    return { type: "responding" };
  }
  if (params.backgroundAgentRows.length > 0) {
    const running = params.backgroundAgentRows.filter(
      (row) => row.status === "running",
    );
    const allDone = running.length === 0;
    const count = allDone ? params.backgroundAgentRows.length : running.length;
    const first = running[0];
    const detail =
      count === 1 && first
        ? [first.type, first.description].filter(Boolean).join(" · ")
        : undefined;
    const hasError =
      allDone &&
      params.backgroundAgentRows.some((row) => row.status === "error");
    return {
      type: "background-agent",
      count,
      detail,
      done: allDone,
      hasError: hasError || undefined,
    };
  }
  return null;
}

/** Goal status types whose elapsed clock keeps running (vs. frozen snapshots). */
export function isGoalTimeLive(status: ChatInputStatus): boolean {
  return (
    status?.type === "goal-active" || status?.type === "goal-budget-limited"
  );
}

/** 非 goal 的运行态里，回合秒表是否在走。
 *  `endAt === null` 就是 live 的定义：它让本函数与 5s 收尾分支互为补集，
 *  两者不会同时为真，所以同一帧只可能渲染一种措辞。 */
export function isTurnClockLive(
  status: ChatInputStatus,
  clock: SessionExecutionClock | undefined,
): boolean {
  if (!clock || clock.startAt === null || clock.endAt !== null) return false;
  return (
    status?.type === "sending" ||
    status?.type === "thinking" ||
    status?.type === "responding" ||
    status?.type === "compacting"
  );
}

/** Narrow to goal status variants that carry a timeUsedSeconds snapshot. */
function hasTimeUsed(
  status: ChatInputStatus,
): status is Extract<ChatInputStatus, { timeUsedSeconds?: number }> {
  return status !== null && "timeUsedSeconds" in status;
}

/** Seconds to display in the status bar: use the authoritative active
 *  period start for live states, frozen snapshot otherwise. */
export function computeElapsedSeconds(
  status: ChatInputStatus,
  nowMs: number,
): number {
  const base = hasTimeUsed(status) ? (status.timeUsedSeconds ?? 0) : 0;
  if (
    !status ||
    (status.type !== "goal-active" && status.type !== "goal-budget-limited")
  ) {
    return base;
  }
  const startedAt = status.activePeriodStartedAt;
  if (startedAt == null) return base;
  return base + Math.max(0, (nowMs - startedAt) / 1000);
}
