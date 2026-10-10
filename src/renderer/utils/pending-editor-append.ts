/**
 * 「发到当前会话」的拼接规则：草稿在前、想法在后，中间补一个换行。
 *
 * 单独抽成纯函数是因为它是这块唯一的语义 —— 追加不能变成覆盖，而覆盖会静默吃掉
 * 用户正在写的一半（ChatInput 里那个写回是不可逆的）。
 */
export function mergePendingAppend(current: string, append: string): string {
  if (!current.trim()) return append;
  return current.endsWith("\n")
    ? `${current}${append}`
    : `${current}\n${append}`;
}
