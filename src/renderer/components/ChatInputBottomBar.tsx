import { useTranslation } from "react-i18next";
import type { ProviderProfileKey } from "../types";
import { CornerDownLeft } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import { Button } from "./app-button";
import { VoiceMicButton, type VoiceMicButtonProps } from "./VoiceMicButton";
import { StopGlyph } from "./stop-glyph";

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
 * 卡内右簇：发送 / 停止、麦克风。编辑区自行长高，不设展开按钮。
 *
 * 停止态与发送态共用同一副骨骼：36px 圆形热区、无底色，只在 hover 时显形。
 * 停止只靠「实心圆角方块」这个字形表达，不再套一层 `bg-primary` 实心圆 —— 圆底 + 方块
 * 叠成两层实心，是输入卡里最亮的一块，与旁边的麦克风差了两级视觉重量。
 *
 * 字形本身在 `stop-glyph.tsx`：与麦克风那格的录音停止键**同一枚**。
 * 尺寸 12px 而不是 16px：实心块与描边图标同外框时，实心那块永远读着更大 ——
 * 16px 实心是 256 px² 墨量，旁边的 16px `Mic` 只有 55 px²（4.7 倍）；收到 12px 后
 * 是 136，读起来才是一档。尺寸只能写在 Button 上（`[&_svg]:size-3`），写在 svg 上
 * 会被 base 的 `[&_svg]:size-4` 顶回 16px —— 这也是它以前看着偏大的真因。
 */
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
            className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors text-foreground hover:bg-hover-surface ${
              canStop
                ? // 字形的尺寸只在这一行：`.w-3` 这类单类名赢不过 base 的
                  // `[&_svg]:size-4`，必须用同一档选择器（见 stop-glyph.tsx）。
                  "[&_svg]:size-3"
                : `disabled:opacity-50 disabled:cursor-not-allowed ${hasInputContent ? "" : "invisible"}`
            }`}
          >
            {canStop ? <StopGlyph /> : <CornerDownLeft className="w-4 h-4" />}
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
