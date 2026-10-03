import { memo, useEffect, useRef, useState } from "react";
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
  Target,
  Wrench,
  Folder,
  ListTodo,
} from "lucide-react";
import type { Message, ContentBlock } from "../../types";
import {
  getProcessSummaryFragments,
  type DisplayBlock,
  type ProcessSummaryFragment,
} from "../../utils/tool-display-blocks";
import { ToolUseBlock } from "./ToolUseBlock";
import { NestedToolDetails } from "./NestedToolDetails";
import { ToolGroupStatus } from "./ToolGroupStatus";
import { useAppStore } from "../../store";

const PROCESS_ICON_MAP: Record<
  ProcessSummaryFragment["iconType"],
  React.ReactNode
> = {
  read: <BookOpen className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  filebrowse: <Folder className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  search: <Search className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  websearch: <Globe className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  browse: <Globe className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  memory: <Brain className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  command: (
    <MonitorPlay className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
  ),
  subagent: <Bot className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  tool: <Wrench className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  goal: <Target className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
  tasklist: <ListTodo className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />,
};

interface ProcessSummaryBlockProps {
  block: Extract<DisplayBlock, { type: "process-summary" }>;
  allBlocks?: ContentBlock[];
  message?: Message;
}

export const ProcessSummaryBlock = memo(function ProcessSummaryBlock({
  block,
  allBlocks,
  message,
}: ProcessSummaryBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const fragments = getProcessSummaryFragments(block.summary, t, block.status);
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

  const handleFailure = () => {
    setExpanded(true);
    if (failedToolCallId) {
      useAppStore.getState().highlightToolCallId(failedToolCallId);
    }
  };

  const scriptIds = new Set((block.scripts ?? []).map((script) => script.id));
  const visibleItems = block.items.filter((item) => !scriptIds.has(item.id));

  const highlighted = containsToolCall(highlightedToolCallId);

  return (
    <div className="overflow-hidden">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className={`group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left text-sm leading-[var(--line-height-chat)] text-text-muted transition-colors hover:bg-surface-hover/40 ${
            highlighted ? "ring-2 ring-accent/40" : ""
          }`}
        >
          <span className="flex items-center gap-1.5 min-w-0 overflow-hidden flex-nowrap">
            {fragments.map((frag, fi) => (
              <span
                key={fi}
                className={`inline-flex items-center gap-1 min-w-0 whitespace-nowrap${frag.iconType !== "subagent" ? " flex-shrink-0" : ""}`}
              >
                {fi > 0 && fi < fragments.length - 1 && (
                  <span className="text-text-muted">
                    {t("tool.grouped.joinComma")}
                  </span>
                )}
                {fi > 0 && fi === fragments.length - 1 && (
                  <span className="text-text-muted">
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
          <span className="inline-flex w-3.5 flex-shrink-0 items-center justify-center text-text-muted">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        </button>
        <ToolGroupStatus status={block.status} onFailure={handleFailure} />
      </div>

      {expanded ? (
        <div className="mt-1 max-h-[400px] overflow-y-auto [scrollbar-gutter:stable] pl-5 space-y-1">
          {block.scripts?.map((script) => (
            <div
              key={script.id}
              ref={failedToolCallId === script.id ? failedItemRef : null}
            >
              <details>
                <summary className="cursor-pointer text-xs text-text-muted">
                  {t("tool.grouped.scriptDetails")}
                </summary>
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
              </details>
            </div>
          ))}
          {visibleItems.map((item) => (
            <div
              key={item.id}
              ref={failedToolCallId === item.id ? failedItemRef : null}
            >
              {item.trace ? (
                <NestedToolDetails
                  item={item}
                  allBlocks={allBlocks}
                  message={message}
                />
              ) : (
                <ToolUseBlock
                  block={item}
                  allBlocks={allBlocks}
                  message={message}
                  showIcon={false}
                />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});
