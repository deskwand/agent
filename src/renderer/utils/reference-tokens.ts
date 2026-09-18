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
};

/** 内置命令。扩展命令（插件命令）由调用方通过 extraCommands 传入。 */
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
  extraCommands: ReadonlySet<string> = new Set<string>(),
): ReferenceTokenSegment | null {
  if (text.startsWith("/skill:")) {
    const match = SKILL_PATTERN.exec(text);
    if (!match) return null;
    return { kind: "skill", name: match[1], raw: match[0] };
  }

  if (text.startsWith("/")) {
    const match = COMMAND_PATTERN.exec(text);
    if (!match) return null;
    const name = match[1];
    if (!BUILTIN_COMMAND_NAMES.has(name) && !extraCommands.has(name)) {
      return null;
    }
    return { kind: "command", name, raw: match[0] };
  }

  return null;
}
