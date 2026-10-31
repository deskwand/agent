import { useTranslation } from "react-i18next";
import type { ProviderProfileKey } from "../types";
import { ArrowUp, Square } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import { Button } from "./app-button";

export interface ModelOptionGroup {
  profileKey: ProviderProfileKey;
  groupLabel: string;
  items: Array<{ id: string; name: string }>;
}

/** 面板里「上下文」块的展示文本。格式化（含估算态「约」）在 ChatView 里完成。 */
export interface ContextStatusDetails {
  usedLabel: string;
  totalLabel: string;
  cacheHitRate: string;
  /**
   * 生成速度标签（"38 tok/s" / "约 42 tok/s"）。
   * 缺省 = 本宿主没有该数据（欢迎页）或不显示。
   */
  tokenSpeedLabel?: string;
}

/**
 * 输入卡内的发送键（右端）。
 *
 * 左簇（附件 / 展开 / 麦克风）在 `ChatInputActionBar`：两者分别落在编辑器左右两侧，
 * 由 `ChatInput` 的同一条 flex 行排布。
 */
export interface ChatInputBottomBarProps {
  canStop: boolean;
  onStop: () => void;
  isSubmitting: boolean;
  submitDisabled?: boolean;
}

export function ChatInputBottomBar({
  canStop,
  onStop,
  isSubmitting,
  submitDisabled = false,
}: ChatInputBottomBarProps) {
  const { t } = useTranslation();

  const submitLabel = canStop ? t("chat.stop") : t("chat.sendMessage");

  return (
    <div className="flex shrink-0 items-center justify-end">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            type={canStop ? "button" : "submit"}
            onClick={canStop ? onStop : undefined}
            disabled={!canStop && (isSubmitting || submitDisabled)}
            aria-label={submitLabel}
            className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-all duration-150 ${
              canStop
                ? "bg-primary text-background hover:bg-primary/90"
                : "bg-primary text-background disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 active:scale-95 active:translate-y-px"
            }`}
          >
            {canStop ? (
              <Square className="w-4 h-4" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </Button>
        </TooltipTrigger>
        {/* asChild 下 child 的 type="submit" 胜出（Slot 的 child props 覆盖默认的
            type="button"），且 Trigger 的 onClick 只做 onClose、不 preventDefault ——
            回车提交表单的路径不受影响。 */}
        <TooltipContent side="bottom">{submitLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}
