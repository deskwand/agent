import { useState, useRef, useEffect, useMemo, useCallback } from "react";
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
}: MergedInputChipProps) {
  const { t } = useTranslation();
  const [panelOpen, setPanelOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
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

  const closeAll = useCallback(() => {
    setPanelOpen(false);
    setModelSearch("");
    setShowLeft(false);
    setShowRight(false);
  }, []);

  // Click-outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        closeAll();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [closeAll]);

  // Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && panelOpen) {
        closeAll();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [panelOpen, closeAll]);

  const disabled = modelMenuDisabled || modelOptions.length === 0;

  return (
    <div ref={containerRef} className="relative inline-flex">
      {/* Popup panel + chip as one visual unit */}
      <div
        className={`absolute right-0 bottom-0 z-30 flex flex-col transition duration-150 ease-out ${
          panelOpen
            ? "opacity-100 translate-y-0 visible"
            : "opacity-0 translate-y-2 invisible pointer-events-none"
        }`}
      >
        {/* Three-column panel */}
        <div className="flex items-stretch">
          {/* Left column: model list (hover-triggered) */}
          <div
            className={`shrink-0 w-[200px] rounded-tl-xl border border-border border-r-0 border-b-0 bg-background p-2 transition-all duration-200 ease-out ${
              showLeft
                ? "opacity-100 translate-x-0"
                : "opacity-0 -translate-x-2 pointer-events-none"
            }`}
          >
            <input
              type="text"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder={t("chat.searchModel")}
              className="w-full rounded-lg border border-border bg-background px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="mt-1.5 max-h-[260px] overflow-y-auto">
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

          {/* Center column: anchors (always visible) */}
          <div
            className="shrink-0 w-[140px] border border-border border-b-0 bg-background p-2 flex flex-col gap-0.5"
            onMouseEnter={() => {
              setShowLeft(false);
              setShowRight(false);
            }}
          >
            <div
              className={`px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                showLeft
                  ? "bg-accent/10 text-text-primary"
                  : "text-text-secondary hover:bg-surface-hover"
              }`}
              onMouseEnter={() => {
                setShowLeft(true);
                setShowRight(false);
              }}
            >
              {t("chat.switchModel")}
            </div>
            <div
              className={`px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                showRight
                  ? "bg-accent/10 text-text-primary"
                  : "text-text-secondary hover:bg-surface-hover"
              }`}
              onMouseEnter={() => {
                setShowRight(true);
                setShowLeft(false);
              }}
            >
              {t("chat.thinkingLevel")}
            </div>
          </div>

          {/* Right column: thinking-level options (hover-triggered) */}
          <div
            className={`shrink-0 w-[140px] rounded-tr-xl border border-border border-l-0 border-b-0 bg-background p-2 transition-all duration-200 ease-out ${
              showRight
                ? "opacity-100 translate-x-0"
                : "opacity-0 translate-x-2 pointer-events-none"
            }`}
          >
            <div className="px-1 text-xs uppercase tracking-[0.08em] text-text-muted mb-1">
              {t("chat.thinkingLevel")}
            </div>
            <div className="max-h-[260px] overflow-y-auto">
              {thinkingLevelOptions.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => {
                    onSelectThinkingLevel(level);
                  }}
                  className={`w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
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

        {/* Chip: bottom of the connected visual unit */}
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 px-2 bg-background border border-border rounded-b-full text-xs text-text-primary"
          onClick={() => {
            if (disabled) return;
            closeAll();
          }}
        >
          <span className="truncate max-w-[10rem]">
            {model || t("chat.noModel")}
          </span>
          <span>{t(`chat.thinkingLevel.${thinkingLevel}`)}</span>
          <ChevronDown
            className={`w-3 h-3 text-text-muted transition-transform ${panelOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* Collapsed chip (shown when panel is closed) */}
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setPanelOpen((v) => !v);
          setShowLeft(false);
          setShowRight(false);
          setModelSearch("");
        }}
        disabled={disabled}
        className={`inline-flex h-9 items-center gap-1.5 px-2 rounded-full border text-xs transition-colors ${
          panelOpen
            ? "invisible pointer-events-none"
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
        <ChevronDown className="w-3 h-3 text-text-muted" />
      </button>
    </div>
  );
}
