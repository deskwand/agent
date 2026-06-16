/** Built-in slash commands for the chat input. */
export interface SlashCommand {
  name: string;
  label: string;
  description: string;
  action: "compact";
}

// Re-export shared plugin slash types for convenience
export type {
  PluginSlashSkill,
  PluginSlashCommand,
  PluginSlashItems,
} from "../shared/ipc-types";

export const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: "compact",
    label: "压缩会话",
    description: "手动压缩当前会话上下文",
    action: "compact",
  },
];
