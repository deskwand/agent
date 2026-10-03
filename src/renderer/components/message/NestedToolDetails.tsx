import { useTranslation } from "react-i18next";
import type {
  ContentBlock,
  Message,
  ToolResultContent,
  ToolUseContent,
} from "../../types";
import { ToolUseBlock } from "./ToolUseBlock";

interface NestedToolDetailsProps {
  item: ToolUseContent;
  allBlocks?: ContentBlock[];
  message?: Message;
}

/**
 * codemode 子调用详情。有真实输出且状态明确时交给既有工具卡；
 * 缺输出 / unfinished 时自己渲染，避免既有卡片把合成空结果当成成功。
 */
export function NestedToolDetails({
  item,
  allBlocks,
  message,
}: NestedToolDetailsProps) {
  const { t } = useTranslation();
  const trace = item.trace;
  if (!trace) {
    return (
      <ToolUseBlock
        block={item}
        allBlocks={allBlocks}
        message={message}
        showIcon={false}
      />
    );
  }

  const result = allBlocks?.find(
    (block): block is ToolResultContent =>
      block.type === "tool_result" && block.toolUseId === item.id,
  );
  const unavailable = result?.outputUnavailable === true;
  const needsOwnDetails = unavailable || trace.status === "unfinished";

  return (
    <div className="space-y-1">
      <span className="text-xs text-text-muted">
        {t("tool.grouped.scriptOwner", { id: trace.parentToolCallId })}
      </span>
      {needsOwnDetails ? (
        <details>
          <summary
            className={
              trace.status === "error" ? "text-error" : "text-text-muted"
            }
          >
            {item.name} ·{" "}
            {trace.cancelled
              ? t("tool.grouped.cancelledOperation")
              : trace.status === "unfinished"
                ? t("tool.grouped.unfinishedOperations")
                : trace.status === "error"
                  ? t("tool.grouped.failedOperations")
                  : t("tool.grouped.outputUnavailable")}
          </summary>
          {Object.keys(item.input).length > 0 && (
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-surface-muted p-2.5 text-xs font-mono text-text-secondary">
              {JSON.stringify(item.input, null, 2)}
            </pre>
          )}
          {trace.argumentsBytes !== undefined && (
            <p className="text-xs text-text-muted">
              {t("tool.grouped.argumentsOmitted")}
            </p>
          )}
          {unavailable && trace.status !== "ok" && (
            <p className="text-xs text-text-muted">
              {t("tool.grouped.outputUnavailable")}
            </p>
          )}
          {result?.content && (
            <pre
              className={`whitespace-pre-wrap break-all rounded-lg bg-surface-muted p-2.5 text-xs font-mono ${trace.status === "error" ? "text-error" : "text-text-secondary"}`}
            >
              {result.content}
            </pre>
          )}
        </details>
      ) : (
        <ToolUseBlock
          block={item}
          allBlocks={allBlocks}
          message={message}
          showIcon={false}
        />
      )}
    </div>
  );
}
