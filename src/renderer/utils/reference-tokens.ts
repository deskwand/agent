// 行首引用 token 的判定。
//
// 为什么只认行首：pi 的 skill / prompt-template 展开都是 startsWith 判定 ——
//   dist/core/agent-session.js  `if (!text.startsWith("/skill:")) return text;`
//   dist/core/prompt-templates.js `if (!text.startsWith("/")) return text;`
// 句中出现的 `/skill:x` 不会被展开，渲染成"技能已生效"的 chip 是在骗用户。
//
// 为什么技能不查名单、命令必须查：`/skill:` 前缀本身不会误伤普通文本；而 `/` 开头的
// 小写单词在行首照样可能是普通文本（"详见 /tmp 目录"），只有白名单能区分。

export type ReferenceTokenSegment = {
  kind: "skill" | "command";
  /** 技能 = 去掉 /skill: 前缀后的名字；命令 = 名字本身 */
  name: string;
  /** 原文片段，用于序列化回纯文本与计算剩余文本 */
  raw: string;
  /**
   * 显示文本。技能 = 纯名字；命令 = 显示名（frontmatter display_name），
   * 没有显示名时**回退到 raw**（含斜杠）—— 回退成 name 会让所有内置/扩展命令的
   * chip 从 `/compact` 变成 `compact`，那是回归。
   */
  label: string;
};

/** 内置命令。扩展命令与自定义命令由调用方通过 commandLabels 传入。 */
export const BUILTIN_COMMAND_NAMES: ReadonlySet<string> = new Set([
  "compact",
  "goal",
]);

const SKILL_PATTERN = /^\/skill:(\S+)/;
const COMMAND_PATTERN = /^\/(\S+)/;

/**
 * 取 text **开头**的引用 token；不是引用就返回 null。
 *
 * 调用方用 `text.slice(token.raw.length)` 得到剩余文本 —— token.raw 后面通常跟着
 * 一个空格，那段属于剩余文本，不吞掉。
 */
export function resolveLeadingToken(
  text: string,
  commandLabels: ReadonlyMap<string, string> = new Map<string, string>(),
): ReferenceTokenSegment | null {
  if (text.startsWith("/skill:")) {
    const match = SKILL_PATTERN.exec(text);
    if (!match) return null;
    return { kind: "skill", name: match[1], raw: match[0], label: match[1] };
  }

  if (text.startsWith("/")) {
    const match = COMMAND_PATTERN.exec(text);
    if (!match) return null;
    const name = match[1];
    const label = commandLabels.get(name);
    if (!BUILTIN_COMMAND_NAMES.has(name) && label === undefined) {
      return null;
    }
    return { kind: "command", name, raw: match[0], label: label ?? match[0] };
  }

  return null;
}

/**
 * 剥掉行首的技能令牌，返回剩余正文。
 *
 * 行首技能令牌属于「修饰」而不是「内容」：一条只有 `/skill:x` 的消息没有任何
 * 需求，不该允许发送。判断落在本文件而不是调用方，是因为「什么算行首令牌」的
 * 规则已经在这里（见文件头：pi 的展开是 startsWith 判定，所以只有行首才算）。
 *
 * 命令**不在**此列：`/goal` 单独发是合法的（goal 扩展靠它启动循环），
 * `/compact` 单独触发动作。两者都必须继续被当成内容。
 *
 * 注意技能名**不被校验**（与 `resolveLeadingToken` 一致：pi 的展开也不查名单）。
 * 手敲 `/skill:不存在的名字` 依旧算内容，也依旧会渲染成令牌 —— 这是既有契约，
 * 不是本函数引入的；chip 那侧靠 `visibleQuickEntries` 只列已启用技能来避开它。
 */
export function stripLeadingSkillToken(text: string): string {
  if (!text.startsWith("/skill:")) return text;
  const match = SKILL_PATTERN.exec(text);
  if (!match) return text;
  return text.slice(match[0].length);
}
