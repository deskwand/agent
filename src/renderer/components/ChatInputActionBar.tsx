import { useTranslation } from "react-i18next";
import { Maximize2, Minimize2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import { AttachMenu } from "./attach/AttachMenu";
import { VoiceMicButton, type VoiceMicButtonProps } from "./VoiceMicButton";
import type { ChatInputAttachedFile } from "./ChatInput";
import { Button } from "./app-button";

/**
 * 输入卡内的左簇：附件 / 展开 / 麦克风。
 *
 * 与 `ChatInputBottomBar` 的分工：这一簇是「写之前能做的事」，在编辑器**左边**；
 * 发送键在编辑器右边。两者都在卡内同一行。拆成两个组件不是因为想分层 —— 它们落在
 * flex 行的两端、中间夹着编辑器，一个组件没法把编辑区包在自己中间。
 */
export interface ChatInputActionBarProps {
  onAttach: () => void;
  /** 当前会话工作目录，透传给 AttachMenu */
  cwd?: string;
  /** 选择器选出的附件 */
  onAddFiles: (files: ChatInputAttachedFile[]) => void;
  /** 已在输入框里的附件身份 key */
  attachedKeys: ReadonlySet<string>;
  /** 附件菜单展开方向；缺省向上（输入框贴底时） */
  attachMenuDirection?: "up" | "down";
  /** 附件菜单确认/取消后，请宿主把焦点交回输入框 */
  onAttachMenuDismiss?: () => void;
  /** 命令入口：原样透传给 AttachMenu；缺省 = 本宿主没有命令能力（欢迎页） */
  onCommandEntry?: (command: "compact" | "goal") => void;
  /** 自定义命令入口：宿主把 chip 插进输入框。缺省 = 本宿主不支持自定义命令 */
  onInsertPromptCommand?: (name: string) => void;
  /** 技能入口：宿主把 /skill:<name> 插进输入框。缺省 = 本宿主不支持技能引用 */
  onInsertSkill?: (name: string) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  /**
   * 草稿是否非空（来自 ChatInput 的 onContentChange）。
   * 必填：漏接线要变成编译错误，而不是静默不显示按钮。
   */
  hasInputContent: boolean;
  /**
   * 语音输入的全部状态与动作。必填：漏接线要变成编译错误，
   * 而不是静默不显示麦克风（与 hasInputContent 同一套约定）。
   */
  voice: VoiceMicButtonProps;
}

export function ChatInputActionBar({
  onAttach,
  cwd,
  onAddFiles,
  attachedKeys,
  attachMenuDirection,
  onAttachMenuDismiss,
  onCommandEntry,
  onInsertPromptCommand,
  onInsertSkill,
  isExpanded = false,
  onToggleExpand,
  hasInputContent,
  voice,
}: ChatInputActionBarProps) {
  const { t } = useTranslation();

  const expandLabel = isExpanded
    ? t("chat.collapseInput")
    : t("chat.expandInput");
  const showExpandButton = shouldShowExpandButton(isExpanded, hasInputContent);

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <AttachMenu
        cwd={cwd}
        onPickLocalFiles={onAttach}
        onAddFiles={onAddFiles}
        attachedKeys={attachedKeys}
        direction={attachMenuDirection}
        onDismiss={onAttachMenuDismiss}
        onCommandEntry={onCommandEntry}
        onInsertPromptCommand={onInsertPromptCommand}
        onInsertSkill={onInsertSkill}
      />

      {onToggleExpand && showExpandButton && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              type="button"
              onClick={onToggleExpand}
              aria-label={expandLabel}
              className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-hover-surface transition-colors"
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
    </div>
  );
}

/**
 * 展开按钮是否可见。
 *
 * 已展开时即使草稿被清空也保持可见——否则清空后无法用按钮收起。
 *
 * 按钮放在**左簇**（附件菜单右侧）并直接条件渲染：左簇左锚定，显隐只改它自己的
 * 宽度。显隐带来的 36px 差量由编辑器吸收（它是 `flex-1 min-w-0`，文字自己重排），
 * 发送键与卡外页脚都不动。
 */
export function shouldShowExpandButton(
  isExpanded: boolean,
  hasInputContent: boolean,
): boolean {
  return isExpanded || hasInputContent;
}
