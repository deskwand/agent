import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bot, List, Package, Pencil, Plug, Sparkles, Zap } from "lucide-react";
import type { Skill } from "../types";
import type { SlashCommand, SlashItem } from "../slash-commands";

export type SlashTab = "all" | "commands" | "skills";

interface SlashMenuProps {
  commands: SlashCommand[];
  skills: Skill[];
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

const SKILL_TYPE_BACKGROUNDS: Record<Skill["type"], string> = {
  builtin: "bg-accent/10",
  mcp: "bg-mcp/10",
  custom: "bg-success/10",
  agent: "bg-warning/10",
};

const SKILL_TYPE_ICONS: Record<Skill["type"], typeof Package> = {
  builtin: Package,
  mcp: Plug,
  custom: Pencil,
  agent: Bot,
};

function SkillTypeBadge({ type }: { type: Skill["type"] }) {
  const SkillTypeIcon = SKILL_TYPE_ICONS[type];

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] text-text-muted px-1.5 py-0.5 rounded ${SKILL_TYPE_BACKGROUNDS[type] ?? "bg-surface-muted"}`}
    >
      {SkillTypeIcon && <SkillTypeIcon className="w-3 h-3 text-text-muted" />}
      {type}
    </span>
  );
}

export const SLASH_MENU_CONTAINER_CLASS =
  "absolute left-0 right-0 z-30 rounded-xl border border-border bg-background shadow-soft flex flex-col h-[28rem] max-h-[60vh]";

export function SlashMenu({
  commands,
  skills,
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

  const allItems = [...commandItems, ...skillItems];

  const displayItems =
    activeTab === "all"
      ? allItems
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
          ? "top-[calc(100%+6px)]"
          : "bottom-[calc(100%+6px)]"
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
        ) : activeTab === "all" ? (
          /* Grouped view */
          <>
            {hasCommands && (
              <div className="mb-1">
                <div className="px-2.5 py-1 text-[11px] text-text-muted font-semibold uppercase tracking-wide">
                  {t("chat.slashTabCommands")} · {commandItems.length}
                </div>
                {commandItems.map((item, idx) => {
                  if (item.category !== "command") return null;
                  return (
                    <MenuItem
                      key={`cmd:${item.command.name}`}
                      index={idx}
                      selectedIndex={selectedIndex}
                      onSelect={() => onSelect(item)}
                      label={`/${item.command.name}`}
                      description={item.command.description}
                      icon={
                        <Zap className="w-4 h-4 text-accent flex-shrink-0" />
                      }
                      badge={
                        <span className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                          {t("chat.slashTabCommands")}
                        </span>
                      }
                    />
                  );
                })}
              </div>
            )}
            {hasCommands && hasSkills && (
              <div className="mx-2 my-1 border-t border-border" />
            )}
            {hasSkills && (
              <div className="mt-1">
                <div className="px-2.5 py-1 text-[11px] text-text-muted font-semibold uppercase tracking-wide">
                  {t("chat.slashTabSkills")} · {skillItems.length}
                </div>
                {skillItems.map((item, idx) => {
                  if (item.category !== "skill") return null;
                  const skill = skills.find((s) => s.name === item.skill.name);
                  const type = skill?.type ?? "builtin";
                  return (
                    <MenuItem
                      key={`skill:${item.skill.name}`}
                      index={commandItems.length + idx}
                      selectedIndex={selectedIndex}
                      onSelect={() => onSelect(item)}
                      label={`/skill:${item.skill.name}`}
                      description={item.skill.description}
                      icon={
                        <Sparkles className="w-4 h-4 text-text-muted flex-shrink-0" />
                      }
                      badge={<SkillTypeBadge type={type} />}
                    />
                  );
                })}
              </div>
            )}
          </>
        ) : (
          /* Single tab view */
          displayItems.map((item, idx) => {
            if (item.category === "command") {
              return (
                <MenuItem
                  key={`cmd:${item.command.name}`}
                  index={idx}
                  selectedIndex={selectedIndex}
                  onSelect={() => onSelect(item)}
                  label={`/${item.command.name}`}
                  description={item.command.description}
                  icon={<Zap className="w-4 h-4 text-accent flex-shrink-0" />}
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
                label={`/skill:${item.skill.name}`}
                description={item.skill.description}
                icon={
                  <Sparkles className="w-4 h-4 text-text-muted flex-shrink-0" />
                }
                badge={<SkillTypeBadge type={type} />}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─── Tiny internal: a single menu item row ─── */

const ITEM_BASE_CLASS =
  "w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors flex items-center gap-2";

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
          ? "bg-accent/10 text-accent"
          : "text-text-primary hover:bg-surface-hover"
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
