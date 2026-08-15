import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { ProviderProfileKey, ThinkingLevel } from "../types";
import type { ModelOptionGroup } from "./ChatInputBottomBar";
import { resolveModelLabel } from "../utils/model-label";
import { useAppStore } from "../store";

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
  const cloudConfig = useAppStore((s) => s.cloudConfig);
  const isLoggedIn = cloudConfig?.isLoggedIn ?? false;
  const isCloudMode = activeProviderProfileKey === "custom:deskwand";
  const currentModelLabel = resolveModelLabel(
    modelOptions,
    activeProviderProfileKey,
    model,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [panelView, setPanelView] = useState<"modes" | "custom" | "thinking">(
    "modes",
  );
  const [thinkingReturnView, setThinkingReturnView] = useState<
    "modes" | "custom"
  >("modes");
  const containerRef = useRef<HTMLDivElement>(null);

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
    setPanelView("modes");
    setModelSearch("");
  }, []);

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

  const disabled = modelMenuDisabled || modelOptions.length === 0;
  const combinedLabel = `${t("chat.model")}, ${t("chat.thinkingLevel")}`;

  const cloudGroup = modelOptions.find(
    (g) => g.profileKey === "custom:deskwand",
  );
  const customGroups = modelOptions.filter(
    (g) => g.profileKey !== "custom:deskwand",
  );

  const renderGroupItems = (group: ModelOptionGroup) =>
    group.items.map((item) => {
      const selected =
        group.profileKey === activeProviderProfileKey && item.id === model;
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
    });

  const renderSearchInput = () => (
    <input
      type="text"
      value={modelSearch}
      onChange={(event) => setModelSearch(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      placeholder={t("chat.searchModel")}
      className="mb-1.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
    />
  );

  const renderBackRow = (target: "modes" | "custom") => (
    <button
      type="button"
      onClick={() => setPanelView(target)}
      className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-text-muted transition-colors hover:bg-surface-hover"
    >
      <ChevronRight className="h-4 w-4 rotate-180" />
      {t("modelMenu.back")}
    </button>
  );

  const renderThinkingRow = (returnView: "modes" | "custom") => (
    <>
      <div className="my-1 border-t border-border" />
      <button
        type="button"
        onClick={() => {
          setThinkingReturnView(returnView);
          setPanelView("thinking");
        }}
        className="flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
      >
        {t("modelMenu.thinkingWithValue", {
          value: t(`chat.thinkingLevel.${thinkingLevel}`),
        })}
        <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
      </button>
    </>
  );

  const renderNonCloudGroups = () => {
    const searching = modelSearch.trim() !== "";
    const groups = searching
      ? filteredModelOptions.filter((g) => g.profileKey !== "custom:deskwand")
      : customGroups;
    if (groups.length === 0 && searching) {
      return (
        <div className="px-2.5 py-3 text-center text-xs text-text-muted">
          {t("chat.noModelMatch")}
        </div>
      );
    }
    return groups.map((group) => (
      <div key={group.profileKey} className="mb-1 last:mb-0">
        <div className="px-2.5 py-1 text-xs uppercase tracking-[0.08em] text-text-muted">
          {group.groupLabel}
        </div>
        {renderGroupItems(group)}
      </div>
    ));
  };

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setMenuOpen((open) => {
            if (open) {
              setPanelView("modes");
              setModelSearch("");
              return false;
            }
            setPanelView("modes");
            return true;
          });
        }}
        disabled={disabled}
        className={`inline-flex h-9 items-center gap-1.5 rounded-2xl border border-border-subtle bg-background/60 px-2 text-xs text-text-primary transition-[width,background-color] duration-150 hover:bg-surface-hover disabled:opacity-50 ${
          menuOpen ? "w-[15rem] justify-center" : "max-w-[18rem]"
        }`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={combinedLabel}
        title={combinedLabel}
      >
        <span className="max-w-[11rem] truncate">
          {currentModelLabel || t("chat.noModel")}
        </span>
        {!isCloudMode && (
          <span>{t(`chat.thinkingLevel.${thinkingLevel}`)}</span>
        )}
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${
            menuOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label={t("chat.model")}
          className={`absolute right-0 bottom-[calc(100%_+_8px)] z-30 ${
            panelView === "thinking"
              ? "w-[12rem]"
              : panelView === "modes" && isLoggedIn && cloudGroup
                ? "w-[15rem]"
                : "w-[20rem]"
          } max-h-[min(32rem,calc(100vh_+_-12rem))] overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-soft`}
        >
          {panelView === "thinking" ? (
            <>
              {renderBackRow(thinkingReturnView)}
              {thinkingLevelOptions.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => {
                    onSelectThinkingLevel(level);
                    setPanelView(thinkingReturnView);
                  }}
                  className={`flex h-9 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-sm transition-colors ${
                    level === thinkingLevel
                      ? "bg-surface-hover text-text-primary"
                      : "text-text-primary hover:bg-surface-hover"
                  }`}
                  role="option"
                  aria-selected={level === thinkingLevel}
                >
                  <span className="truncate">
                    {t(`chat.thinkingLevel.${level}`)}
                  </span>
                  {level === thinkingLevel && (
                    <Check className="h-4 w-4 shrink-0" />
                  )}
                </button>
              ))}
            </>
          ) : panelView === "custom" ? (
            <>
              {renderBackRow("modes")}
              {renderSearchInput()}
              {renderNonCloudGroups()}
              {renderThinkingRow("custom")}
            </>
          ) : isLoggedIn && cloudGroup ? (
            <>
              {renderGroupItems(cloudGroup)}
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                onClick={() => setPanelView("custom")}
                className="flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
              >
                {t("modelMenu.custom")}
                <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
              </button>
            </>
          ) : (
            <>
              {renderSearchInput()}
              {renderNonCloudGroups()}
              {renderThinkingRow("modes")}
            </>
          )}
        </div>
      )}
    </div>
  );
}
