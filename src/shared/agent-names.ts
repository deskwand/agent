/**
 * 子代理趣味名称 —— 名单、校验与显示映射（主进程与渲染层共用，纯函数、无副作用）。
 *
 * 名字本身由大模型在 spawn 时通过 Agent 工具的 `name` 参数给出，这里只做三件事：
 * 1. 校验它是不是可用的 ASCII slug。插件的 handleBase() 会把非 [a-z0-9_-] 一律替换成
 *    "-"（node_modules/@tintinweb/pi-subagents/dist/mention.js:46-53），`name: "图灵"`
 *    会被 slug 成空、回退成 "agent"，等于没起名。
 * 2. 缺失或非法时从下面这份小名单里随机补一个：只保证「不会没名字」，
 *    多样性的主力仍然是模型自己取名。
 * 3. 界面显示用的中文映射；模型自起的名字不在表里，调用方原样显示 alias。
 */

export const FALLBACK_AGENT_NAMES: ReadonlyArray<{
  alias: string;
  zh: string;
}> = [
  { alias: "turing", zh: "图灵" },
  { alias: "curie", zh: "居里" },
  { alias: "lovelace", zh: "勒芙蕾丝" },
  { alias: "darwin", zh: "达尔文" },
  { alias: "euler", zh: "欧拉" },
  { alias: "tesla", zh: "特斯拉" },
  { alias: "hopper", zh: "霍珀" },
  { alias: "noether", zh: "诺特" },
  { alias: "euclid", zh: "欧几里得" },
  { alias: "hypatia", zh: "希帕蒂娅" },
];

const VALID_AGENT_NAME = /^[a-z0-9][a-z0-9_-]*$/;

export function isValidAgentName(name: unknown): name is string {
  return typeof name === "string" && VALID_AGENT_NAME.test(name.toLowerCase());
}

export function pickFallbackAgentName(
  random: () => number = Math.random,
): string {
  const index = Math.floor(random() * FALLBACK_AGENT_NAMES.length);
  const safe = Math.min(Math.max(index, 0), FALLBACK_AGENT_NAMES.length - 1);
  return FALLBACK_AGENT_NAMES[safe].alias;
}

/** 中文界面下的显示名；表外名字返回 undefined，调用方回落 alias。 */
export function agentNameZhLabel(
  alias: string | undefined,
): string | undefined {
  if (!alias) return undefined;
  return FALLBACK_AGENT_NAMES.find((n) => n.alias === alias.toLowerCase())?.zh;
}
