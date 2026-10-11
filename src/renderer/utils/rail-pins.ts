/**
 * @module renderer/utils/rail-pins
 *
 * 图标栏「更多」菜单里固定回栏上的项 —— 本机存储与顺序规则。
 *
 * 固定是一个**有序数组**：顺序只在用户点图钉时变化，使用频率/时间都不参与重排。
 * 后固定的排在末尾（= 栏上「更多」下方那一组的最后一个）。与 `deskwand.sidebarPins`、
 * `deskwand.pinnedSkills` 一样存 localStorage：本机数据，不上云。
 *
 * ⚠️ `toggleRailPin` **以调用方传来的当前数组为基准**，不重新读存储：存储可能写不进去
 *（配额满 / 隐私模式），此时内存里的 state 才是权威；若从存储重读，上一次切换会被静默
 * 吞掉（评审 2026-10-11 指出的两连击退化）。写盘只是 best-effort。
 */

const RAIL_PINS_STORAGE_KEY = "deskwand.railPins";

/** 读取固定列表。保序、去重；localStorage 被禁用、内容损坏、类型不对一律返回 []。 */
export function loadRailPins(): string[] {
  try {
    const raw = localStorage.getItem(RAIL_PINS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string" || entry === "" || seen.has(entry))
        continue;
      seen.add(entry);
      result.push(entry);
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * 切换固定：有则移除、无则追加到**末尾**（末尾 = 最新固定 = 排在最后一名）。
 * `current` 由调用方的 state 给出 —— 见文件头那条「不以存储为基准」的说明。
 * 返回新数组（调用方用它 setState）；写存储失败也返回新数组。
 */
export function toggleRailPin(key: string, current: string[]): string[] {
  const next = current.includes(key)
    ? current.filter((entry) => entry !== key)
    : [...current, key];
  try {
    localStorage.setItem(RAIL_PINS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage 满或被禁用：内存里的这次切换仍然生效 */
  }
  return next;
}
