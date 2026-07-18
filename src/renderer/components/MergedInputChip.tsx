import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ThinkingLevel, ProviderProfileKey } from "../types";
import type { ModelOptionGroup } from "./ChatInputBottomBar";
import { ChevronDown } from "lucide-react";

export interface MergedInputChipProps {
  model: string;
  modelOptions: ModelOptionGroup[];
  activeProviderProfileKey: ProviderProfileKey;
  onSelectModel: (profileKey: ProviderProfileKey, modelId: string) => void;
  modelMenuDisabled?: boolean;
  thinkingLevel: ThinkingLevel;
  thinkingLevelOptions: ThinkingLevel[];
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  contextUsagePercentage: number;
  contextUsageTooltip: string;
}

export function MergedInputChip({
  model,
  modelOptions,
  activeProviderProfileKey,
  onSelectModel,
  modelMenuDisabled = false,
  thinkingLevel,
  thinkingLevelOptions,
  onSelectThinkingLevel,
  contextUsagePercentage: _contextUsagePercentage,
  contextUsageTooltip,
}: MergedInputChipProps) {
  const { t } = useTranslation();
  const [panelOpen, setPanelOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Click-outside closes panel + nested thinking dropdown
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setPanelOpen(false);
        setModelSearch("");
        setThinkingOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Escape closes thinking dropdown first, then panel
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (thinkingOpen) {
          setThinkingOpen(false);
        } else if (panelOpen) {
          setPanelOpen(false);
          setModelSearch("");
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [panelOpen, thinkingOpen]);

  const disabled = modelMenuDisabled || modelOptions.length === 0;

  return (
    <div ref={containerRef} className="relative inline-flex">
      {/* Collapsed chip */}
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setPanelOpen((v) => {
            if (v) setModelSearch("");
            return !v;
          });
          setThinkingOpen(false);
        }}
        disabled={disabled}
        className={`inline-flex h-9 items-center gap-1.5 px-2 rounded-full border text-xs transition-colors ${
          panelOpen
            ? "border-accent"
            : "border-border-subtle bg-background/60"
        } disabled:opacity-50`}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        title={t("chat.switchModel")}
      >
        <span className="truncate max-w-[10rem] text-text-primary">
          {model || t("chat.noModel")}
        </span>
        <span className="text-text-primary">
          {t(`chat.thinkingLevel.${thinkingLevel}`)}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-text-muted transition-transform ${panelOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Popup panel — left: model list, right: thinking + context */}
      <div
        className={`absolute right-0 bottom-[calc(100%+8px)] z-30 flex rounded-xl border border-border bg-background shadow-soft transition duration-150 ease-out w-[400px] ${
          panelOpen
            ? "opacity-100 translate-y-0 visible"
            : "opacity-0 translate-y-2 invisible pointer-events-none"
        }`}
      >
        {/* Left column: Model list */}
        <div className="flex-1 p-1.5 border-r border-border">
          {/* Search input */}
          <div className="pb-1.5">
            <input
              type="text"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder={t("chat.searchModel")}
              className="w-full rounded-lg border border-border bg-background px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="px-1 pt-0.5 pb-0.5 text-xs uppercase tracking-[0.08em] text-text-muted">
            {t("chat.switchModel")}
          </div>
          <div className="max-h-[240px] overflow-y-auto">
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
                        setPanelOpen(false);
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

        {/* Right column: Thinking level + Context info */}
        <div className="flex-1 p-1.5">
          <div className="px-1 pt-0.5 pb-0.5 text-xs uppercase tracking-[0.08em] text-text-muted">
            {t("chat.thinkingLevel")}
          </div>
          <div className="relative px-1 pb-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setThinkingOpen((v) => !v);
              }}
              className="inline-flex w-full h-8 items-center justify-between px-2 rounded-lg border border-border bg-background/60 text-xs text-text-primary hover:bg-surface-hover transition-colors"
            >
              <span>{t(`chat.thinkingLevel.${thinkingLevel}`)}</span>
              <ChevronDown className="w-3 h-3 text-text-muted" />
            </button>
            {/* Nested thinking-level dropdown */}
            <div
              className={`absolute left-1 right-1 bottom-[calc(100%+4px)] z-40 rounded-xl border border-border bg-background shadow-soft p-1 transition duration-150 ease-out ${
                thinkingOpen
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
                    setThinkingOpen(false);
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
          <div className="border-t border-border mx-1" />
          <div className="px-1 pt-2 text-xs text-text-muted whitespace-pre-line">
            {contextUsageTooltip}
          </div>
        </div>
      </div>
    </div>
  );
}
