import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ThinkingLevel, ProviderProfileKey } from "../types";
import {
  Plus,
  ChevronDown,
  ArrowUp,
  Square,
  Maximize2,
  Minimize2,
  Target,
} from "lucide-react";

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
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);

  const filteredModelOptions = useMemo(() => {
    if (!modelSearch.trim()) return modelOptions;
    const q = modelSearch.toLowerCase();
    return modelOptions
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [modelOptions, modelSearch]);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const thinkingMenuRef = useRef<HTMLDivElement>(null);

  // Click-outside to close menus
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(e.target as Node)
      ) {
        setModelMenuOpen(false);
        setModelSearch("");
      }
      if (
        thinkingMenuRef.current &&
        !thinkingMenuRef.current.contains(e.target as Node)
      ) {
        setThinkingMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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
        <span className="hidden sm:inline-flex relative items-center justify-center group">
          <svg
            className="w-6 h-6 -rotate-90 text-text-muted"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            {/* Thin base ring connecting the ticks */}
            <circle
              cx="12"
              cy="12"
              r="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              className="opacity-20"
            />
            {/* 8 tick marks: (2π·9)/8 ≈ 7.07, gap = 7.07 - 1.5 ≈ 5.57 */}
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
            {/* Usage arc with round caps */}
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

        {/* Model + Thinking level */}
        <div className="flex items-center gap-2 max-w-full">
          <div
            ref={modelMenuRef}
            className="relative inline-flex h-9 items-center max-w-[16rem] px-2 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted"
          >
            <button
              type="button"
              onClick={() => {
                if (modelMenuDisabled || modelOptions.length === 0) return;
                setModelMenuOpen((v) => {
                  if (v) setModelSearch("");
                  return !v;
                });
              }}
              disabled={modelMenuDisabled || modelOptions.length === 0}
              className="inline-flex h-full items-center gap-1 text-text-primary max-w-[14rem] disabled:opacity-50"
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
              aria-label={t("chat.switchModel")}
              title={t("chat.switchModel")}
            >
              <span className="truncate">{model || t("chat.noModel")}</span>
              <ChevronDown className="w-3 h-3 text-text-muted" />
            </button>
            <div
              className={`absolute right-0 bottom-[calc(100%+8px)] z-30 min-w-[12rem] max-w-[16rem] rounded-xl border border-border bg-background shadow-soft transition duration-150 ease-out ${
                modelMenuOpen
                  ? "opacity-100 translate-y-0 visible"
                  : "opacity-0 translate-y-2 invisible pointer-events-none"
              }`}
            >
              <div className="p-1.5 pb-0">
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder={t("chat.searchModel")}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="max-h-[280px] overflow-y-auto p-1">
                {filteredModelOptions.length === 0 ? (
                  <div className="px-2.5 py-3 text-xs text-text-muted text-center">
                    {t("chat.noModelMatch")}
                  </div>
                ) : (
                  filteredModelOptions.map((group) => (
                    <div key={group.profileKey} className="mb-1 last:mb-0">
                      <div className="px-2.5 py-1 text-xs uppercase tracking-[0.08em] text-text-muted">
                        {group.groupLabel}
                      </div>
                      {group.items.map((item) => (
                        <button
                          key={`${group.profileKey}:${item.id}`}
                          type="button"
                          onClick={() => {
                            onSelectModel(group.profileKey, item.id);
                            setModelMenuOpen(false);
                            setModelSearch("");
                          }}
                          className={`w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                            group.profileKey === activeProviderProfileKey &&
                            item.id === model
                              ? "bg-accent text-background"
                              : "text-text-primary hover:bg-surface-hover"
                          }`}
                          role="option"
                          aria-selected={
                            group.profileKey === activeProviderProfileKey &&
                            item.id === model
                          }
                          title={item.name}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <div
            ref={thinkingMenuRef}
            onClick={() => setThinkingMenuOpen((v) => !v)}
            className="relative inline-flex h-9 items-center gap-1.5 px-2 rounded-full border border-border-subtle bg-background/60 text-xs text-text-muted cursor-pointer"
            role="button"
            tabIndex={0}
          >
            <span>{t("chat.thinkingLevel")}</span>
            <button
              type="button"
              tabIndex={-1}
              className="inline-flex h-full items-center gap-1 text-text-primary"
              aria-haspopup="listbox"
              aria-expanded={thinkingMenuOpen}
              aria-label={t("chat.thinkingLevel")}
            >
              <span>{t(`chat.thinkingLevel.${thinkingLevel}`)}</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            <div
              className={`absolute right-0 bottom-[calc(100%+8px)] z-30 min-w-[7.25rem] rounded-xl border border-border bg-background shadow-soft p-1 transition duration-150 ease-out ${
                thinkingMenuOpen
                  ? "opacity-100 translate-y-0 visible"
                  : "opacity-0 translate-y-2 invisible pointer-events-none"
              }`}
            >
              {thinkingLevelOptions.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectThinkingLevel(level);
                    setThinkingMenuOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    level === thinkingLevel
                      ? "bg-accent text-background"
                      : "text-text-primary hover:bg-surface-hover"
                  }`}
                  role="option"
                  aria-selected={level === thinkingLevel}
                >
                  {t(`chat.thinkingLevel.${level}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="w-9 h-9 rounded-2xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            title={isExpanded ? t("chat.collapseInput") : t("chat.expandInput")}
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
