import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Zap, Sparkles } from "lucide-react";
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
}

const TAB_LIST: { key: SlashTab; i18n: string }[] = [
  { key: "all", i18n: "slashAll" },
  { key: "commands", i18n: "slashTabCommands" },
  { key: "skills", i18n: "slashTabSkills" },
];

const SKILL_TYPE_COLORS: Record<string, string> = {
  builtin: "text-accent bg-accent/10",
  mcp: "text-primary bg-primary/10",
  custom: "text-success bg-success/10",
  agent: "text-warning bg-warning/10",
};

const SKILL_TYPE_ICONS: Record<string, string> = {
  builtin: "📦",
  mcp: "🔌",
  custom: "✏️",
  agent: "🤖",
};

export const SLASH_MENU_CONTAINER_CLASS =
  "absolute left-0 right-0 bottom-[calc(100%+6px)] z-30 rounded-xl border border-border bg-background shadow-soft flex h-52";

export function SlashMenu({
  commands,
  skills,
  activeTab,
  selectedIndex,
  onSelect,
  onTabChange,
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
    <div className={SLASH_MENU_CONTAINER_CLASS}>
      {/* Left sidebar tabs */}
      <div className="flex flex-col gap-1 p-1.5 border-r border-border min-w-[72px] bg-surface-muted/50 rounded-l-xl">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onTabChange(tab.key);
            }}
            className={`px-2.5 py-2 rounded-lg text-xs font-medium text-center transition-colors ${
              activeTab === tab.key
                ? "bg-accent text-white"
                : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
            }`}
          >
            {tab.key === "all"
              ? t("chat.slashAll")
              : tab.key === "commands"
                ? t("chat.slashTabCommands")
                : t("chat.slashTabSkills")}
          </button>
        ))}
        {/* Spacer */}
        <div className="flex-1" />
        {/* Keyboard hint */}
        <div className="text-center text-[10px] text-text-muted leading-relaxed px-0.5">
          {t("chat.slashShortcutHint")}
        </div>
      </div>

      {/* Right content area */}
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
                    icon={<Zap className="w-4 h-4 text-accent flex-shrink-0" />}
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
                  const skill = skills.find(
                    (s) => s.name === item.skill.name,
                  );
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
                      badge={
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${SKILL_TYPE_COLORS[type] ?? "text-text-muted bg-surface-muted"}`}
                        >
                          {SKILL_TYPE_ICONS[type] ?? ""} {type}
                        </span>
                      }
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
                  icon={
                    <Zap className="w-4 h-4 text-accent flex-shrink-0" />
                  }
                />
              );
            }
            const skill = skills.find(
              (s) => s.name === item.skill.name,
            );
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
                badge={
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${SKILL_TYPE_COLORS[type] ?? "text-text-muted bg-surface-muted"}`}
                  >
                    {SKILL_TYPE_ICONS[type] ?? ""} {type}
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
      <span className="flex-1 truncate">{label}</span>
      {description && (
        <span className="text-xs text-text-muted truncate max-w-[12rem] hidden sm:inline">
          {description}
        </span>
      )}
      {badge}
    </button>
  );
}
