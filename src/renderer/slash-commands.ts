import type { PiCommandDto } from "../shared/ipc-types";

/** Built-in slash commands for the chat input. */
export interface SlashCommand {
  name: string;
  label: string;
  description: string;
  action: "compact" | "goal" | "extension" | "prompt";
  source: "builtin" | "extension" | "prompt";
  /** 自定义命令的显示名（frontmatter display_name）；菜单行与 chip 优先用它 */
  displayName?: string;
}

export type SlashItem =
  | { category: "command"; command: SlashCommand }
  | { category: "skill"; skill: { name: string; description?: string } };

export function getBuiltinCommands(t: (key: string) => string): SlashCommand[] {
  return [
    {
      name: "compact",
      label: t("slash.compact"),
      description: t("slash.compactDesc"),
      action: "compact",
      source: "builtin",
    },
    {
      name: "goal",
      label: t("slash.goal"),
      description: t("slash.goalDesc"),
      action: "goal",
      source: "builtin",
    },
  ];
}

/**
 * Filter commands by exact name prefix, or by a substring of the display name.
 *
 * slug 仍走前缀匹配（插件命令 `/plan` 要赢过名字里带 plan 的技能）；
 * 显示名只在有 displayName 时参与**子串**匹配 —— 中文显示名不可能用前缀打出来。
 */
export function filterCommands(
  commands: SlashCommand[],
  filter: string,
): SlashCommand[] {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) return commands;
  return commands.filter(
    (c) =>
      c.name.toLowerCase().startsWith(normalized) ||
      (c.displayName ?? "").toLowerCase().includes(normalized),
  );
}

/** Map unified command registry entries (PiCommandDto) to slash commands. */
export function toSlashCommands(piCommands: PiCommandDto[]): SlashCommand[] {
  return piCommands.map((c) => ({
    name: c.name,
    // `label` 全仓没有任何消费者（SlashMenu 渲染的是 displayName || name，
    // 而 getBuiltinCommands 里那个 label 也一直是死数据）。这里保持原样，
    // 不顺手改成显示名 —— 那是一个运行时零效果的改动。
    label: c.name,
    description: c.description ?? "",
    action:
      c.source === "extension"
        ? "extension"
        : c.source === "prompt"
          ? "prompt"
          : c.name === "compact"
            ? "compact"
            : "goal",
    source: c.source,
    displayName: c.displayName,
  }));
}

/**
 * Merge builtin + extension commands for the slash menu. Builtin commands win
 * on name collision (mirrors the main-process registry dedup), so a plugin
 * can never shadow `/compact` or `/goal`.
 */
export function mergeSlashCommands(
  builtin: SlashCommand[],
  extension: SlashCommand[],
): SlashCommand[] {
  const byName = new Map<string, SlashCommand>();
  for (const cmd of builtin) byName.set(cmd.name, cmd);
  for (const cmd of extension) {
    if (!byName.has(cmd.name)) byName.set(cmd.name, cmd);
  }
  return [...byName.values()];
}
