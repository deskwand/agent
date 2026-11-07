// 消息区底部任务坞：清单卡（上）+ 动作行（下）。
// 定位：挂在消息滚动内容的末尾（ChatView 的 flex 列 + mt-auto）——属于消息内容，
// 不 sticky、不占独立一行；内容少时被推到最底，内容一多就随消息一起滚走。
// 只在运行中与结束后的 5s 收尾窗口内出现（与停止按钮 canStop 同源），其余时候整块收起。
// 行为对齐 eagent 的 ChatTaskDock（~/src/eagent/eagent/frontend/src/components/ChatTaskDock.jsx）：
// 参考实现还在坞里放了一块"尾部过程摘要"，那要动转录的摘要抑制逻辑，本次不做。
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { CurrentTodos } from "../utils/current-todos";
import {
  TURN_CLOCK_SLOT_SENTINEL_SECONDS,
  formatDurationShort,
  isLingering,
} from "../utils/execution-clock";
import {
  gradientStyles,
  isTurnClockLive,
  type ChatInputStatus,
} from "./ChatInputStatusBar";
import type { SessionExecutionClock } from "../store";

/** 清单项的四个状态图标。用字形而不是 lucide 图标：一行 22px 高，图标尺寸箱只有 14px。 */
const TODO_GLYPH: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
  cancelled: "✕",
};

/** 文案样式。完成态**不上**成功色：绿在本仓标记的是「一次操作成功收尾 / 健康」，
 *  而「这一项已完成」是持续状态，行里的删除线已经说过一次。 */
function rowTextClass(status: string): string {
  switch (status) {
    case "completed":
      return "text-muted-foreground line-through";
    case "in_progress":
      return "font-medium text-foreground";
    case "cancelled":
      return "text-muted-foreground line-through opacity-60";
    default:
      return "text-foreground";
  }
}

/** 进行中项 = 动作档：图标吃主色，「此刻在动」该被看见；其余一律元信息档。 */
function rowGlyphClass(status: string): string {
  return status === "in_progress"
    ? "text-primary-text"
    : "text-muted-foreground";
}

/** 坞里要显示的那一份清单，以及它的计数与一句话状态。 */
interface PlanDisplay {
  todos: CurrentTodos;
  /** 展示的是「刚收尾」的那份（currentTodos 已被清空，改用记住的最后一份）。 */
  finishing: boolean;
  planDone: boolean;
  completedCount: number;
  cancelledCount: number;
  allDone: boolean;
  stepText: string | null;
}

function derivePlanDisplay(params: {
  currentTodos?: CurrentTodos | null;
  currentPlanDone?: boolean;
  lastNonEmptyTodos?: CurrentTodos | null;
  lastPlanDone?: boolean;
}): PlanDisplay {
  const { currentTodos, currentPlanDone, lastNonEmptyTodos, lastPlanDone } =
    params;
  // `currentTodos === null`（从未有过 / 重启后还没水合）**不**进收尾态：
  // 必须用 Array.isArray —— `length === 0` 会把 null 也当成"被清空"，
  // 于是凭空显示上一轮那份清单。
  const finishing =
    Array.isArray(currentTodos) &&
    currentTodos.length === 0 &&
    (lastNonEmptyTodos?.length ?? 0) > 0;
  const todos = finishing ? (lastNonEmptyTodos ?? []) : (currentTodos ?? []);
  const completedCount = todos.filter(
    (item) => item.status === "completed",
  ).length;
  const cancelledCount = todos.filter(
    (item) => item.status === "cancelled",
  ).length;
  const allDone = todos.length > 0 && completedCount === todos.length;
  // 收尾态取被记住那份清单自己声明的结束，不取当前值。
  const planDone = finishing
    ? (lastPlanDone ?? false)
    : (currentPlanDone ?? false);
  // 收尾态必须**优先**判断：否则会沿用进行中项的 activeForm（"正在…"），
  // 把已经停下来的过去状态渲染成现在进行时 —— 看起来像状态没更新。
  // 数据里没有逐项完成时间戳，收尾态只能取末项，不要试图猜"最后完成的是哪一项"。
  const inProgress = todos.find((item) => item.status === "in_progress");
  const stepText = finishing
    ? (todos[todos.length - 1]?.content ?? null)
    : inProgress
      ? inProgress.activeForm || inProgress.content
      : null;
  return {
    todos,
    finishing,
    planDone,
    completedCount,
    cancelledCount,
    allDone,
    stepText,
  };
}

/** 卡头那一句话：声明结束就说结束（未全部完成 → 报取消数量），
 *  刚清空就说清空，否则说进行中项在做什么。无清单时返回 null。 */
