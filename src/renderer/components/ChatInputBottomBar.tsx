import { useTranslation } from "react-i18next";
import type { ProviderProfileKey } from "../types";
import { CornerDownLeft, Square } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import { Button } from "./app-button";
import { VoiceMicButton, type VoiceMicButtonProps } from "./VoiceMicButton";

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

/** 卡内右簇：发送 / 停止、麦克风。编辑区自行长高，不设展开按钮。 */
export interface ChatInputBottomBarProps {
  canStop: boolean;
  onStop: () => void;
  isSubmitting: boolean;
  submitDisabled?: boolean;
  /**
   * 草稿是否非空（来自 ChatInput 的 onContentChange）。
   * 必填：漏接线要变成编译错误，而不是静默不显示按钮。
   */
  hasInputContent: boolean;
  /**
   * 语音输入的全部状态与动作，原样透传给 `VoiceMicButton`。
   *
   * 必填：漏接线要变成编译错误，而不是静默不显示麦克风
   * （与 `hasInputContent` 同一套约定）。
   */
  voice: VoiceMicButtonProps;
}

export function ChatInputBottomBar({
  canStop,
  onStop,
  isSubmitting,
  submitDisabled = false,
  hasInputContent,
  voice,
}: ChatInputBottomBarProps) {
  const { t } = useTranslation();

  const submitLabel = canStop ? t("chat.stop") : t("chat.sendMessage");

  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            type={canStop ? "button" : "submit"}
            onClick={canStop ? onStop : undefined}
            disabled={!canStop && (isSubmitting || submitDisabled)}
            aria-label={submitLabel}
            className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors ${
              canStop
                ? "bg-primary text-background hover:bg-primary/90"
                : `text-foreground hover:bg-hover-surface disabled:opacity-50 disabled:cursor-not-allowed ${hasInputContent ? "" : "invisible"}`
            }`}
          >
            {canStop ? (
              <Square className="w-4 h-4" />
            ) : (
              <CornerDownLeft className="w-4 h-4" />
            )}
          </Button>
        </TooltipTrigger>
        {/* asChild 下 child 的 type="submit" 胜出（Slot 的 child props 覆盖默认的
            type="button"），且 Trigger 的 onClick 只做 onClose、不 preventDefault ——
            回车提交表单的路径不受影响。 */}
        <TooltipContent side="bottom">{submitLabel}</TooltipContent>
      </Tooltip>
      <VoiceMicButton {...voice} />
    </div>
  );
}
