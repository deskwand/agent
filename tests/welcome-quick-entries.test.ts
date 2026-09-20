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

  it('10 个入口，8 技能 2 工具', () => {
    expect(WELCOME_QUICK_ENTRIES.length).toBe(10);
    expect(
      WELCOME_QUICK_ENTRIES.filter((e) => e.kind === 'skill').length,
    ).toBe(8);
    expect(
      WELCOME_QUICK_ENTRIES.filter((e) => e.kind === 'tool').length,
    ).toBe(2);
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

});

describe('visibleQuickEntries 过滤', () => {
  it('技能启用且视觉可用时，10 个入口全在', () => {
    expect(
      visibleQuickEntries(WELCOME_QUICK_ENTRIES, allSkillNames(), true).length,
    ).toBe(10);
  });

  it('被禁用的技能，它的入口不出现 —— 否则会插入 pi 不展开的令牌', () => {
    const enabled = allSkillNames();
    enabled.delete('pdf');
    const visible = visibleQuickEntries(WELCOME_QUICK_ENTRIES, enabled, true);
    expect(visible.some((e) => e.id === 'pdf')).toBe(false);
    expect(visible.some((e) => e.id === 'office')).toBe(true);
  });

  it('视觉不可用时「看图」不出现', () => {
    const visible = visibleQuickEntries(
      WELCOME_QUICK_ENTRIES,
      allSkillNames(),
      false,
    );
    expect(visible.some((e) => e.id === 'vision')).toBe(false);
    expect(visible.some((e) => e.id === 'browser')).toBe(true);
  });

  it('技能全禁用时只剩两个工具入口', () => {
    const visible = visibleQuickEntries(WELCOME_QUICK_ENTRIES, new Set(), true);
    expect(visible.map((e) => e.id).sort()).toEqual(['browser', 'vision']);
  });

  it('技能全禁用且视觉不可用时只剩「操作浏览器」', () => {
    const visible = visibleQuickEntries(
      WELCOME_QUICK_ENTRIES,
      new Set(),
      false,
    );
    expect(visible.map((e) => e.id)).toEqual(['browser']);
  });
});
