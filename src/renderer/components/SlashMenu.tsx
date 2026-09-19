import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { List, Package, Sparkles, Zap } from "lucide-react";
import type { Skill } from "../types";
import type { SlashCommand, SlashItem } from "../slash-commands";
import {
  MENU_ITEM_CLASS,
  MENU_ITEM_DEFAULT_CLASS,
  MENU_ITEM_SELECTED_CLASS,
  MENU_PANEL_CLASS,
} from "./menu-styles";

export type SlashTab = "all" | "commands" | "skills";

interface SlashMenuProps {
  commands: SlashCommand[];
  skills: Skill[];
  // Optional: merged "all" list. Defaults to commands+skills when absent
  // (kept optional so direct-render callers/tests without the prop keep working).
  allItems?: SlashItem[];
  activeTab: SlashTab;
  selectedIndex: number;
  onSelect: (item: SlashItem) => void;
  onTabChange: (tab: SlashTab) => void;
  direction?: "up" | "down";
}

const TAB_LIST: { key: SlashTab; i18n: string }[] = [
  { key: "all", i18n: "slashAll" },
  { key: "commands", i18n: "slashTabCommands" },
  { key: "skills", i18n: "slashTabSkills" },
];

export const SLASH_MENU_CONTAINER_CLASS = `${MENU_PANEL_CLASS} absolute left-0 right-0 z-30 flex flex-col h-[28rem] max-h-[60vh]`;

