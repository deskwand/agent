import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  BookOpen,
  Search,
  Globe,
  MonitorPlay,
  Bot,
  Brain,
  Lightbulb,
  Target,
  Wrench,
  Folder,
  Volume2,
  AlarmClock,
  Users,
} from "lucide-react";
import type { Message, ContentBlock } from "../../types";
import {
  getProcessSummaryFragments,
  formatFailureSuffix,
  type DisplayBlock,
  type ProcessSummaryFragment,
} from "../../utils/tool-display-blocks";
import { ToolUseBlock } from "./ToolUseBlock";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { ToolStepRow } from "./ToolStepRow";
import { getCodemodeScriptLabel } from "../../utils/codemode-script-label";
import { OutputClamp } from "./OutputClamp";
import { useAppStore } from "../../store";
import { Button } from "../app-button";

const PROCESS_ICON_MAP: Record<
  ProcessSummaryFragment["iconType"],
  React.ReactNode
> = {
  read: (
    <BookOpen className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
  ),
  filebrowse: (
    <Folder className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
  ),
  search: (
    <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
  ),
  websearch: (
    <Globe className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
  ),
  browse: <Globe className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />,
  memory: <Brain className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />,
  ideas: (
    <Lightbulb className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
  ),
  peers: <Users className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />,
  wakeup: (
    <AlarmClock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
  ),
  command: (
    <MonitorPlay className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
  ),
  subagent: <Bot className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />,
  tool: <Wrench className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />,
  goal: <Target className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />,
  tts: <Volume2 className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />,
};

interface ProcessSummaryBlockProps {
  block: Extract<DisplayBlock, { type: "process-summary" }>;
  allBlocks?: ContentBlock[];
  message?: Message;
  /**
   * 触发器行末的附加内容（渲染在 chevron 之后、按钮内部）。
   * 任务坞用它放「已运行 5m03s」：这一列原来占在按钮外面，展开后整列都是空的。
   */
  trailing?: React.ReactNode;
  /**
   * 紧凑头部：触发器与片段按内容宽排（箭头、耗时紧贴文案），右侧留白。
   * 只在坞里开 —— 转录里的摘要行必须保持整行可点、hover 满宽。
   */
  compactHeader?: boolean;
  /**
   * 覆盖触发器文案：给了就只显示它，不再渲染聚合片段。
   * 只由任务坞传（坞头只说"此刻在做什么"）；转录仍走聚合片段。
   */
  triggerLabel?: { text: string; mono: boolean };
}