function planLabel(display: PlanDisplay, t: TFunction): string | null {
  if (display.todos.length === 0) return null;
  if (display.planDone) {
    return display.allDone
      ? t("activity.statusDone")
      : t("activity.statusCancelled", { count: display.cancelledCount });
  }
  if (display.finishing) return t("activity.statusCleared");
  return display.stepText;
}

function TaskCard({ display }: { display: PlanDisplay }) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);
  const activeIndex = display.todos.findIndex(
    (item) => item.status === "in_progress",
  );

  // 进行中项跑到可视区外时，只挪清单自身的 scrollTop。
  // ⚠️ 禁用 scrollIntoView：它会连带滚动所有可滚动祖先，把整个消息列表带跑。
  useEffect(() => {
    const list = listRef.current;
    if (!list || activeIndex < 0) return;
    const current = list.querySelector<HTMLElement>('[data-active="true"]');
    if (!current) return;
    const top = current.offsetTop;
    const bottom = top + current.offsetHeight;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(
        0,
        top - (list.clientHeight - current.offsetHeight) / 2,
      );
    }
  }, [activeIndex, display.todos.length]);

  const label = planLabel(display, t);

  return (
    <div className="rounded-[10px] border border-border/60 bg-background px-2.5 py-2">
      <div className="mb-1 flex items-baseline gap-1.5 text-xs text-muted-foreground">
        <span className="flex-none tabular-nums">
          {display.completedCount}/{display.todos.length}
        </span>
        {label ? <span className="min-w-0 truncate">· {label}</span> : null}
      </div>
      <ul
        ref={listRef}
        // 高度自适应（几项就几行）；max-h 只是兜底 —— 计划上限 50 项，
        // 全展开会把消息区挤没，超出才内部滚动。
        className="m-0 max-h-[44vh] list-none overflow-y-auto p-0"
      >
        {display.todos.map((todo, index) => {
          // 收尾态里没有任何东西在跑：把当时的进行中项按"没做完、已停止"渲染
          // （方框 + 常规色），不要转圈也不要强调色 —— 那是实时态的说法。
          const shown =
            display.finishing && todo.status === "in_progress"
              ? "pending"
              : todo.status;
          return (
            <li
              key={`${index}-${todo.content}`}
              data-active={shown === "in_progress" ? "true" : undefined}
              title={todo.content}
              className="flex h-[22px] items-center gap-[7px] text-sm"
            >
              <span
                aria-hidden="true"
                className={`w-3.5 flex-none text-center text-xs ${rowGlyphClass(shown)}`}
              >
                {TODO_GLYPH[shown] ?? "○"}
              </span>
              <span className={`min-w-0 truncate ${rowTextClass(shown)}`}>
                {todo.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 四个点沿轨道绕中心转：真实尺寸下连线看不见，观感就是几个点此起彼伏地交替。
 *  纯 CSS，复用 Tailwind 既有的 spin 关键帧（不为一个图标改配置文件）。 */
function StatusGlyph() {
  return (
    <span
      data-testid="dock-status-glyph"
      aria-hidden="true"
      className="relative inline-flex h-3.5 w-3.5 flex-none animate-[spin_1.6s_linear_infinite] items-center justify-center text-primary-text"
    >
      <i className="absolute left-1/2 top-0 block h-1 w-1 -translate-x-1/2 rounded-full bg-current" />
      <i className="absolute right-0 top-1/2 block h-1 w-1 -translate-y-1/2 rounded-full bg-current opacity-60" />
      <i className="absolute bottom-0 left-1/2 block h-1 w-1 -translate-x-1/2 rounded-full bg-current opacity-30" />
      <i className="absolute left-0 top-1/2 block h-1 w-1 -translate-y-1/2 rounded-full bg-current opacity-45" />
    </span>
  );
}

/** 坞的动作行：只承载"这一轮在干什么"。goal 归输入框上方的目标段，
 *  子代理计数归那里的 chip —— 同一件事不在两处各说一遍。 */
export function resolveDockAction(
  status: ChatInputStatus,
  t: TFunction,
): { text: string; toneClass: string; isRunning: boolean } | null {
  if (!status) return null;
  switch (status.type) {
    case "sending":
      return {
        text: t("chat.sending"),
        toneClass: "text-foreground",
        isRunning: true,
      };
    case "thinking":
      return {
        text: t("chat.processing"),
        toneClass: "text-foreground",
        isRunning: true,
      };
    case "responding":
      return {
        text: t("chat.responding"),
        toneClass: "text-foreground",
        isRunning: true,
      };
    case "compacting":
      return {
        text: t("chat.compacting"),
        toneClass: "text-foreground",
        isRunning: true,
      };
    case "compaction-success":
      return {
        text: t("chat.compacted"),
        toneClass: "text-muted-foreground",
        isRunning: false,
      };
    case "compaction-failed":
      return {
        text: t("chat.compactFailed"),
        toneClass: "text-muted-foreground",
        isRunning: false,
      };
    case "compaction-aborted":
      return {
        text: t("chat.compactAborted"),
        toneClass: "text-muted-foreground",
        isRunning: false,
      };
    default:
      // goal-*（目标段在输入框上方）/ background-agent（子代理 chip 承载）
      return null;
  }
}

export interface ChatTaskDockProps {
  status: ChatInputStatus;
  /** = ChatView 的 canStop：与停止按钮同源，保证"还能按停止"时坞一定在。 */
  running: boolean;
  executionClock?: SessionExecutionClock;
  currentTodos?: CurrentTodos | null;
  currentPlanDone?: boolean;
  lastNonEmptyTodos?: CurrentTodos | null;
  lastPlanDone?: boolean;
}

export function ChatTaskDock({
  status,
  running,
  executionClock,
  currentTodos,
  currentPlanDone,
  lastNonEmptyTodos,
  lastPlanDone,
}: ChatTaskDockProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const lingering =
    executionClock !== undefined && isLingering(executionClock, now);

  // 只在"运行中"或"还在收尾窗口内"的时候走表：窗口一到期就停，坞随之收起。
  const ticking = running || lingering;
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [ticking]);

  const display = useMemo(
    () =>
      derivePlanDisplay({
        currentTodos,
        currentPlanDone,
        lastNonEmptyTodos,
        lastPlanDone,
      }),
    [currentTodos, currentPlanDone, lastNonEmptyTodos, lastPlanDone],
  );
  const action = resolveDockAction(status, t);

  // 回合秒表：运行中走实时，收尾窗口内冻结在 endAt。
  const elapsed = (() => {
    if (!executionClock || executionClock.startAt === null) return null;
    if (isTurnClockLive(status, executionClock)) {
      return { live: true, seconds: (now - executionClock.startAt) / 1000 };
    }
    const { endAt } = executionClock;
    if (endAt !== null && lingering) {
      return { live: false, seconds: (endAt - executionClock.startAt) / 1000 };
    }
    return null;
  })();

  const hasPlan = display.todos.length > 0;
  // 动作行只要还有东西可说就渲染：动作文案，或回合结束后 5s 内那格冻结的耗时
  // （旧状态栏的既有保证 —— 状态解析成 null 之后仍要看得到本轮花了多久）。
  // ⚠️ 冻结耗时只在状态**确实解析成 null** 时单独成行：目标长跑的耗时归输入框上方
  // 的目标段，坞里再挂一只裸秒表就是同一件事说两遍。
  const showActionRow =
    action !== null || (status === null && elapsed !== null);
  // 显隐先收口，"有没有东西可显示"再收口：两者都为假时不留空壳。
  if (!running && !lingering) return null;
  if (!hasPlan && !showActionRow) return null;

  const slotToken = formatDurationShort(TURN_CLOCK_SLOT_SENTINEL_SECONDS);

  return (
    <div data-testid="chat-task-dock" className="mt-auto pt-4">
      {hasPlan ? <TaskCard display={display} /> : null}
      {showActionRow ? (
        <div
          className={`flex items-center gap-1.5 pr-1 text-xs ${
            hasPlan ? "mt-2" : ""
          }`}
        >
          <style>{gradientStyles}</style>
          {action?.isRunning ? <StatusGlyph /> : null}
          {action?.text ? (
            <span
              className={`min-w-0 truncate ${action.toneClass} ${
                action.isRunning ? "gradient-text" : ""
              }`}
            >
              {action.text}
            </span>
          ) : null}
          {elapsed ? (
            <span className="flex-none text-muted-foreground">
              {action?.text ? "· " : ""}
              {/* 槽位：两格叠在同一个 grid 单元格，盒宽取两者最大值 ——
                  正常时长下 = 哨兵宽度（恒定），于是行内零位移。做法与取值同
                  ChatInputStatusBar（design-docs/2026-09-29-turn-timer-width-stability-design.md）。 */}
              <span className="inline-grid tabular-nums">
                <span
                  aria-hidden="true"
                  data-testid="turn-elapsed-slot"
                  className="invisible col-start-1 row-start-1"
                >
                  {t("chat.elapsedRunning", { time: slotToken })}
                </span>
                <span
                  data-testid="turn-elapsed-visible"
                  className="col-start-1 row-start-1"
                >
                  {t(
                    elapsed.live ? "chat.elapsedRunning" : "chat.elapsedDone",
                    {
                      time: formatDurationShort(elapsed.seconds),
                    },
                  )}
                </span>
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
