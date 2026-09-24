/**
 * @module renderer/pinned-skills
 *
 * 「+」菜单常用技能（星标）的本机存储与排序规则。
 *
 * 星标是一个**有序数组**：顺序只在用户点星/取消星时变化，使用、时间、频率都不
 * 参与重排 —— 「固定位置」的全部含义就在这里。与 `slash-recency.ts`、
 * `deskwand.sidebarPins` 一样存 localStorage：本机数据，不上云。
 */

const PINNED_SKILLS_STORAGE_KEY = "deskwand.pinnedSkills";

/** `slashRecency` 里技能记录的 key 前缀（与 slash-recency.ts 的约定一致）。 */
const SKILL_RECENCY_PREFIX = "skill:";

/** 「+」菜单技能组最多显示几行。星标本身不限量，超出的不上榜。 */
export const MAX_VISIBLE_SKILLS = 5;

/** 读取星标列表。保序、去重；localStorage 被禁用、内容损坏、类型不对一律返回 []。 */
export function loadPinnedSkills(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_SKILLS_STORAGE_KEY);
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
 * 切换星标：有则移除、无则追加到**末尾**（末尾 = 最新固定 = 排在最后一名）。
 * 返回新数组，调用方用它 setState；写存储失败也返回新数组（这次切换在内存里生效）。
 *
 * 为什么不需要事件订阅（跨两个菜单同步）：点星的那一下必然把另一个菜单关掉 ——
 * ChatInput 与 AttachMenu 各自监听 document mousedown 关闭自己，而两个面板各自
 * 含在自己的 ref 内（ChatInput.tsx:493、AttachMenu.tsx:275）。所以不存在
 * "两个菜单同时显示不同星标状态"这种可观察状态；跨时间的保鲜由"每次打开菜单
 * 重读一次"负责。
 */
export function togglePinnedSkill(name: string): string[] {
  const current = loadPinnedSkills();
  const next = current.includes(name)
    ? current.filter((entry) => entry !== name)
    : [...current, name];
  try {
    localStorage.setItem(PINNED_SKILLS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage 满或被禁用：内存里的这次切换仍然生效 */
  }
  return next;
}

/**
 * 组装「+」菜单技能组的行：
 *
 *   星标（过滤不可用与重复 → 取前 MAX_VISIBLE_SKILLS，保持加入顺序）
 *   ++ 最近调用（倒序，排除已上榜与不可用的）   ← 只填到 MAX_VISIBLE_SKILLS
 *
 * `pinnedAvailable` 是**可用**星标总数，即标题右侧 `5/7` 的分母：禁用/已删除的
 * 技能不计入分母，否则用户会看到 5/7 却只找得到 5 个可用技能。它必须在这里算，
 * 免得组件里再复制一遍"跳过不可用"的过滤规则。去重也在这里做：重复项会白占名额、
 * 还会渲染出两个同 key 的行。
 */
export function composeSkillShortcuts({
  pinned,
  enabledNames,
  recency,
}: {
  pinned: string[];
  enabledNames: ReadonlySet<string>;
  recency: Record<string, number>;
}): { names: string[]; pinnedAvailable: number } {
  const seenPinned = new Set<string>();
  const availablePinned = pinned.filter((name) => {
    if (!enabledNames.has(name) || seenPinned.has(name)) return false;
    seenPinned.add(name);
    return true;
  });
  const names = availablePinned.slice(0, MAX_VISIBLE_SKILLS);
  const taken = new Set(names);

  const recent = Object.entries(recency)
    .map(([key, at]) => ({
      name: key.startsWith(SKILL_RECENCY_PREFIX)
        ? key.slice(SKILL_RECENCY_PREFIX.length)
        : null,
      at: typeof at === "number" ? at : 0,
    }))
    .filter(
      (entry): entry is { name: string; at: number } => entry.name !== null,
    )
    .sort((a, b) => b.at - a.at);

  for (const entry of recent) {
    if (names.length >= MAX_VISIBLE_SKILLS) break;
    if (taken.has(entry.name) || !enabledNames.has(entry.name)) continue;
    taken.add(entry.name);
    names.push(entry.name);
  }

  return { names, pinnedAvailable: availablePinned.length };
}
