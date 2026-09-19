/**
 * 自定义命令名的校验规则。
 *
 * 放在 shared 是因为两侧都要用：main 侧写文件前守门，renderer 侧做即时的表单反馈。
 * 两份实现必然漂移，而漂移的表现是「表单说没问题、保存失败」这一类难查的 bug。
 */

/** 长度上限：文件名过长在部分文件系统上会写入失败。 */
export const PROMPT_COMMAND_NAME_MAX_LENGTH = 64;

/**
 * 禁止出现的字符：
 * - 空白 —— pi 用 `/^\/([^\s]+)/` 切命令名，含空格的命令永远匹配不上
 * - `/` `\` —— 路径分隔符
 * - `:` `*` `?` `"` `<` `>` `|` —— Windows 保留字符（本应用要出 Windows 包）
 */
const INVALID_CHARS = /[\s/\\:*?"<>|]/;

/** 与内置命令同名的模板永远不会被展开（输入框会先拦截它们）。 */
export const RESERVED_PROMPT_COMMAND_NAMES: ReadonlySet<string> = new Set([
  "compact",
  "goal",
]);

export type PromptCommandNameError =
  | "empty"
  | "tooLong"
  | "invalidChars"
  | "leadingDot"
  | "reserved";

/** 返回 null 表示合法。 */
export function validatePromptCommandName(
  name: string,
): PromptCommandNameError | null {
  if (name.length === 0) return "empty";
  if (name.length > PROMPT_COMMAND_NAME_MAX_LENGTH) return "tooLong";
  if (INVALID_CHARS.test(name)) return "invalidChars";
  if (name.startsWith(".")) return "leadingDot";
  if (name.includes("..")) return "invalidChars";
  if (RESERVED_PROMPT_COMMAND_NAMES.has(name)) return "reserved";
  return null;
}
