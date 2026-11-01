/**
 * 队友（常驻智能体）的高风险能力目录：这三类工具可以绕开受控的发信工具对外联络，
 * 因此按队友单独开关。
 */
export type RiskyCapability = "shell" | "browser" | "computer";

export type RiskyCapabilities = Record<RiskyCapability, boolean>;

export const RISKY_CAPABILITIES: readonly RiskyCapability[] = [
  "shell",
  "browser",
  "computer",
];

export const ALL_RISKY_ENABLED: RiskyCapabilities = {
  shell: true,
  browser: true,
  computer: true,
};

export const ALL_RISKY_DISABLED: RiskyCapabilities = {
  shell: false,
  browser: false,
  computer: false,
};

const SHELL_TOOLS = new Set(["bash", "execute_command", "powershell"]);

/** 工具名（大小写不敏感）归属的高风险能力；非高风险工具返回 null。 */
export function riskyCapabilityOf(toolName: string): RiskyCapability | null {
  const name = toolName.toLowerCase();
  if (SHELL_TOOLS.has(name)) return "shell";
  if (name.startsWith("internal_browser_")) return "browser";
  if (name.startsWith("mcp__gui_operate__")) return "computer";
  return null;
}
