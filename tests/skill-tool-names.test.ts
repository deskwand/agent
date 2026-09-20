import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const skillsRoot = path.resolve(process.cwd(), '.deskwand/skills');

function allSkillMarkdown(): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (fs.existsSync(file)) out.push(file);
  }
  return out;
}

describe('内置技能引用的工具名', () => {
  // 射程刻意很窄：只查顶层技能目录的 SKILL.md 里有没有那个不存在的工具名。
  // 它拦不住同一个技能里其它形式的虚构（max_chars、has_more、用 read 分页），
  // 那些靠人读。不扫 references/*.md 是因为那里 web_fetch 是别的 runtime
  // （Gemini CLI、Muse）的真实工具名，改它反而制造 bug。
  it('不出现不存在的 web_fetch 工具名', () => {
    const offenders = allSkillMarkdown()
      .filter((file) => fs.readFileSync(file, 'utf8').includes('web_fetch'))
      .map((file) => path.relative(skillsRoot, file));
    expect(offenders).toEqual([]);
  });
});
