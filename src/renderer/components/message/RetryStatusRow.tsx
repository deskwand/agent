// 重试中的临时状态行 —— 成功即卸载，不落进消息历史
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

interface RetryStatusRowProps {
  /** 本回合内的第几次重试，直接来自 SDK 的 auto_retry_start.attempt */
  attempt: number;
}

export function RetryStatusRow({ attempt }: RetryStatusRowProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2.5 py-1">
      <Loader2
        aria-hidden="true"
        className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-accent"
      />
      <span className="text-[13px] text-text-primary">
        {t("messageCard.retrying")}
      </span>
      <span className="font-mono text-[11.5px] text-text-muted">
        {t("messageCard.retryAttempt", { count: attempt })}
      </span>
    </div>
  );
}
