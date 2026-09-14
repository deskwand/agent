import { useTranslation } from "react-i18next";
import type { ThinkingLevel, ProviderProfileKey } from "../types";
import { ArrowUp, Square, Maximize2, Minimize2 } from "lucide-react";
import { MergedInputChip } from "./MergedInputChip";
import { Tooltip } from "./Tooltip";
import { AttachMenu } from "./attach/AttachMenu";
import type { ChatInputAttachedFile } from "./ChatInput";

export interface ModelOptionGroup {
  profileKey: ProviderProfileKey;
  groupLabel: string;
  items: Array<{ id: string; name: string }>;
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
  contextUsageTooltip: string;
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
  contextUsageTooltip,
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
      <div className="flex items-center gap-0.5">
        <AttachMenu
          cwd={cwd}
          onPickLocalFiles={onAttach}
          onAddFiles={onAddFiles}
          attachedKeys={attachedKeys}
          direction={attachMenuDirection}
          onDismiss={onAttachMenuDismiss}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
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

        {/* Context ring */}
        <span className="relative inline-flex items-center justify-center group">
          <svg
            className="w-6 h-6 -rotate-90 text-text-muted"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              className="opacity-20"
            />
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray="1.5 5.5686"
              className="opacity-25"
            />
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className={contextRingColorClass}
              strokeDasharray={`${(contextUsagePercentage / 100) * (2 * Math.PI * 9)} ${2 * Math.PI * 9}`}
            />
          </svg>
          <span className="pointer-events-none absolute bottom-full right-0 mb-2 hidden group-hover:block group-focus-within:block z-20 min-w-max rounded-md border border-border bg-background px-2 py-1 text-xs leading-relaxed text-text-primary shadow-soft whitespace-pre-line">
            {contextUsageTooltip}
          </span>
        </span>

        {onToggleExpand && (
          <div className={showExpandButton ? undefined : "invisible"}>
            {/*
              隐藏时换 key 重挂载：气泡走 createPortal 挂在 body，不在 wrapper 子树内，
              而 Chromium 不会在命中目标转为 visibility:hidden 时补发 mouseleave
              （实测此时 button.matches(":hover") 仍为 true），已弹出的气泡会一直挂在空槽位上。
              重挂载把 Tooltip 内部的 open 状态一并销毁；DOM 形态（span.tt-anchor + button）保持不变。
            */}
            <Tooltip
              key={showExpandButton ? "shown" : "hidden"}
              label={expandLabel}
            >
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
          </div>
        )}

        <Tooltip label={submitLabel}>
          <button
            type={canStop ? "button" : "submit"}
            onClick={canStop ? onStop : undefined}
            disabled={!canStop && (isSubmitting || submitDisabled)}
            aria-label={submitLabel}
            className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-all duration-150 ${
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
 * 用 wrapper 挂 `invisible` 而不是条件渲染：底栏是 `justify-between`，右侧 cluster
 * 内容宽度、右边缘锚定，删掉这个槽位会让模型 chip 与上下文环右移 44px
 * （w-9 36 + gap-2 8，已实测；发送键被右边缘锚住不动）。
 */
export function shouldShowExpandButton(
  isExpanded: boolean,
  hasInputContent: boolean,
): boolean {
  return isExpanded || hasInputContent;
}
