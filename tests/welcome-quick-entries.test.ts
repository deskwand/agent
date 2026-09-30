import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import en from '../src/renderer/i18n/locales/en.json';
import zh from '../src/renderer/i18n/locales/zh.json';
import {
  WELCOME_QUICK_ENTRIES,
  visibleQuickEntries,
} from '../src/renderer/welcome-quick-entries';

const skillsRoot = path.resolve(process.cwd(), '.deskwand/skills');

type Json = Record<string, unknown>;

/** 把 "welcome.quick.office" 解析成语言包里的值，找不到返回 undefined */
function lookup(locale: Json, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Json)[part] : undefined,
      locale,
    );
}

/** 全部技能类入口引用的技能名，便于构造「部分/全部禁用」的场景 */
function allSkillNames(): Set<string> {
  const names = new Set<string>();
  for (const entry of WELCOME_QUICK_ENTRIES) {
    if (entry.kind === 'skill') names.add(entry.skill);
  }
  return names;
}

describe('欢迎页快捷入口数据', () => {
  it('id 唯一', () => {
    const ids = WELCOME_QUICK_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('5 个入口，4 技能 1 工具', () => {
    expect(WELCOME_QUICK_ENTRIES.length).toBe(5);
    expect(
      WELCOME_QUICK_ENTRIES.filter((e) => e.kind === 'skill').length,
    ).toBe(4);
    expect(
      WELCOME_QUICK_ENTRIES.filter((e) => e.kind === 'tool').length,
    ).toBe(1);
  });

  // 图标是这 5 个入口唯一的「它们不是同一件事」的视觉信号。两个入口共用同一个
  // 图标 = 那一对等于没带信息，比不放图标更糟：它谎称两者同类。
  it('5 个入口的图标互不相同', () => {
    const icons = WELCOME_QUICK_ENTRIES.map((e) => e.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('每个技能入口的技能名真实存在于内置技能目录', () => {
    const missing = WELCOME_QUICK_ENTRIES.filter(
      (e) =>
        e.kind === 'skill' &&
        !fs.existsSync(path.join(skillsRoot, e.skill, 'SKILL.md')),
    ).map((e) => (e.kind === 'skill' ? e.skill : ''));
    expect(missing).toEqual([]);
  });

  it('每个工具入口都有示例提示词 key', () => {
    for (const entry of WELCOME_QUICK_ENTRIES) {
      if (entry.kind !== 'tool') continue;
      expect(entry.promptKey).toMatch(/^welcome\./);
    }
  });

  it('全部 label key 在 zh 与 en 里都存在', () => {
    for (const entry of WELCOME_QUICK_ENTRIES) {
      expect(lookup(zh as Json, entry.labelKey), `zh 缺 ${entry.labelKey}`)
        .toBeTypeOf('string');
      expect(lookup(en as Json, entry.labelKey), `en 缺 ${entry.labelKey}`)
        .toBeTypeOf('string');
    }
  });

  it('全部工具示例提示词 key 在 zh 与 en 里都存在', () => {
    for (const entry of WELCOME_QUICK_ENTRIES) {
      if (entry.kind !== 'tool') continue;
      expect(lookup(zh as Json, entry.promptKey)).toBeTypeOf('string');
      expect(lookup(en as Json, entry.promptKey)).toBeTypeOf('string');
    }
  });

  // 未配置态首屏收敛用的文案。键落在文件尾部的 connect 对象下（不是 welcome.*）——
  // 见 design-docs/2026-09-27-first-run-converged-welcome-plan.md 的 Global Constraints。
  it('收敛态文案的 key 在 zh 与 en 里都存在且非空', () => {
    const keys = ['connect.capabilitySummary', 'connect.startPlaceholder'];
    for (const key of keys) {
      expect(lookup(zh as Json, key), `zh 缺 ${key}`).toBeTypeOf('string');
      expect(lookup(en as Json, key), `en 缺 ${key}`).toBeTypeOf('string');
      expect(lookup(zh as Json, key), `zh 的 ${key} 是空串`).not.toBe('');
      expect(lookup(en as Json, key), `en 的 ${key} 是空串`).not.toBe('');
    }
  });

});

describe('visibleQuickEntries 过滤', () => {
  it('技能启用且视觉可用时，5 个入口全在', () => {
    expect(
      visibleQuickEntries(WELCOME_QUICK_ENTRIES, allSkillNames(), true).length,
    ).toBe(5);
  });

  it('被禁用的技能，它的入口不出现 —— 否则会插入 pi 不展开的令牌', () => {
    const enabled = allSkillNames();
    // allSkillNames 收的是技能名（brainstorming / systematic-debugging / officecli /
    // web-search），不是入口 id。名字写错时 delete 会安静地返回 false，这条守卫就
    // 退化成恒真 —— 所以断言 delete 真的命中过。
    expect(enabled.delete('web-search')).toBe(true);
    const visible = visibleQuickEntries(WELCOME_QUICK_ENTRIES, enabled, true);
    expect(visible.some((e) => e.id === 'web')).toBe(false);
    expect(visible.some((e) => e.id === 'office')).toBe(true);
  });

  it('视觉不可用时只隐藏「看图」，其余 4 个仍在', () => {
    const visible = visibleQuickEntries(
      WELCOME_QUICK_ENTRIES,
      allSkillNames(),
      false,
    );
    expect(visible.map((e) => e.id)).toEqual([
      'brainstorm',
      'debug',
      'office',
      'web',
    ]);
  });

  it('技能全禁用时只剩「看图」', () => {
    const visible = visibleQuickEntries(WELCOME_QUICK_ENTRIES, new Set(), true);
    expect(visible.map((e) => e.id)).toEqual(['vision']);
  });

  // 行为变化：收敛前 browser 是无条件存在的兜底，任何状态下 chip 行都至少有 1 个
  // 入口；现在没有了。这一态（用户禁掉全部相关技能且没配视觉模型）极罕见，且
  // WelcomeView 用 `visibleEntries.length > 0` 兜住了空数组 —— 整行不渲染，页面
  // 其余部分照旧。硬塞一个入口比留白更乱。
  it('技能全禁用且视觉不可用时没有入口', () => {
    const visible = visibleQuickEntries(
      WELCOME_QUICK_ENTRIES,
      new Set(),
      false,
    );
    expect(visible).toEqual([]);
  });
});
