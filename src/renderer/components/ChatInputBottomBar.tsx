import { useTranslation } from "react-i18next";
import type { ProviderProfileKey } from "../types";
import { ArrowUp, Maximize2, Minimize2, Square } from "lucide-react";
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

/**
 * 输入卡内的右簇：展开 + 麦克风 + 发送。
 *
 * 左簇（仅附件）在 `ChatInputActionBar`：两者分别落在编辑器左右两侧，
 * 由 `ChatInput` 的同一条 flex 行排布。
 *
 * 麦克风恒定 36×36（`MIC_SLOT_CLASS`，六态都不改宽），放进右簇不会推挤编辑器；
 * 它从前在左簇，等于让每行草稿先缩进 38px 才写到字。
 *
 * 展开按钮为什么在这里、且为什么常驻一个隐形槽位：它是按「有没有内容」出现的。
 * 夹在左簇里会把编辑器左边缘右推 38px，而那正是用户敲下第一个字的时刻；
 * 放到发送键左边之后它只影响编辑器右边界，再把槽位改成常驻（`invisible`），连那点
 * 都不变 —— 打字时画面完全静止。
 */
export interface ChatInputBottomBarProps {
  canStop: boolean;
  onStop: () => void;
  isSubmitting: boolean;
  submitDisabled?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
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
  isExpanded = false,
  onToggleExpand,
  hasInputContent,
  voice,
}: ChatInputBottomBarProps) {
  const { t } = useTranslation();

  const submitLabel = canStop ? t("chat.stop") : t("chat.sendMessage");
  const expandLabel = isExpanded
    ? t("chat.collapseInput")
    : t("chat.expandInput");
  const showExpandButton = shouldShowExpandButton(isExpanded, hasInputContent);

  return (
    <div className="flex shrink-0 items-center justify-end gap-2">
      {onToggleExpand && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              type="button"
              onClick={onToggleExpand}
              aria-label={expandLabel}
              /* ⚠️ 槽位常驻、只用 invisible 切换：这一格一旦条件渲染，打字第一帧就会
                 把编辑器右边界（和窄 pane 下的发送键）推来推去。
                 visibility:hidden 不进可访问树、不可聚焦，所以空态对键盘与读屏是透明的。 */
              className={`w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-hover-surface transition-colors ${
                showExpandButton ? "" : "invisible"
              }`}
            >
              {isExpanded ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{expandLabel}</TooltipContent>
        </Tooltip>
      )}

      <VoiceMicButton {...voice} />

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

/**
 * 展开按钮是否可见。
 *
 * 已展开时即使草稿被清空也保持可见——否则清空后无法用按钮收起。
 *
 * 判的只是**可见性**，不是渲染：按钮始终在 DOM 里（`invisible` 占位），所以它出现
 * 时不会推动编辑器或发送键。这是这一格唯一安稳的做法 —— 条件渲染的版本在左簇里会
 * 把编辑器左边缘右推 38px，在右簇里会缩窄编辑区。
 */
export function shouldShowExpandButton(
  isExpanded: boolean,
  hasInputContent: boolean,
): boolean {
  return isExpanded || hasInputContent;
}
