import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ToolGroupStatusUi } from "../../utils/tool-display-blocks";

interface ToolGroupStatusProps {
  status?: ToolGroupStatusUi;
  onFailure: () => void;
}

/**
 * 摘要行右侧的状态提示：折叠时也能看见失败/未完成/明细缺失。
 * 刻意放在摘要 button 之外的同一 flex 行里，避免 button 嵌套 button。
 */
export function ToolGroupStatus({ status, onFailure }: ToolGroupStatusProps) {
  const { t } = useTranslation();
  if (!status) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs">
      {status.running && (
        <Loader2
          aria-label={t("tool.grouped.runningScript")}
          className="h-3.5 w-3.5 animate-spin"
        />
      )}
      {status.failed && (
        <button
          type="button"
          data-tool-group-failure
          className="text-error"
          onClick={onFailure}
        >
          {t("tool.grouped.failedOperations")}
        </button>
      )}
      {status.unfinished && (
        <span className="text-text-muted">
          {t("tool.grouped.unfinishedOperations")}
        </span>
      )}
      {status.incomplete && (
        <span className="text-text-muted">
          {t("tool.grouped.partialDetails")}
        </span>
      )}
      {status.unavailable && (
        <span className="text-text-muted">
          {t("tool.grouped.detailsUnavailable")}
        </span>
      )}
    </span>
  );
}
