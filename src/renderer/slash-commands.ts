/** Built-in slash commands for the chat input. */
export interface SlashCommand {
  name: string;
  label: string;
  description: string;
  action: "compact" | "goal";
}

export type SlashItem =
  | { category: "command"; command: SlashCommand }
  | { category: "skill"; skill: { name: string; description?: string } };

export function getBuiltinCommands(
  t: (key: string) => string,
): SlashCommand[] {
  return [
    {
      name: "compact",
      label: t("slash.compact"),
      description: t("slash.compactDesc"),
      action: "compact",
    },
    {
      name: "goal",
      label: t("slash.goal"),
      description: t("slash.goalDesc"),
      action: "goal",
    },
  ];
}
