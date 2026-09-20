/**
 * 邮箱 → 头像首字母。
 *
 * 取 local-part，按 [._-] 分段，取前两段的首字符大写拼接；
 * 单段只取一个字符；空串返回空串（由调用方决定是否回退到图标）。
 */
export function avatarInitials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0].charAt(0).toUpperCase();
  const second = parts.length > 1 ? parts[1].charAt(0).toUpperCase() : "";
  return first + second;
}