export function SlashMenu({
  commands,
  skills,
  allItems,
  activeTab,
  selectedIndex,
  onSelect,
  onTabChange,
  direction = "up",
}: SlashMenuProps) {
  const { t } = useTranslation();

  // Build flat item list per tab for keyboard nav index mapping
  const commandItems: SlashItem[] = commands.map((c) => ({
    category: "command" as const,
    command: c,
  }));
  const skillItems: SlashItem[] = skills.map((s) => ({
    category: "skill" as const,
    skill: { name: s.name, description: s.description },
  }));

  const displayItems =
    activeTab === "all"
      ? (allItems ?? [...commandItems, ...skillItems])
      : activeTab === "commands"
        ? commandItems
        : skillItems;

  const hasCommands = commandItems.length > 0;
  const hasSkills = skillItems.length > 0;
  const isEmpty = displayItems.length === 0;

  // Hide tabs with no content (except "all")
  const visibleTabs = TAB_LIST.filter((tab) => {
    if (tab.key === "all") return true;
    if (tab.key === "commands") return hasCommands;
    if (tab.key === "skills") return hasSkills;
    return true;
  });

  // Auto-switch to "all" if active tab has no items
  useEffect(() => {
    if (activeTab === "commands" && !hasCommands) onTabChange("all");
    if (activeTab === "skills" && !hasSkills) onTabChange("all");
  }, [activeTab, hasCommands, hasSkills, onTabChange]);

  return (
    <div
      className={`${SLASH_MENU_CONTAINER_CLASS} ${
        direction === "down"
          ? "top-[calc(100%+6px)] animate-menu-in-down"
          : "bottom-[calc(100%+6px)] animate-menu-in-up"
      }`}
    >
      {/* Top tab bar */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-0 select-none shrink-0">
        {visibleTabs.map((tab) => {
          const count =
            tab.key === "all"
              ? commandItems.length + skillItems.length
              : tab.key === "commands"
                ? commandItems.length
                : skillItems.length;
          const tabIcon =
            tab.key === "all" ? (
              <List className="w-3.5 h-3.5 flex-shrink-0" />
            ) : tab.key === "commands" ? (
              <Zap className="w-3.5 h-3.5 flex-shrink-0" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
            );
          const tabLabel =
            tab.key === "all"
              ? t("chat.slashAll")
              : tab.key === "commands"
                ? t("chat.slashTabCommands")
                : t("chat.slashTabSkills");
          return (
            <button
              key={tab.key}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onTabChange(tab.key);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-accent text-accent-foreground"
                  : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
              }`}
            >
              {tabIcon}
              <span className="truncate">{tabLabel}</span>
              <span
                className={`text-[10px] leading-none flex-shrink-0 ${
                  activeTab === tab.key
                    ? "text-accent/60"
                    : "text-text-muted/50"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Divider below tabs */}
      <div className="mx-2 border-t border-border shrink-0" />

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {isEmpty ? (
          <div className="flex items-center justify-center h-16 text-sm text-text-muted">
            {t("chat.slashNoMatch")}
          </div>
        ) : (
          displayItems.map((item, idx) => {
            if (item.category === "command") {
              const isExtension = item.command.source === "extension";
              return (
                <MenuItem
                  key={`cmd:${item.command.name}`}
                  index={idx}
                  selectedIndex={selectedIndex}
                  onSelect={() => onSelect(item)}
                  label={item.command.name}
                  description={item.command.description}
                  icon={
                    isExtension ? (
                      <Package className="w-4 h-4 text-text-muted flex-shrink-0" />
                    ) : (
                      <Zap className="w-4 h-4 text-accent flex-shrink-0" />
                    )
                  }
                  badge={
                    isExtension ? (
                      <span className={MENU_BADGE_CLASS}>
                        {t("slash.pluginCommand")}
                      </span>
                    ) : activeTab === "all" ? (
                      <span className={MENU_BADGE_CLASS}>
                        {t("chat.slashTabCommands")}
                      </span>
                    ) : undefined
                  }
                />
              );
            }
            const skill = skills.find((s) => s.name === item.skill.name);
            const type = skill?.type ?? "builtin";
            return (
              <MenuItem
                key={`skill:${item.skill.name}`}
                index={idx}
                selectedIndex={selectedIndex}
                onSelect={() => onSelect(item)}
                label={item.skill.name}
                description={item.skill.description}
                icon={
                  <Sparkles className="w-4 h-4 text-text-muted flex-shrink-0" />
                }
                badge={
                  <span className={MENU_BADGE_CLASS}>
                    {skillTypeLabel(type, t)}
                  </span>
                }
              />
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─── Tiny internal: a single menu item row ─── */

/** 统一到共享 token；保留本地别名，调用点不必逐个改。 */
const ITEM_BASE_CLASS = MENU_ITEM_CLASS;

function MenuItem({
  index,
  selectedIndex,
  onSelect,
  label,
  description,
  icon,
  badge,
}: {
  index: number;
  selectedIndex: number;
  onSelect: () => void;
  label: string;
  description?: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      className={`${ITEM_BASE_CLASS} ${
        index === selectedIndex
          ? MENU_ITEM_SELECTED_CLASS
          : MENU_ITEM_DEFAULT_CLASS
      }`}
    >
      {icon}
      <span className="flex-1 truncate">
        {label}
        {description ? (
          <span className="text-xs text-text-muted hidden sm:inline">
            {" "}
            — {description}
          </span>
        ) : (
          ""
        )}
      </span>
      {badge}
    </button>
  );
}

/**
 * 菜单徽章：中性灰字，不带上色、不带给色底、不带图标。
 *
 * 三类徽章（内置命令「命令」/ 扩展「插件命令」/ 技能类型 builtin·mcp·custom·agent）
 * 必须是同一个元素形态：只有文字。来源分类（命令 / 插件命令 / 技能）由同一行的
 * 行图标承载（`zap` / `package` / `sparkles`）；技能类型只由这段文字承载。
 * 徽章里再塞一个类型图标会让三类徽章结构不一致 —— 那是上一次改动漏掉的另一半。
 *
 * 10px 字号下多色相的 `/10` 底在浅色主题里几乎不可辨，且 `warning`/`accent`
 * 在本项目别处另有「警告 / 主色」语义，继续上色会让同一个颜色表示两件事。
 * 原 `px-1.5 py-0.5 rounded` 里 `py-0.5` 与 `rounded` 在无底色时是空操作；
 * `gap-1` 只服务于已删除的类型图标 —— 一并去掉。`inline-flex items-center`
 * **保留**：本次只改"有没有子元素"，不动盒模型，避免把"统一"变成"重排"。
 *
 * 用 `text-text-secondary` 而不是 `text-text-muted`：后者在本仓 14 套主题变量下
 * 实测对比度只有 2.45–4.59:1，10px 小字达不到 AA 4.5:1；secondary 是 6.19–8.33:1。
 * 常量放在文件尾部是为了遵守 `AGENTS.md` §5 的提示词缓存约定（只在尾部追加）。
 */
const MENU_BADGE_CLASS =
  "inline-flex items-center text-[10px] text-text-secondary px-1.5";

/**
 * 技能类型的展示文案。
 *
 * 枚举值（builtin / mcp / custom / agent）只在数据层用；直接渲染它会让中文界面里
 * 出现四个英文词（去掉类型图标后，文字成了技能类型的唯一载体，这一点才暴露出来）。
 * 文案复用设置页已有的「来源」译法，避免同一个概念出现两套译法；MCP 是专有名词，
 * 两种语言同形。首参写成字面量是为了让 `src/tests/i18n/renderer-i18n-keys.test.ts`
 * 能守住「代码里用了、语言包里没有」这一类问题。
 */
function skillTypeLabel(
  type: Skill["type"],
  t: (key: string) => string,
): string {
  switch (type) {
    case "builtin":
      return t("skillMarket.sourceBuiltin");
    case "mcp":
      return t("skillMarket.sourceMcp");
    case "custom":
      return t("skillMarket.sourceCustom");
    case "agent":
      return t("skillMarket.sourceAI");
  }
}
