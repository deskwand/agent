import type { PiCommandDto } from "../shared/ipc-types";

/** Built-in slash commands for the chat input. */
export interface SlashCommand {
  name: string;
  label: string;
  description: string;
  action: "compact" | "goal" | "extension";
  source: "builtin" | "extension";
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
 * Filter commands by exact name prefix. Commands are matched on the command
 * name only — unlike skills (substring match), a command must start with the
 * filter so a plugin command like `/plan` wins over a skill that merely
 * contains "plan" later in its name.
 */
export function filterCommands(
  commands: SlashCommand[],
  filter: string,
): SlashCommand[] {
  const normalized = filter.toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(normalized));
}

/** Map unified command registry entries (PiCommandDto) to slash commands. */
export function toSlashCommands(piCommands: PiCommandDto[]): SlashCommand[] {
  return piCommands.map((c) => ({
    name: c.name,
    label: c.name,
    description: c.description ?? "",
    action:
      c.source === "extension"
        ? "extension"
        : c.name === "compact"
          ? "compact"
          : "goal",
    source: c.source,
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
