/**
 * 交给 pi 的技能来源。
 *
 * 返回的是**每个已启用技能各自的目录**（不是父目录）：pi 只扫描这些目录，
 * 于是技能页里的启用/禁用开关真正决定模型能看到什么。
 *
 * 异步是刻意的：global 与 vault 两个来源要「读取即刷新」（与 `listSkills()` 同款），
 * 同步接口会让启动后尚未加载的全局技能静默消失。
 */
export interface SkillsAdapter {
  getSkillPaths(): Promise<string[]>;
}
