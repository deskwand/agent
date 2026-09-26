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
  Square,
} from "lucide-react";
import { MENU_PANEL_CLASS } from "./menu-styles";
import type { BackgroundAgentRow } from "../utils/subagent-card";
import type { CurrentTodos } from "../utils/current-todos";

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
  /** 当前生效的任务清单；null = 未知/没有，[] = 已清空。为空则右区不渲染计划部分。 */
  currentTodos?: CurrentTodos | null;
  /** 当前清单是否被声明结束（`done: true`）。 */
  currentPlanDone?: boolean;
  /** 最后一份非空清单，只服务收尾态（currentTodos 被清空后仍显示其最终状态）。 */
  lastNonEmptyTodos?: CurrentTodos | null;
  /** 被记住那份清单当时是否声明了结束。 */
  lastPlanDone?: boolean;
}

// Inline keyframes for gradient text animation (currentColor-based, auto-adapts to theme).
const gradientStyles = `
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
  currentTodos,
  currentPlanDone,
  lastNonEmptyTodos,
  lastPlanDone,
}: ChatInputStatusBarProps) {
  const { t } = useTranslation();
  const rows = backgroundAgentRows ?? [];
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null);

  // 面板贴着状态栏往上长，而祖先链上有 overflow-hidden：矮窗口 / 放大字号时
  // 70vh 会超过实际可用高度、顶部被裁且点不到。按锚点上方实测可用高度取上限
  // （做法与取值同 MergedInputChip.tsx:64-80）。
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

  useEffect(() => {
    if (!panelOpen) return;
    // 与 StatusPopover（:74）保持一致的事件：mousedown
    const onMouseDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node))
        setPanelOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panelOpen]);

  // Live-tick the elapsed clock while the goal is actively running.
  const [now, setNow] = useState(() => Date.now());
  const isTimeLive = isGoalTimeLive(status);
  useEffect(() => {
    if (!isTimeLive) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isTimeLive]);

  // ── 右区（活动库存）──────────────────────────────────────────────────
  // 常驻、不参与上面的单槽位优先级链：模型回答中/目标长跑时也必须可见。
  const activeTodos = currentTodos ?? [];
  // 收尾态：清单被显式清空（[]），但上次有一份非空清单 → 展示那份的最终状态。
  // 注意 currentTodos === null（从未有过 / 重启后无水合结果）**不**进收尾态。
  // 必须用 Array.isArray 而不是 `activeTodos.length === 0`：后者会把 null
  // （从未有过清单）也当成"被清空"，于是凭空显示一份收尾态。
  const finishing =
    Array.isArray(currentTodos) &&
    currentTodos.length === 0 &&
    (lastNonEmptyTodos?.length ?? 0) > 0;
  const todos = finishing ? (lastNonEmptyTodos ?? []) : activeTodos;
  const completedCount = todos.filter(
    (item) => item.status === "completed",
  ).length;
  const allDone = todos.length > 0 && completedCount === todos.length;
  // 展示的是哪一份清单：收尾态用被记住的那份，否则用当前的
  const planDone = finishing
    ? (lastPlanDone ?? false)
    : (currentPlanDone ?? false);
  const hasPlan = todos.length > 0;
  const hasActivity = hasPlan || rows.length > 0;
  // 子代理计数由谁承载：左区已经在说这件事时（只可能发生在没有更高优先级状态时）
  // chip 不再重复一遍；模型回答中/目标长跑时左区在说别的，计数就落到 chip 上——
  // 那正是本次要修的场景（此前它被单槽位优先级吃掉，整行都看不到）。
  const countInChip = rows.length > 0 && status?.type !== "background-agent";

  // pill 里的「当前步骤」：进行中那一项的文案。取值与原卡片头部一致
  // （TodoWriteBlock.tsx:103 用的是 activeForm || content）。
  const inProgressTodo = todos.find((item) => item.status === "in_progress");
  // 收尾态必须**优先**判断：否则会沿用"进行中项"的 activeForm（"正在…"），
  // 把已经停下来的过去状态渲染成现在进行时 —— 看起来就像状态没更新。
  const stepText = finishing
    ? // 显示清单数组的末项。数据里没有逐项完成时间戳，所以"最后完成的是哪一项"
      // 无从得知——不要试图去猜。
      (todos[todos.length - 1]?.content ?? null)
    : inProgressTodo
      ? inProgressTodo.activeForm || inProgressTodo.content
      : null;
  // 结束声明优先于"当前步骤"：声明了结束就说明是过去态，不再说"正在…"
  // 声明结束时，比起"已结束"这种笼统措辞，用户更需要知道**有几项没完成**。
  // done 要求每一项都已结算，所以"未全部完成"必然意味着有取消项。
  const cancelledCount = todos.filter(
    (item) => item.status === "cancelled",
  ).length;
  const statusLabel = !hasPlan
    ? null
    : planDone
      ? allDone
        ? t("activity.statusDone")
        : t("activity.statusCancelled", { count: cancelledCount })
      : finishing
        ? t("activity.statusCleared")
        : stepText;

  // 类型只在面板内不统一时才值得占宽度（同类时逐行重复纯属噪音）
  const showType = new Set(rows.map((row) => row.type)).size > 1;

  // 活动归零时把展开态一并关掉：面板渲染在 `hasActivity` 里面，不重置的话
  // panelOpen 会残留为 true，下次一有活动面板会自己弹开。
  useEffect(() => {
    if (!hasActivity) setPanelOpen(false);
  }, [hasActivity]);

  // 右区（活动库存）：面板 + chip。目标态与普通态共用同一个元素——
  // 目标长跑是本次要修的典型场景，不共用的话它在目标态下会整块消失。
  const rightZone = hasActivity ? (
    <span className="flex min-w-0 items-center">
      {panelOpen && (
        <div
          role="dialog"
          aria-label={t("activity.panelTitle")}
          style={{ maxHeight: panelMaxHeight ?? undefined }}
          className={`${MENU_PANEL_CLASS} animate-menu-in-up absolute bottom-full left-0 z-30 mb-2 w-[32rem] max-w-full max-h-[min(70vh,32rem)] overflow-y-auto p-1 text-xs`}
        >
          {hasPlan ? (
            <>
              <div className="flex items-baseline gap-1.5 px-2 pt-1 pb-1 text-[10px] tracking-wide text-text-muted uppercase">
                <span>{t("activity.planSection")}</span>
                <span className="ml-auto tracking-normal">
                  {t("activity.planDone", {
                    completed: completedCount,
                    total: todos.length,
                  })}
                </span>
              </div>
              {todos.map((todo, index) => {
                // 收尾态里没有任何东西在跑：把当时的 in_progress 按"没做完、已停止"
                // 渲染（方框 + 常规色），不要转圈也不要强调色 —— 那是实时态的说法。
                const shown =
                  finishing && todo.status === "in_progress"
                    ? "pending"
                    : todo.status;
                return (
                  <div
                    key={`${index}-${todo.content}`}
                    className={`flex items-start gap-2 rounded-lg px-2 py-1 ${
                      shown === "completed" || shown === "cancelled"
                        ? "opacity-60"
                        : ""
                    }`}
                  >
                    <span className="mt-0.5 flex-none">
                      {shown === "completed" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                      ) : shown === "in_progress" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                      ) : shown === "cancelled" ? (
                        <XCircle className="h-3.5 w-3.5 text-text-muted" />
                      ) : (
                        <Square className="h-3.5 w-3.5 text-text-muted" />
                      )}
                    </span>
                    <span
                      className={`min-w-0 flex-1 ${
                        shown === "completed" || shown === "cancelled"
                          ? "text-text-muted line-through"
                          : shown === "in_progress"
                            ? "font-medium text-accent"
                            : "text-text-primary"
                      }`}
                    >
                      {todo.content}
                    </span>
                  </div>
                );
              })}
            </>
          ) : null}
          {rows.length > 0 ? (
            <div className="flex items-baseline gap-1.5 px-2 pt-1 pb-1 text-[10px] tracking-wide text-text-muted uppercase">
              <span>{t("activity.subagentsSection")}</span>
            </div>
          ) : null}
          {rows.map((row) => (
            <button
              key={row.toolCallId}
              type="button"
              onClick={() => {
                setPanelOpen(false);
                onSelectBackgroundAgent?.(row.toolCallId);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-hover/60 ${
                // 已完成的行降一档：面板里可能同时有"上一轮还在跑的"和"本轮已完成的"。
                // `error` 刻意不降 —— 失败是应该被注意到的信号。
                row.status === "completed" ? "opacity-60" : ""
              }`}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/* ① 名字（只有面板内类型不统一时才带后缀） */}
                <span className="truncate text-text-primary">
                  {row.name ?? row.type ?? row.toolCallId}
                  {showType && row.name && row.type ? (
                    <span className="text-text-muted">
                      {" · "}
                      {row.type}
                    </span>
                  ) : null}
                </span>
                {/* ② 任务描述：始终显示（之前只在没有步骤时才出现） */}
                {row.description ? (
                  <span className="truncate text-text-secondary">
                    {row.description}
                  </span>
                ) : null}
                {/* ③ 当前动作 / 最后一步：没有就不渲染，避免与描述重复同一句话 */}
                {row.currentLabel ? (
                  <span className="truncate font-mono text-text-muted">
                    {row.currentLabel}
                  </span>
                ) : null}
              </span>
              <span className="flex flex-shrink-0 items-center gap-1 text-text-muted">
                {row.stepCount > 0 && <span>{row.stepCount}</span>}
                {row.durationMs > 0 && (
                  <span>
                    {row.durationMs < 1000
                      ? `${row.durationMs}ms`
                      : `${(row.durationMs / 1000).toFixed(1)}s`}
                  </span>
                )}
                {row.status === "running" ? (
                  <Loader2 className="h-3 w-3 animate-spin text-accent" />
                ) : row.status === "error" ? (
                  <XCircle className="h-3 w-3 text-error" />
                ) : (
                  <CheckCircle2 className="h-3 w-3" />
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        // 有可见文案（步骤/计数）时不要设 aria-label —— 它会把内容整个盖掉，
        // 读屏用户就听不到"3/5 · 正在写迁移"了。只在只剩一个 chevron 时兜底。
        aria-label={
          hasPlan || countInChip ? undefined : t("activity.panelTitle")
        }
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen((value) => !value)}
        className="flex min-h-5 min-w-0 items-center gap-1.5 rounded-full bg-background-secondary px-2 py-0.5 text-left text-text-primary transition-colors hover:bg-surface-active"
      >
        {hasPlan ? (
          <>
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={todos.length}
              aria-valuenow={completedCount}
              className="h-1 w-[34px] flex-none overflow-hidden rounded-full bg-surface-active"
            >
              <span
                className="block h-full bg-accent"
                style={{
                  width: `${(completedCount / todos.length) * 100}%`,
                }}
              />
            </span>
            <span className="flex-none">
              {planDone ? "✓ " : ""}
              {completedCount}/{todos.length}
            </span>
            {statusLabel ? (
              <span className="max-w-[12rem] min-w-0 truncate text-text-muted">
                · {statusLabel}
              </span>
            ) : null}
          </>
        ) : null}
        {countInChip ? (
          <span className={`flex-none ${hasPlan ? "text-text-muted" : ""}`}>
            {hasPlan ? "· " : ""}
            {t("activity.subagents", { count: rows.length })}
          </span>
        ) : null}
        <ChevronDown className="h-3 w-3 flex-none text-text-muted" />
      </button>
    </span>
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
      const cls = "w-3.5 h-3.5 flex-shrink-0 text-text-muted";
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
        <div className="flex items-center gap-1.5 text-xs text-text-primary">
          {renderGoalIcon(status.type)}
          <span
            className={`min-w-0 truncate ${status.type === "goal-active" ? "gradient-text" : ""}`}
          >
            {status.objective}
          </span>
          <span
            className={`flex-shrink-0 text-text-muted ${status.type === "goal-active" ? "gradient-text" : ""}`}
          >
            {infoText}
          </span>
          {status.type === "goal-active" && onGoalCommand && (
            <button
              type="button"
              className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-accent/15 text-accent hover:bg-accent/25 transition-[transform,background-color,color] active:scale-[0.97]"
              onClick={() => onGoalCommand("goal:pause")}
            >
              {t("goal.pause")}
            </button>
          )}
          {status.type === "goal-paused" && onGoalCommand && (
            <>
              <button
                type="button"
                className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-accent/15 text-accent hover:bg-accent/25 transition-[transform,background-color,color] active:scale-[0.97]"
                onClick={() => onGoalCommand("goal:resume")}
              >
                {t("goal.resume")}
              </button>
              <button
                type="button"
                className="flex-shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-surface-hover text-text-muted hover:bg-surface-hover/80 transition-[transform,background-color,color] active:scale-[0.97]"
                onClick={() => onGoalCommand("goal:clear")}
              >
                {t("goal.clear")}
              </button>
            </>
          )}
          {rightZone}
        </div>
      </div>
    );
  }

  // ── Non-goal status rendering ──
  let text = "";
  let toneClass = "text-text-muted";
  let isRunning = false;

  if (status) {
    switch (status.type) {
      case "sending":
        text = t("chat.sending");
        toneClass = "text-text-primary";
        isRunning = true;
        break;
      case "thinking":
        text = t("chat.processing");
        toneClass = "text-text-primary";
        isRunning = true;
        break;
      case "responding":
        text = t("chat.responding");
        toneClass = "text-text-primary";
        isRunning = true;
        break;
      case "compacting":
        text = t("chat.compacting");
        toneClass = "text-text-primary";
        isRunning = true;
        break;
      case "compaction-success":
        text = t("chat.compacted");
        toneClass = "text-text-muted";
        break;
      case "compaction-failed":
        text = t("chat.compactFailed");
        toneClass = "text-text-muted";
        break;
      case "compaction-aborted":
        text = t("chat.compactAborted");
        toneClass = "text-text-muted";
        break;
      case "background-agent":
        if (status.done) {
          text = status.hasError
            ? t("subagent.statusFinishedWithErrors", { count: status.count })
            : t("subagent.statusDone", { count: status.count });
          toneClass = status.hasError ? "text-error" : "text-text-muted";
        } else {
          text = t("subagent.statusRunning", {
            count: status.count,
            detail: status.detail ? ` ${status.detail}` : "",
          });
          toneClass = "text-text-primary";
          isRunning = true;
        }
        break;
      // goal-* handled by early return above
    }
  }

  // Always render a fixed-height container to prevent layout jump

  return (
    // 定位锚点放在这个容器上（而不是 chip 那个 span）：面板是它的绝对定位子元素，
    // 于是 max-w-full 就等于「聊天列可用宽度」——侧栏宽度、右侧面板、字号缩放全都自动计入。
    // panelRef 必须跟着放这里，否则外部点击关闭会把面板内的点击当成外部点击。
    <div ref={panelRef} className="relative min-h-5 px-1 pb-1">
      <style>{gradientStyles}</style>
      <div className={`flex items-center gap-1.5 text-xs ${toneClass}`}>
        {text ? (
          <span
            className={`min-w-0 truncate ${isRunning ? "gradient-text" : ""}`}
          >
            {text}
          </span>
        ) : null}
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
