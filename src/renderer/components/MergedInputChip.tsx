import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { ProviderProfileKey, ThinkingLevel } from "../types";
import type { ModelOptionGroup } from "./ChatInputBottomBar";

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

type ActiveSubmenu = "model" | "thinking" | null;

const MENU_ROW_HEIGHT_PX = 36;
const MODEL_MENU_MAX_VISIBLE_ROWS = 16;
const MODEL_MENU_MAX_HEIGHT_PX =
  MENU_ROW_HEIGHT_PX * MODEL_MENU_MAX_VISIBLE_ROWS;
const TITLEBAR_HEIGHT_PX = 40;
const MENU_TOP_MARGIN_PX = 16;
const VIEWPORT_TOP_SAFE_AREA_PX = TITLEBAR_HEIGHT_PX + MENU_TOP_MARGIN_PX;

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<ActiveSubmenu>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [modelMenuMaxHeight, setModelMenuMaxHeight] = useState(
    MODEL_MENU_MAX_HEIGHT_PX,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const primaryMenuRef = useRef<HTMLDivElement>(null);

  const filteredModelOptions = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) return modelOptions;

    return modelOptions
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.name.toLowerCase().includes(query) ||
            item.id.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [modelOptions, modelSearch]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setActiveSubmenu(null);
    setModelSearch("");
  }, []);

  const updateModelMenuMaxHeight = useCallback(() => {
    const menu = primaryMenuRef.current;
    if (!menu) return;

    const availableHeight = Math.max(
      0,
      Math.floor(
        menu.getBoundingClientRect().bottom - VIEWPORT_TOP_SAFE_AREA_PX,
      ),
    );
    setModelMenuMaxHeight(Math.min(MODEL_MENU_MAX_HEIGHT_PX, availableHeight));
  }, []);

  const openSubmenu = useCallback(
    (submenu: Exclude<ActiveSubmenu, null>) => {
      if (submenu === "model") updateModelMenuMaxHeight();
      setActiveSubmenu(submenu);
    },
    [updateModelMenuMaxHeight],
  );

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        closeMenu();
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [closeMenu]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && menuOpen) closeMenu();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [closeMenu, menuOpen]);

  useEffect(() => {
    if (!menuOpen || activeSubmenu !== "model") return;

    updateModelMenuMaxHeight();
    window.addEventListener("resize", updateModelMenuMaxHeight);
    return () => window.removeEventListener("resize", updateModelMenuMaxHeight);
  }, [activeSubmenu, menuOpen, updateModelMenuMaxHeight]);

  const disabled = modelMenuDisabled || modelOptions.length === 0;
  const combinedLabel = `${t("chat.model")}, ${t("chat.thinkingLevel")}`;

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setMenuOpen((open) => !open);
          setActiveSubmenu(null);
          setModelSearch("");
        }}
        disabled={disabled}
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-border-subtle bg-background/60 px-2 text-xs text-text-primary transition-[width,background-color] duration-150 hover:bg-surface-hover disabled:opacity-50 ${
          menuOpen ? "w-[15rem] justify-center" : "max-w-[18rem]"
        }`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={combinedLabel}
        title={combinedLabel}
      >
        <span className="max-w-[11rem] truncate">
          {model || t("chat.noModel")}
        </span>
        <span>{t(`chat.thinkingLevel.${thinkingLevel}`)}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${menuOpen ? "rotate-180" : ""}`}
        />
      </button>

      <div
        ref={primaryMenuRef}
        role="menu"
        aria-label={combinedLabel}
        aria-hidden={!menuOpen}
        className={`absolute right-0 bottom-[calc(100%+8px)] z-30 flex w-[15rem] flex-col rounded-xl border border-border bg-background p-1 shadow-soft transition duration-150 ease-out ${
          menuOpen
            ? "visible translate-y-0 opacity-100"
            : "pointer-events-none invisible translate-y-2 opacity-0"
        }`}
      >
        <button
          type="button"
          onMouseEnter={() => openSubmenu("model")}
          onClick={() => openSubmenu("model")}
          className={`flex h-9 items-center justify-between gap-3 rounded-lg px-3 text-sm transition-colors ${
            activeSubmenu === "model"
              ? "bg-surface-hover text-text-primary"
              : "text-text-primary hover:bg-surface-hover"
          }`}
          aria-haspopup="listbox"
          aria-expanded={activeSubmenu === "model"}
          aria-label={t("chat.model")}
        >
          <span className="font-medium">{t("chat.model")}</span>
          <span className="flex min-w-0 items-center gap-2 text-text-muted">
            <span className="max-w-[9rem] truncate">
              {model || t("chat.noModel")}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </span>
        </button>

        <button
          type="button"
          onMouseEnter={() => openSubmenu("thinking")}
          onClick={() => openSubmenu("thinking")}
          className={`flex h-9 items-center justify-between gap-3 rounded-lg px-3 text-sm transition-colors ${
            activeSubmenu === "thinking"
              ? "bg-surface-hover text-text-primary"
              : "text-text-primary hover:bg-surface-hover"
          }`}
          aria-haspopup="listbox"
          aria-expanded={activeSubmenu === "thinking"}
          aria-label={t("chat.thinkingLevel")}
        >
          <span className="font-medium">{t("chat.thinkingLevel")}</span>
          <span className="flex items-center gap-2 text-text-muted">
            <span>{t(`chat.thinkingLevel.${thinkingLevel}`)}</span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </span>
        </button>

        <div
          role="listbox"
          aria-label={t("chat.model")}
          aria-hidden={activeSubmenu !== "model"}
          onMouseEnter={() => openSubmenu("model")}
          style={{ maxHeight: `${modelMenuMaxHeight}px` }}
          className={`absolute right-[calc(100%+4px)] bottom-0 w-[20rem] overflow-y-auto rounded-xl border border-border bg-background p-2 shadow-soft transition duration-150 ease-out ${
            activeSubmenu === "model"
              ? "visible translate-x-0 opacity-100"
              : "pointer-events-none invisible translate-x-2 opacity-0"
          }`}
        >
          <input
            type="text"
            value={modelSearch}
            onChange={(event) => setModelSearch(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            placeholder={t("chat.searchModel")}
            className="sticky top-0 z-10 mb-1.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />

          {filteredModelOptions.length === 0 ? (
            <div className="px-2.5 py-3 text-center text-xs text-text-muted">
              {t("chat.noModelMatch")}
            </div>
          ) : (
            filteredModelOptions.map((group) => (
              <div key={group.profileKey} className="mb-1 last:mb-0">
                <div className="px-2.5 py-1 text-xs uppercase tracking-[0.08em] text-text-muted">
                  {group.groupLabel}
                </div>
                {group.items.map((item) => {
                  const selected =
                    group.profileKey === activeProviderProfileKey &&
                    item.id === model;

                  return (
                    <button
                      key={`${group.profileKey}:${item.id}`}
                      type="button"
                      onClick={() => onSelectModel(group.profileKey, item.id)}
                      className={`flex h-9 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-sm transition-colors ${
                        selected
                          ? "bg-surface-hover text-text-primary"
                          : "text-text-primary hover:bg-surface-hover"
                      }`}
                      role="option"
                      aria-selected={selected}
                      title={item.name}
                    >
                      <span className="truncate">{item.name}</span>
                      {selected && <Check className="h-4 w-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div
          role="listbox"
          aria-label={t("chat.thinkingLevel")}
          aria-hidden={activeSubmenu !== "thinking"}
          onMouseEnter={() => openSubmenu("thinking")}
          className={`absolute left-[calc(100%+4px)] bottom-0 w-[12rem] rounded-xl border border-border bg-background p-2 shadow-soft transition duration-150 ease-out ${
            activeSubmenu === "thinking"
              ? "visible translate-x-0 opacity-100"
              : "pointer-events-none invisible -translate-x-2 opacity-0"
          }`}
        >
          <div className="px-2.5 py-1 text-xs uppercase tracking-[0.08em] text-text-muted">
            {t("chat.thinkingLevel")}
          </div>
          {thinkingLevelOptions.map((level) => {
            const selected = level === thinkingLevel;

            return (
              <button
                key={level}
                type="button"
                onClick={() => onSelectThinkingLevel(level)}
                className={`flex h-9 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-sm transition-colors ${
                  selected
                    ? "bg-surface-hover text-text-primary"
                    : "text-text-primary hover:bg-surface-hover"
                }`}
                role="option"
                aria-selected={selected}
              >
                <span>{t(`chat.thinkingLevel.${level}`)}</span>
                {selected && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
