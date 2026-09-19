import { useTranslation } from "react-i18next";
import type { ThinkingLevel, ProviderProfileKey } from "../types";
import { ArrowUp, Square, Maximize2, Minimize2 } from "lucide-react";
import { MergedInputChip } from "./MergedInputChip";
import { Tooltip } from "./Tooltip";
import { AttachMenu } from "./attach/AttachMenu";
import { StatusPopover } from "./StatusPopover";
import type { ChatInputAttachedFile } from "./ChatInput";

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
}

export interface ChatInputBottomBarProps {
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
}

export function ChatInputBottomBar({
  onAttach,
  cwd,
  onAddFiles,
  attachedKeys,
  attachMenuDirection,
  onAttachMenuDismiss,
  onCommandEntry,
  onInsertPromptCommand,
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
}: ChatInputBottomBarProps) {
  const { t } = useTranslation();

  const expandLabel = isExpanded
    ? t("chat.collapseInput")
    : t("chat.expandInput");
  const submitLabel = canStop ? t("chat.stop") : t("chat.sendMessage");
  const showExpandButton = shouldShowExpandButton(isExpanded, hasInputContent);

  return (
    <div className="mt-3 flex items-center justify-between gap-2">
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
        />

        {onToggleExpand && showExpandButton && (
          <Tooltip label={expandLabel}>
            <button
              type="button"
              onClick={onToggleExpand}
              aria-label={expandLabel}
              className="w-9 h-9 rounded-2xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              {isExpanded ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </Tooltip>
        )}
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

        <Tooltip label={submitLabel}>
          <button
            type={canStop ? "button" : "submit"}
            onClick={canStop ? onStop : undefined}
            disabled={!canStop && (isSubmitting || submitDisabled)}
            aria-label={submitLabel}
            className={`w-9 h-9 shrink-0 rounded-2xl flex items-center justify-center transition-all duration-150 ${
              canStop
                ? "bg-accent text-background hover:bg-accent-hover animate-pulse"
                : "bg-accent text-background disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover active:scale-95 active:translate-y-px"
            }`}
          >
            {canStop ? (
              <Square className="w-4 h-4" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </button>
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
