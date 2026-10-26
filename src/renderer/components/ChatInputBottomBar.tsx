import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ThinkingLevel, ProviderProfileKey } from "../types";
import { ArrowUp, Square, Maximize2, Minimize2 } from "lucide-react";
import { MergedInputChip } from "./MergedInputChip";
import { Tooltip, TooltipContent, TooltipTrigger } from "./app-tooltip";
import { AttachMenu } from "./attach/AttachMenu";
import { StatusPopover } from "./StatusPopover";
import { VoiceMicButton, type VoiceMicButtonProps } from "./VoiceMicButton";
import type { ChatInputAttachedFile } from "./ChatInput";
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

export interface ChatInputBottomBarProps {
  onAttach: () => void;
  /** 左簇首位（附件按钮之前）的宿主自定义位。缺省 = 不渲染。 */
  leadingSlot?: ReactNode;
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
  model: string;
  modelOptions: ModelOptionGroup[];
  activeProviderProfileKey: ProviderProfileKey;
  onSelectModel: (profileKey: ProviderProfileKey, modelId: string) => void;
  modelMenuDisabled?: boolean;
  thinkingLevel: ThinkingLevel;
  thinkingLevelOptions: ThinkingLevel[];
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  contextUsagePercentage: number;
  contextRingColorClass: string;
  contextStatusDetails: ContextStatusDetails;
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
   * 语音输入的全部状态与动作。必填：漏接线要变成编译错误，
   * 而不是静默不显示麦克风（与 hasInputContent 同一套约定）。
   */
  voice: VoiceMicButtonProps;
}

export function ChatInputBottomBar({
  onAttach,
  leadingSlot,
  cwd,
  onAddFiles,
  attachedKeys,
  attachMenuDirection,
  onAttachMenuDismiss,
  onCommandEntry,
  onInsertPromptCommand,
  onInsertSkill,
  model,
  modelOptions,
  activeProviderProfileKey,
  onSelectModel,
  modelMenuDisabled = false,
  thinkingLevel,
  thinkingLevelOptions,
  onSelectThinkingLevel,
  contextUsagePercentage,
  contextRingColorClass,
  contextStatusDetails,
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

  const expandLabel = isExpanded
    ? t("chat.collapseInput")
    : t("chat.expandInput");
  const submitLabel = canStop ? t("chat.stop") : t("chat.sendMessage");
  const showExpandButton = shouldShowExpandButton(isExpanded, hasInputContent);

  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-0.5">
        {leadingSlot}
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

      <div className="flex min-w-0 items-center justify-end gap-2">
        {/* Merged model + thinking chip */}
        <MergedInputChip
          model={model}
          modelOptions={modelOptions}
          activeProviderProfileKey={activeProviderProfileKey}
          onSelectModel={onSelectModel}
          modelMenuDisabled={modelMenuDisabled}
          thinkingLevel={thinkingLevel}
          thinkingLevelOptions={thinkingLevelOptions}
          onSelectThinkingLevel={onSelectThinkingLevel}
        />

        <StatusPopover
          contextUsagePercentage={contextUsagePercentage}
          contextRingColorClass={contextRingColorClass}
          contextStatusDetails={contextStatusDetails}
        />

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
    </div>
  );
}

/**
 * 展开按钮是否可见。
 *
 * 已展开时即使草稿被清空也保持可见——否则清空后无法用按钮收起。
 * 按钮放在**左 cluster**（附件菜单右侧）并直接条件渲染：左 cluster 左锚定，
 * 显隐只改它自己的宽度，附件按钮与右侧 cluster（模型 chip / 上下文环 / 发送键）都不动。
 * 实测（真实 Tailwind CSS，全场宽 300–920px）：底栏行高恒 36px，显隐高度差为 0，无重叠无溢出。
 * 为此右 cluster 不换行（`min-w-0` + chip 可截断），左 cluster 与发送键 `shrink-0`。
 * 残留：底栏宽 < 400px 时显隐会让模型 chip 左边缘最多移动 38px（宽度让给 chip 截断）。
 * 放在右 cluster 就不能这么做：右 cluster 是右边缘锚定的，删掉中间一个槽位会把它左边
 * 的 chip 与上下文环右推 44px；而且保留槽位会留下一个很难看的空档。
 */
export function shouldShowExpandButton(
  isExpanded: boolean,
  hasInputContent: boolean,
): boolean {
  return isExpanded || hasInputContent;
}
