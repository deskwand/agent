import { useTranslation } from "react-i18next";
import type { ThinkingLevel, ProviderProfileKey } from "../types";
import {
  Plus,
  ArrowUp,
  Square,
  Maximize2,
  Minimize2,
  Target,
} from "lucide-react";
import { MergedInputChip } from "./MergedInputChip";

export interface ModelOptionGroup {
  profileKey: ProviderProfileKey;
  groupLabel: string;
  items: Array<{ id: string; name: string }>;
}

export interface ChatInputBottomBarProps {
  onAttach: () => void;
  attachTitle?: string;
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
  onSteer?: () => void;
  hasInput?: boolean;
}

export function ChatInputBottomBar({
  onAttach,
  attachTitle,
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
  onSteer,
  hasInput = false,
}: ChatInputBottomBarProps) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onAttach}
          className="w-9 h-9 rounded-2xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title={attachTitle || t("welcome.attachFiles")}
        >
          <Plus className="w-4 h-4" />
        </button>
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
          <button
            type="button"
            onClick={onToggleExpand}
            className="w-9 h-9 rounded-2xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            title={
              isExpanded ? t("chat.collapseInput") : t("chat.expandInput")
            }
          >
            {isExpanded ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Steering: one-click guidance injection when agent is running */}
        {canStop && onSteer && hasInput && (
          <button
            type="button"
            onClick={onSteer}
            className="inline-flex items-center gap-1 h-9 px-2.5 rounded-full border border-border bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary text-xs font-medium transition-colors"
            title={t("steer.label")}
          >
            <Target className="w-3.5 h-3.5" />
            <span>{t("steer.label")}</span>
          </button>
        )}

        <button
          type={canStop ? "button" : "submit"}
          onClick={canStop ? onStop : undefined}
          disabled={!canStop && (isSubmitting || submitDisabled)}
          className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-all duration-150 ${
            canStop
              ? "bg-accent text-background hover:bg-accent-hover animate-pulse"
              : "bg-accent text-background disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover active:scale-95 active:translate-y-px"
          }`}
          title={canStop ? t("chat.stop") : t("chat.sendMessage")}
        >
          {canStop ? (
            <Square className="w-4 h-4" />
          ) : (
            <ArrowUp className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
