/**
 * 工具组里的一行调用：行头一行话（标签 + 摘要 + 状态），点开在容器内原地铺详情。
 *
 * 详情不在这里重写 —— 交给既有工具卡的 `detailOnly` 模式，终端块 / diff /
 * 子代理步骤各用自己那份渲染。效果图见
 * design-docs/2026-11-06-tool-step-rows-sketch-v2.html。
 */
import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Loader2 } from "lucide-react";
import type { ContentBlock, Message, ToolUseContent } from "../../types";
import {
  findToolResult,
  formatCollapsedToolSummary,
  getCollapsedToolSummary,
} from "../../utils/tool-result-summary";
import { getToolStepLabel } from "../../utils/tool-step-label";
import { useAppStore } from "../../store";
import { ToolUseBlock } from "./ToolUseBlock";
import { NestedToolDetails } from "./NestedToolDetails";

interface ToolStepRowProps {
  item: ToolUseContent;
  allBlocks?: ContentBlock[];
  message?: Message;
  highlighted?: boolean;
}

export const ToolStepRow = memo(function ToolStepRow({
  item,
  allBlocks,
  message,
  highlighted = false,
}: ToolStepRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // 高亮来自活动面板 / 后台代理列表的跳转：跳到这一行就把这一行摊开。
  useEffect(() => {
    if (highlighted) setOpen(true);
  }, [highlighted]);

  const activeTurn = useAppStore((s) =>
    message?.sessionId
      ? (s.sessionStates[message.sessionId]?.activeTurn ?? null)
      : null,
  );
  const allMessages = useAppStore((s) =>
    message?.sessionId
      ? (s.sessionStates[message.sessionId]?.messages ?? [])
      : [],
  );

  const traceStatus = item.trace?.status;
  const result = findToolResult(item.id, allBlocks, allMessages);
  const isError = traceStatus === "error" || result?.isError === true;
  const isRunning =
    !isError && (traceStatus === "running" || (!result && Boolean(activeTurn)));
  // 与 NestedToolDetails 的 needsOwnDetails 同口径：这类调用没有可信结果，
  // 行头必须说出来，否则一条「干净」的行就是在冒充成功。
  const unavailableText = isError
    ? ""
    : item.trace?.cancelled === true
      ? t("tool.grouped.cancelledOperation")
      : traceStatus === "unfinished"
        ? t("tool.grouped.unfinishedOperations")
        : result?.outputUnavailable === true || item.trace?.source === "missing"
          ? t("tool.step.statusUnavailable")
          : "";
  const isUnavailable = !isRunning && unavailableText !== "";

  const label = getToolStepLabel(item.name, item.input, t);
  const summaryText = formatCollapsedToolSummary(
    getCollapsedToolSummary(
      item.name,
      result?.content,
      result?.isError === true,
      Boolean(result),
      result?.diff,
    ),
    t,
  );
  // 结果和虚拟 trace 都没有时是「还不知道」，不是「读了多少行」——不显示摘要。
  const statusKnown = Boolean(item.trace) || Boolean(result);
  const metaText =
    !statusKnown || isRunning ? "" : summaryText || unavailableText;

  return (
    <div className={highlighted ? "ring-2 ring-inset ring-primary/40" : ""}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-hover-surface focus-visible:bg-hover-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/60"
      >
        {isError ? (
          <span
            data-step-status="error"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
          />
        ) : isRunning ? (
          <span data-step-status="running" className="shrink-0">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          </span>
        ) : isUnavailable ? (
          <span
            data-step-status="unavailable"
            className="shrink-0 text-[10px] leading-none text-muted-foreground/60"
          >
            •
          </span>
        ) : null}
        <span
          data-step-label
          className={`min-w-0 truncate text-muted-foreground ${
            label.mono ? "font-mono" : ""
          }`}
        >
          {label.text}
        </span>
        {metaText ? (
          <span
            data-step-meta
            className={`min-w-0 max-w-[50%] truncate ${
              isError ? "text-destructive" : "text-muted-foreground/60"
            }`}
          >
            · {metaText}
          </span>
        ) : null}
        {/* 占位在箭头**之前**：箭头因此贴在行末（参考图的行右缘），
            而不是紧跟文字、后面留一段空白。 */}
        <span className="flex-1" />
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:text-muted-foreground ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>

      {open && (
        // 详情与行标签左缘对齐（不再 pl-9 深缩进），并用一层内嵌块跟行头区分层级：
        // 层级提示从"缩进"改成"底色 + 描边"，命令/输出本身仍由各自的工具卡渲染。
        <div data-step-body className="px-4 pb-3">
          <div
            data-step-detail
            className="overflow-hidden rounded-lg border border-border/60 bg-background/70 p-3"
          >
            {item.trace ? (
              <NestedToolDetails
                item={item}
                allBlocks={allBlocks}
                message={message}
                detailOnly
              />
            ) : (
              <ToolUseBlock
                block={item}
                allBlocks={allBlocks}
                message={message}
                showIcon={false}
                detailOnly
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
});