export const ProcessSummaryBlock = memo(function ProcessSummaryBlock({
  block,
  allBlocks,
  message,
  trailing,
  compactHeader = false,
  triggerLabel,
}: ProcessSummaryBlockProps) {
  const { t } = useTranslation();
  const labelRef = useLabelSpring(
    triggerLabel?.text ?? null,
    triggerLabel !== undefined,
  );
  const failureSuffix = formatFailureSuffix(block.status?.failedCount ?? 0, t);
  const [expanded, setExpanded] = useState(false);
  // 给了 triggerLabel 就不算聚合片段：省掉这趟调用，也不会残留旧文案。
  const fragments = triggerLabel
    ? []
    : getProcessSummaryFragments(block.summary, t, block.status);
  const failedToolCallId = block.status?.firstFailedToolCallId;
  const failedItemRef = useRef<HTMLDivElement | null>(null);

  const highlightedToolCallId = useAppStore((s) => s.highlightedToolCallId);
  const pendingExpandToolCallId = useAppStore((s) => s.pendingExpandToolCallId);
  const clearPendingExpandToolCallId = useAppStore(
    (s) => s.clearPendingExpandToolCallId,
  );

  // 父脚本 ID 也参与匹配：失败/跳转目标可能是被投影掉的 codemode 外层调用。
  const containsToolCall = (toolCallId: string | null) =>
    toolCallId != null &&
    (block.items.some((item) => item.id === toolCallId) ||
      (block.scripts ?? []).some((script) => script.id === toolCallId));

  // 跳转过来时展开这条摘要，并且只消费一次：不清掉的话，之后任何重渲染都会
  // 把它重新展开，和用户手动收起打架。
  useEffect(() => {
    if (pendingExpandToolCallId == null) return;
    // 就地判断（而不是调 containsToolCall）：函数引用放进依赖数组会触发
    // exhaustive-deps 告警，而这里只需要这一个条件。
    if (
      !block.items.some((item) => item.id === pendingExpandToolCallId) &&
      !(block.scripts ?? []).some(
        (script) => script.id === pendingExpandToolCallId,
      )
    )
      return;
    setExpanded(true);
    clearPendingExpandToolCallId();
  }, [
    pendingExpandToolCallId,
    clearPendingExpandToolCallId,
    block.items,
    block.scripts,
  ]);

  // 展开后把首个失败条目滚进视野。jsdom 里没有 scrollIntoView，先判存在。
  useEffect(() => {
    if (!expanded || failedToolCallId == null) return;
    const element = failedItemRef.current;
    if (typeof element?.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [expanded, failedToolCallId]);

  const scriptIds = new Set((block.scripts ?? []).map((script) => script.id));
  const visibleItems = block.items.filter((item) => !scriptIds.has(item.id));

  // 每个脚本调了几次子工具：没有意图注释时用它区分多个脚本。
  // ⚠️ 零子调用时 nested-tool-display 会把父块自己推回来（id === parentToolCallId，
  // source:"missing"），那不是一次子调用 —— 数进来会让历史会话里每个脚本都显示
  // 「脚本 · 1 步」，正是这次要消灭的「行行一样」。
  const scriptStepCounts = new Map<string, number>();
  for (const item of block.items) {
    const parentId = item.trace?.parentToolCallId;
    if (!parentId || parentId === item.id) continue;
    scriptStepCounts.set(parentId, (scriptStepCounts.get(parentId) ?? 0) + 1);
  }

  const highlighted = containsToolCall(highlightedToolCallId);

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="overflow-hidden"
    >
      <div className="flex items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            type="button"
            className={`group flex min-w-0 items-center gap-2 rounded-lg px-1 text-left text-sm leading-[var(--line-height-chat)] text-muted-foreground transition-colors hover:bg-hover-surface ${
              compactHeader ? "" : "flex-1"
            } ${highlighted ? "ring-2 ring-primary/40" : ""}`}
          >
            <span
              className={`flex items-center gap-1.5 min-w-0 overflow-hidden flex-nowrap ${
                compactHeader ? "" : "flex-1"
              }`}
            >
              {triggerLabel ? (
                /* 这一行只有它可以被压缩，右边的箭头 / 耗时 / 速度都锁死。
                   ⚠️ 它必须是**非 flex** 的块级子项，`textOverflow` 才出省略号。 */
                <span
                  ref={labelRef}
                  data-testid="summary-trigger-label"
                  title={triggerLabel.text}
                  className={`origin-left min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${
                    triggerLabel.mono ? "font-mono" : ""
                  }`}
                >
                  {triggerLabel.text}
                </span>
              ) : null}
              {fragments.map((frag, fi) => (
                <span
                  key={fi}
                  className={`inline-flex items-center gap-1 min-w-0 whitespace-nowrap${frag.iconType !== "subagent" ? " flex-shrink-0" : ""}`}
                >
                  {fi > 0 && fi < fragments.length - 1 && (
                    <span className="text-muted-foreground">
                      {t("tool.grouped.joinComma")}
                    </span>
                  )}
                  {fi > 0 && fi === fragments.length - 1 && (
                    <span className="text-muted-foreground">
                      {" "}
                      {t("tool.grouped.joinAnd")}{" "}
                    </span>
                  )}
                  {PROCESS_ICON_MAP[frag.iconType]}
                  <span className="truncate" title={frag.text}>
                    {frag.text}
                  </span>
                </span>
              ))}
            </span>
            {failureSuffix ? (
              <span
                data-tool-group-failure-count
                className="shrink-0 whitespace-nowrap text-destructive"
              >
                {failureSuffix}
              </span>
            ) : null}
            <span className="inline-flex w-3.5 flex-shrink-0 items-center justify-center text-muted-foreground">
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </span>
            {trailing}
          </Button>
        </CollapsibleTrigger>
      </div>

      {expanded && (
        <CollapsibleContent className="mt-1 [scrollbar-gutter:stable]">
          <OutputClamp maxHeight={400}>
            <div
              data-tool-group-card
              className="overflow-hidden rounded-xl border border-border bg-card/20 [&>*+*]:border-t [&>*+*]:border-border/60"
            >
              {block.scripts?.map((script) => (
                <div
                  key={script.id}
                  ref={failedToolCallId === script.id ? failedItemRef : null}
                >
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        type="button"
                        data-script-row
                        className="group/script flex h-auto w-full items-center gap-2 px-4 py-2 text-left text-sm font-normal text-muted-foreground hover:bg-hover-surface hover:text-current [&_svg]:size-3.5"
                      >
                        <span className="min-w-0 truncate">
                          {getCodemodeScriptLabel(
                            script.input.code,
                            scriptStepCounts.get(script.id) ?? 0,
                            t,
                          )}
                        </span>
                        {/* 空占位在箭头**之前**：箭头因此贴在行右缘，与 ToolStepRow 同位置 */}
                        <span className="flex-1" />
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform group-data-[state=open]/script:rotate-90" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {/* 与 ToolStepRow 的 data-step-body 同款：内嵌块和标签左缘对齐 */}
                      <div className="px-4 pb-3">
                        <div
                          data-script-detail
                          className="overflow-hidden rounded-lg border border-border/60 bg-background/70 p-3"
                        >
                          <ToolUseBlock
                            block={{
                              type: "tool_use",
                              id: script.id,
                              name: "codemode",
                              input: script.input,
                            }}
                            allBlocks={allBlocks}
                            message={message}
                            showIcon={false}
                          />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              ))}
              {visibleItems.map((item) => (
                <div
                  key={item.id}
                  data-tool-step
                  ref={failedToolCallId === item.id ? failedItemRef : null}
                >
                  <ToolStepRow
                    item={item}
                    allBlocks={allBlocks}
                    message={message}
                    highlighted={highlightedToolCallId === item.id}
                  />
                </div>
              ))}
            </div>
          </OutputClamp>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

const LABEL_SPRING_MS = 320;
/** 过冲 ~10%：98px 的位移约 9px，几 px 的小切换只有 3~4px（效果图实测）。 */
const LABEL_SPRING_EASING = "cubic-bezier(.34, 1.56, .64, 1)";
const LABEL_STRETCH_MS = 300;
const LABEL_STRETCH_EASING = "cubic-bezier(.34, 1.4, .64, 1)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function isReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

/**
 * 坞头文案切换的弹簧：宽度从"上一次切换后的宽度"弹到新文案的自然宽度。
 *
 * 用 WAAPI 而不是 CSS transition —— 起止都是 px 值，动画结束后元素自然回到
 * `auto`，不留内联样式，也不需要 transitionend 清理（与 sidebar-disclosure-motion
 * 同款写法）。量宽度依赖真实布局，jsdom 里靠测试 stub 提供读数。
 *
 * 依赖只放原始值：坞每 500ms 心跳重渲染，effect 一旦依赖对象就会被反复触发。
 */
function useLabelSpring(
  text: string | null,
  enabled: boolean,
): React.RefObject<HTMLSpanElement> {
  const ref = useRef<HTMLSpanElement | null>(null);
  /** 上一次切换后量到的自然宽度（= 下一次的起点）。null = 还没有可信起点。 */
  const previousWidthRef = useRef<number | null>(null);
  /** 上一个挂 ref 的元素：换了元素说明标签重新挂载过，旧宽度不能当起点。 */
  const lastElementRef = useRef<HTMLSpanElement | null>(null);
  const widthAnimationRef = useRef<Animation | null>(null);
  const stretchAnimationRef = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 标签重新挂载（坞头先回落成动作态、随后又出现新步骤）：上一个元素的宽度
    // 不能当起点，否则新标签会"从上一段的宽度弹进来"。
    if (lastElementRef.current !== el) {
      lastElementRef.current = el;
      previousWidthRef.current = null;
    }

    // 上一条还在跑时，用户眼前是动画中途的宽度而不是上一句的终点：以它作起点，
    // A→B→C 连续快切才不会被硬拽回 B 的终点。
    // ⚠️ 用 offsetWidth 而不是 getBoundingClientRect —— 后者含 transform，
    // 会被同时跑着的拉伸动画缩小 3% 左右，起点就偏了。
    const liveWidth =
      widthAnimationRef.current?.playState === "running"
        ? el.offsetWidth
        : null;
    widthAnimationRef.current?.cancel();
    widthAnimationRef.current = null;

    const to = el.offsetWidth;
    const from = liveWidth ?? previousWidthRef.current;
    previousWidthRef.current = to;

    // 保留：坞不给 triggerLabel 时不动（当前 wiring 下 span 不渲染，上面已提前返回）。
    if (!enabled) return;
    // 整数 px 比较：1px 以内不值得弹一下
    if (from === null || Math.abs(to - from) < 1) return;
    if (isReducedMotion()) return;
    if (typeof el.animate !== "function") return;

    widthAnimationRef.current = el.animate(
      [{ width: `${from}px` }, { width: `${to}px` }],
      { duration: LABEL_SPRING_MS, easing: LABEL_SPRING_EASING },
    );

    // 拉伸还在跑就让它跑完：重开会把 1.015 硬拽回 .965，一帧内挤出 5%
    if (stretchAnimationRef.current?.playState !== "running") {
      stretchAnimationRef.current = el.animate(
        [
          { transform: "scaleX(.965) scaleY(1.03)" },
          { transform: "scaleX(1.015) scaleY(.99)", offset: 0.55 },
          { transform: "scaleX(1) scaleY(1)" },
        ],
        { duration: LABEL_STRETCH_MS, easing: LABEL_STRETCH_EASING },
      );
    }
  }, [text, enabled]);

  // 唯一的一处卸载清理：主 effect 故意不带 cleanup —— 它的 cleanup 会在每次
  // 文案变化之前就跑，把正要接管的那条动画取消掉。
  useLayoutEffect(() => {
    return () => {
      widthAnimationRef.current?.cancel();
      stretchAnimationRef.current?.cancel();
      widthAnimationRef.current = null;
      stretchAnimationRef.current = null;
    };
  }, []);

  return ref;
}
