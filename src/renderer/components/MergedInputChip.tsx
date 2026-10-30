import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { ProviderProfileKey, ThinkingLevel } from "../types";
import type { ModelOptionGroup } from "./ChatInputBottomBar";
import { resolveModelLabel } from "../utils/model-label";
import { isFreeModel } from "../utils/free-model";
import { useAppStore } from "../store";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_SELECTED_CLASS,
  MENU_LABEL_CLASS,
  MENU_PANEL_PADDED_CLASS,
  MENU_SEPARATOR_CLASS,
} from "./menu-styles";
import { Input } from "./ui/input";
import { Button } from "./app-button";

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
/** 面板与触发器之间的间距（与 PopoverContent 的 sideOffset 同源）。 */
const MENU_PANEL_OFFSET_PX = 8;
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null);
  const [panelMaxWidth, setPanelMaxWidth] = useState<number | null>(null);

  // WelcomeView 的输入框垂直居中，芯片上方的可用空间远小于 100vh - 12rem。
  // 超出 main 的 overflow-hidden 的顶部会被裁掉且点不到，因此按面板上方的实际可用高度取上限。
  //
  // 量的是**触发器**，不是面板。面板的坐标由 Radix 异步给出：首帧 wrapper 带
  // translate(0, -200%) 停在视口上方，定位要到 floating-ui 的 computePosition().then()
  // 才落到触发器上方，而那一帧不会带来新的重渲染 —— 打开时的这次 layout 量测就是唯一一次。
  // 量面板的写法正死在这里：量到负的 bottom 就直接放弃，只剩 className 上
  // 100vh - 12rem 的兜底，WelcomeView 里那笔账是超的（窗口高 747、芯片顶边 433 时，
  // 实测面板顶部溢到窗口外 64.6px）。
  // 触发器在打开之前就已布局完成，且 side="top" + sideOffset=8 把面板底边与它锁死：
  // 面板底边 = 触发器顶边 - 8（与原实现 bottom-[calc(100%_+_8px)] 同源）。
  const updatePanelMaxHeight = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // End alignment and disabled collision flipping must still respect the left viewport edge.
    if (rect.right > 8) setPanelMaxWidth(Math.floor(rect.right - 8));
    const bottom = rect.top - MENU_PANEL_OFFSET_PX;
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

  // 开关、外部点击关闭、Escape 三样全交给 Radix 的 Popover —— 手写的 document
  // mousedown/keydown 监听会让面板「刚打开就被关掉」（原实现正是如此，随本次迁移删掉）。
  // 每次切换都回到列表层；关闭时顺手清掉搜索词，避免下次打开残留一个旧的过滤结果。
  const handleOpenChange = useCallback((open: boolean) => {
    setMenuOpen(open);
    setPanelView("list");
    if (!open) setModelSearch("");
  }, []);

  const disabled = modelMenuDisabled || modelOptions.length === 0;
  const combinedLabel = `${t("chat.model")}, ${t("chat.thinkingLevel")}`;

  const renderGroupItems = (group: ModelOptionGroup) =>
    group.items.map((item) => {
      const selected =
        group.profileKey === activeProviderProfileKey && item.id === model;
      return (
        <Button
          variant="ghost"
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
          {isFreeModel({ id: item.id, name: item.name }) && (
            <span className="ml-auto shrink-0 rounded-md border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
              {t("common.free")}
            </span>
          )}
          {selected && <Check className="h-4 w-4 shrink-0" />}
        </Button>
      );
    });

  // 输入框绑的是 activeSearch 而不是 modelSearch。两者在输入框渲染期间恒等（渲染
  // 条件就是 showSearch），绑派生值把「不渲染 ⇔ 不过滤」变成结构性保证：将来若这
  // 两个条件被拆开，会立刻表现为输入框打不进字，而不是静默地 value 与过滤源不一致。
  const renderSearchInput = () => (
    <Input
      type="text"
      value={activeSearch}
      onChange={(event) => setModelSearch(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      placeholder={t("chat.searchModel")}
      className="mb-1.5 h-auto w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground shadow-none placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    />
  );

  const renderBackRow = () => (
    <Button
      variant="ghost"
      type="button"
      onClick={() => setPanelView("list")}
      className={`${MENU_ITEM_CLASS} text-muted-foreground hover:bg-hover-surface`}
    >
      <ChevronRight className="h-4 w-4 rotate-180" />
      {t("modelMenu.back")}
    </Button>
  );

  const renderThinkingRow = () => (
    <>
      <div className={MENU_SEPARATOR_CLASS} />
      <Button
        variant="ghost"
        type="button"
        onClick={() => setPanelView("thinking")}
        className={`${MENU_ITEM_CLASS} justify-between font-medium ${MENU_ITEM_DEFAULT_CLASS}`}
      >
        {t("modelMenu.thinkingWithValue", {
          value: t(`chat.thinkingLevel.${thinkingLevel}`),
        })}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Button>
    </>
  );

  const renderGroupList = () => {
    if (filteredModelOptions.length === 0) {
      // 判据用 activeSearch 而不是 showSearch：前者天然覆盖「有搜索框但用户还没输入」
      // （此时列表非空，走不到这里），只有真在筛选时才说「无匹配」。
      return (
        <div className="px-2.5 py-3 text-center text-xs text-muted-foreground">
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
    <Popover open={menuOpen} onOpenChange={handleOpenChange}>
      <div className="relative inline-flex">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            ref={triggerRef}
            type="button"
            disabled={disabled}
            // ⚠️ `font-normal [&_svg]:size-3` 是给 `<Button>` base 擦屁股（与活动 chip 同族的迁移回归）：
            // 这里的 `h-9` / `text-xs` 是**有意**写的（和输入框底行其它 36px 控件同高），但 base 的
            // `font-medium` 与 `[&_svg]:size-4` 没人顶：Chromium + 构建 CSS 实测字 12px/**500**、
            // chevron **16px**（作者写的是 `h-3 w-3`）；写回后 12px/400、12px == 迁移前的原生 `<button>`。
            className={`inline-flex h-9 min-w-0 items-center gap-1.5 rounded-full border border-border/40 bg-background/60 px-2 text-xs font-normal text-foreground transition-[width,background-color] duration-150 hover:bg-hover-surface disabled:opacity-50 [&_svg]:size-3 ${
              menuOpen ? "w-[15rem] justify-center" : "max-w-[18rem]"
            }`}
            aria-label={combinedLabel}
            title={combinedLabel}
          >
            <span className="max-w-[11rem] truncate">
              {currentModelLabel || t("chat.noModel")}
            </span>
            <span>{t(`chat.thinkingLevel.${thinkingLevel}`)}</span>
            <ChevronDown
              className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                menuOpen ? "rotate-180" : ""
              }`}
            />
          </Button>
        </PopoverTrigger>

        {menuOpen && (
          <PopoverContent
            side="top"
            align="end"
            sideOffset={MENU_PANEL_OFFSET_PX}
            // 始终向上展开：原实现固定贴着芯片上沿，max-height 也是按上方空间算的。
            // Radix 默认的碰撞翻转会在上方放不下时把面板翻到下方，让那笔账失真。
            avoidCollisions={false}
            // role="dialog" 由 Radix 的 PopoverContent 提供，不手写（写了会重复）
            aria-label={t("chat.model")}
            style={{
              maxHeight:
                panelMaxHeight === null ? undefined : `${panelMaxHeight}px`,
              maxWidth:
                panelMaxWidth === null ? undefined : `${panelMaxWidth}px`,
            }}
            className={`${MENU_PANEL_PADDED_CLASS} ${
              panelView === "thinking" ? "w-[12rem]" : "w-[20rem]"
            } max-h-[min(32rem,calc(100vh_+_-12rem))] overflow-y-auto`}
          >
            {panelView === "thinking" ? (
              <>
                {renderBackRow()}
                {thinkingLevelOptions.map((level) => (
                  <Button
                    variant="ghost"
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
                  </Button>
                ))}
              </>
            ) : (
              <>
                {showSearch && renderSearchInput()}
                {renderGroupList()}
                {renderThinkingRow()}
              </>
            )}
          </PopoverContent>
        )}
      </div>
    </Popover>
  );
}
