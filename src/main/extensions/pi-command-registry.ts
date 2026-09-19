/**
 * Unified command registry (builtin + extension commands).
 *
 * Pure functions only — no Electron/IPC dependencies — so the merge and
 * interception logic is unit-testable in isolation.
 */

export interface PiCommandEntry {
  name: string;
  description?: string;
  source: "builtin" | "extension" | "prompt";
  /** 提示词模板的显示名（frontmatter display_name），仅 source === "prompt" 可能有 */
  displayName?: string;
  /** 提示词模板位于全局 ~/.pi/agent/prompts —— 可在「+」菜单里编辑/删除 */
  editable?: boolean;
}

/** Builtin slash commands (compact/goal are intercepted elsewhere; listed for discovery/UI). */
export const BUILTIN_COMMANDS: PiCommandEntry[] = [
  { name: "compact", source: "builtin" },
  { name: "goal", source: "builtin" },
];

/**
 * Merge builtin + cached + host extension + prompt template commands into a single list.
 * 优先级严格按 pi 的执行顺序（agent-session.prompt）：
 *   扩展命令拦截 → /skill: → 模板展开
 * 同名时前者赢，模板永远不会展开 —— 所以 prompt 必须排最后，否则菜单会展示
 * 一条「点了没反应」的命令。Builtin 永远最高（输入框先拦截 compact/goal）。
 */
export function mergeCommandEntries(
  cached: PiCommandEntry[] | undefined,
  hostExt: PiCommandEntry[] | undefined,
  prompts?: PiCommandEntry[],
): PiCommandEntry[] {
  const merged = new Map<string, PiCommandEntry>();
  for (const cmd of BUILTIN_COMMANDS) merged.set(cmd.name, cmd);
  for (const cmd of cached ?? []) {
    if (!merged.has(cmd.name)) merged.set(cmd.name, cmd);
  }
  for (const cmd of hostExt ?? []) {
    if (!merged.has(cmd.name)) merged.set(cmd.name, cmd);
  }
  for (const cmd of prompts ?? []) {
    if (!merged.has(cmd.name)) merged.set(cmd.name, cmd);
  }
  return [...merged.values()];
}

/**
 * Return the extension command name matched by an exact slash-prefix, or null.
 * Builtin commands never match (they are intercepted elsewhere).
 */
export function isExtensionCommand(
  merged: PiCommandEntry[],
  prompt: string,
): string | null {
  if (!prompt.startsWith("/")) return null;
  const spaceIdx = prompt.indexOf(" ");
  const cmdName = spaceIdx > 0 ? prompt.slice(1, spaceIdx) : prompt.slice(1);
  const hit = merged.find((c) => c.source === "extension" && c.name === cmdName);
  return hit ? hit.name : null;
}

/**
 * 与 SDK ExtensionRunner.resolveRegisteredCommands 相同的重名后缀规则：
 * counts(name) > 1 → `${name}:${occurrence}`（occurrence 按注册顺序从 1 起），
 * 否则原样返回。DeskWand 拦截命中后用它把用户输入的命令名映射为 SDK
 * 实际可执行的 invocationName（重名时 host 原始名与 runner 名不一致）。
 */
export function resolveInvocationName(
  entries: { name: string }[],
  name: string,
): string {
  // 完整复刻 SDK ExtensionRunner.resolveRegisteredCommands：
  // 1) counts(name) > 1 → `${name}:${occurrence}`（occurrence 按注册顺序从 1 起）
  // 2) takenInvocationNames 次级去重：若某命令名与已分配的 invocationName
  //    撞名（如原始名 "plan:1" 抢先占用），后续同名命令后缀递增
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const takenInvocationNames = new Set<string>();
  for (const entry of entries) {
    const occurrence = (seen.get(entry.name) ?? 0) + 1;
    seen.set(entry.name, occurrence);
    let invocationName =
      (counts.get(entry.name) ?? 0) > 1 ? `${entry.name}:${occurrence}` : entry.name;
    if (takenInvocationNames.has(invocationName)) {
      let suffix = occurrence;
      do {
        suffix += 1;
        invocationName = `${entry.name}:${suffix}`;
      } while (takenInvocationNames.has(invocationName));
    }
    takenInvocationNames.add(invocationName);
    if (entry.name === name) return invocationName;
  }
  return name;
}

/**
 * 从会话快照（cached.extensionCommands）判断 prompt 是否命中扩展命令：
 * 命中时把用户输入的命令名映射为 SDK 实际可执行的 invocationName
 * （重名 → :occurrence 后缀，规则与 resolveInvocationName 一致）并保留
 * 参数部分；未命中返回 null。与 SDK runner 同源的会话快照命中 = SDK 必执行。
 */
export function buildInterceptedPrompt(
  extCmds: { name: string }[],
  prompt: string,
): { hit: string; finalPrompt: string } | null {
  if (!prompt.startsWith("/")) return null;
  const spaceIdx = prompt.indexOf(" ");
  const cmdName =
    spaceIdx > 0 ? prompt.slice(1, spaceIdx) : prompt.slice(1);
  const hit = extCmds.find((c) => c.name === cmdName)?.name ?? null;
  if (hit === null) return null;
  const rest = spaceIdx > 0 ? prompt.slice(spaceIdx) : "";
  return {
    hit,
    finalPrompt: `/${resolveInvocationName(extCmds, hit)}${rest}`,
  };
}
