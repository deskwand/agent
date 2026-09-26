import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { ProviderProfileKey, ThinkingLevel } from "../types";
import type { ModelOptionGroup } from "./ChatInputBottomBar";
import { resolveModelLabel } from "../utils/model-label";
import { useAppStore } from "../store";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_SELECTED_CLASS,
  MENU_LABEL_CLASS,
  MENU_PANEL_PADDED_CLASS,
  MENU_SEPARATOR_CLASS,
} from "./menu-styles";

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

// 面板向上展开，顶部需要让开标题栏（h-10）并留一点呼吸空间。
const MENU_TOP_SAFE_AREA_PX = 48;
const MODEL_MENU_MAX_HEIGHT_PX = 512;
// 可见模型总数超过这个数才渲染搜索框：8 个模型 + 2 个分组标题 ≈ 317px，仍在面板
// 512px 上限内（单行 28px 来自 MENU_ITEM_CLASS 的 h-7）。这笔账成立的前提是
// uiFontSize 为默认值、且面板吃到 512px 上限——依据与偏差见
// design-docs/2026-09-27-model-menu-compact-design.md §2、§7。
const MODEL_SEARCH_MIN_ITEMS = 8;

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
  const currentModelLabel = resolveModelLabel(
    modelOptions,
    activeProviderProfileKey,
    model,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [panelView, setPanelView] = useState<"list" | "thinking">("list");
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null);

  // WelcomeView 的输入框垂直居中，芯片上方的可用空间远小于 100vh - 12rem。
  // 超出 main 的 overflow-hidden 的顶部会被裁掉且点不到，因此按面板上方的实际可用高度取上限。
  const updatePanelMaxHeight = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { bottom } = menu.getBoundingClientRect();
    // 无布局信息（jsdom 等）时保留 className 上的默认上限
    if (bottom <= 0) return;
    const available = Math.max(0, Math.floor(bottom - MENU_TOP_SAFE_AREA_PX));
    setPanelMaxHeight(Math.min(MODEL_MENU_MAX_HEIGHT_PX, available));
  }, []);

  // 打开时先量一次（layout 阶段，避免首帧闪烁），窗口尺寸变化时重量。
  useLayoutEffect(() => {
    if (!menuOpen) return;
    updatePanelMaxHeight();
    window.addEventListener("resize", updatePanelMaxHeight);
    return () => window.removeEventListener("resize", updatePanelMaxHeight);
  }, [menuOpen, updatePanelMaxHeight]);

  // 云分组只在登录时进入列表：未登录时残留的 custom:deskwand 用的是失效 token。
  // 顺序上云分组排最前：provider 顺序来自配置写入顺序（config-store.saveProvider 追加新
  // key），云端 provider 是登录时才写入的，不能假设它天然第一；其余分组的两两比较返回 0，
  // 靠 Array.prototype.sort 的稳定性保持原顺序。
  const visibleModelOptions = useMemo(() => {
    // filter 已返回新数组，就地 sort 不会改到 props
    const visible = modelOptions.filter(
      (group) => isLoggedIn || group.profileKey !== "custom:deskwand",
    );
    return visible.sort(
      (a, b) =>
        Number(b.profileKey === "custom:deskwand") -
        Number(a.profileKey === "custom:deskwand"),
    );
  }, [modelOptions, isLoggedIn]);

  // 搜索框只在列表长到一屏放不下时才出现。判据取 visibleModelOptions 而非 props：
  // 未登录时云分组已被剔除，用 props 会拿失效 token 的残壳把总数撑大。
  // 这里刻意不用 useMemo——只是数组上的 reduce，重算比 memo 自身开销还低。
  const visibleModelCount = visibleModelOptions.reduce(
    (sum, group) => sum + group.items.length,
    0,
  );
  const showSearch = visibleModelCount > MODEL_SEARCH_MIN_ITEMS;
  // 搜索框不渲染时过滤必须同步失效。modelSearch 只在关闭菜单时清空（closeMenu），
  // 而 isLoggedIn 可能被后台 401 打成 false（仓里 10 处 setCloudConfig(null)），
  // 那一瞬列表变短、搜索框卸载，残留 query 会留下一个无法清空的过滤结果。
  const activeSearch = showSearch ? modelSearch : "";
  // 只有一个分组时标题不提供任何导航价值——面板里没有第二个分组可跳。
  // 判据是分组数而非模型数，与上面的搜索框阈值是两条独立规则。
  // 分组数刻意取**未过滤**的 visibleModelOptions：搜索把结果收窄到 1 个分组时，
  // 标题要留着说明这条结果来自哪个 provider；改用 filteredModelOptions 会让标题
  // 随着打字增删。
  const showGroupLabel = visibleModelOptions.length > 1;

  const filteredModelOptions = useMemo(() => {
    const query = activeSearch.trim().toLowerCase();
    if (!query) return visibleModelOptions;

    return visibleModelOptions
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.name.toLowerCase().includes(query) ||
            item.id.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [visibleModelOptions, activeSearch]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setPanelView("list");
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

  const renderGroupItems = (group: ModelOptionGroup) =>
    group.items.map((item) => {
      const selected =
        group.profileKey === activeProviderProfileKey && item.id === model;
      return (
        <button
          key={`${group.profileKey}:${item.id}`}
          type="button"
          onClick={() => onSelectModel(group.profileKey, item.id)}
          className={`${MENU_ITEM_CLASS} justify-between ${
            selected ? MENU_ITEM_SELECTED_CLASS : MENU_ITEM_DEFAULT_CLASS
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

  // 输入框绑的是 activeSearch 而不是 modelSearch。两者在输入框渲染期间恒等（渲染
  // 条件就是 showSearch），绑派生值把「不渲染 ⇔ 不过滤」变成结构性保证：将来若这
  // 两个条件被拆开，会立刻表现为输入框打不进字，而不是静默地 value 与过滤源不一致。
  const renderSearchInput = () => (
    <input
      type="text"
      value={activeSearch}
      onChange={(event) => setModelSearch(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      placeholder={t("chat.searchModel")}
      className="mb-1.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
    />
  );

  const renderBackRow = () => (
    <button
      type="button"
      onClick={() => setPanelView("list")}
      className={`${MENU_ITEM_CLASS} text-text-muted hover:bg-surface-hover`}
    >
      <ChevronRight className="h-4 w-4 rotate-180" />
      {t("modelMenu.back")}
    </button>
  );

  const renderThinkingRow = () => (
    <>
      <div className={MENU_SEPARATOR_CLASS} />
      <button
        type="button"
        onClick={() => setPanelView("thinking")}
        className={`${MENU_ITEM_CLASS} justify-between font-medium ${MENU_ITEM_DEFAULT_CLASS}`}
      >
        {t("modelMenu.thinkingWithValue", {
          value: t(`chat.thinkingLevel.${thinkingLevel}`),
        })}
        <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
      </button>
    </>
  );

  const renderGroupList = () => {
    if (filteredModelOptions.length === 0) {
      // 判据用 activeSearch 而不是 showSearch：前者天然覆盖「有搜索框但用户还没输入」
      // （此时列表非空，走不到这里），只有真在筛选时才说「无匹配」。
      return (
        <div className="px-2.5 py-3 text-center text-xs text-text-muted">
          {activeSearch ? t("chat.noModelMatch") : t("chat.noAvailableModel")}
        </div>
      );
    }
    return filteredModelOptions.map((group) => (
      <div key={group.profileKey} className="mb-1 last:mb-0">
        {showGroupLabel && (
          <div className={MENU_LABEL_CLASS}>{group.groupLabel}</div>
        )}
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
              setPanelView("list");
              setModelSearch("");
              return false;
            }
            setPanelView("list");
            return true;
          });
        }}
        disabled={disabled}
        className={`inline-flex h-9 min-w-0 items-center gap-1.5 rounded-2xl border border-border-subtle bg-background/60 px-2 text-xs text-text-primary transition-[width,background-color] duration-150 hover:bg-surface-hover disabled:opacity-50 ${
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
        <span>{t(`chat.thinkingLevel.${thinkingLevel}`)}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${
            menuOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("chat.model")}
          style={
            panelMaxHeight === null
              ? undefined
              : { maxHeight: `${panelMaxHeight}px` }
          }
          className={`${MENU_PANEL_PADDED_CLASS} animate-menu-in-up absolute right-0 bottom-[calc(100%_+_8px)] z-30 ${
            panelView === "thinking" ? "w-[12rem]" : "w-[20rem]"
          } max-h-[min(32rem,calc(100vh_+_-12rem))] overflow-y-auto`}
        >
          {panelView === "thinking" ? (
            <>
              {renderBackRow()}
              {thinkingLevelOptions.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => {
                    onSelectThinkingLevel(level);
                    setPanelView("list");
                  }}
                  className={`${MENU_ITEM_CLASS} justify-between ${
                    level === thinkingLevel
                      ? MENU_ITEM_SELECTED_CLASS
                      : MENU_ITEM_DEFAULT_CLASS
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
          ) : (
            <>
              {showSearch && renderSearchInput()}
              {renderGroupList()}
              {renderThinkingRow()}
            </>
          )}
        </div>
      )}
    </div>
  );
}
