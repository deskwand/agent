import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 内置 superpowers 技能包的全部技能名（上游 obra/superpowers 的 v6.4.1）。
 *
 * 这份清单刻意 pin 死在测试里，而不是从目录里读出来：引用可能是裸反引号形式的
 * `` `writing-skills` ``，光看引用本身无法判断它指向哪个技能。把技能名当权威清单，
 * 删掉任一目录都会被第一个用例直接抓到，与它被如何引用无关。
 */
const PACK_SKILLS = [
  'brainstorming',
  'diagnosing-superpowers',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
];

/**
 * 可能承载技能引用的文本后缀。
 *
 * 技能包还带 `.xsd`（3MB 的 Office 架构文件）、`.ttf`、`.gz`，这些不是指导性内容，
 * 扫它们只增加耗时；而 `.sh`/`.js`/`.dot` 是实际会被 agent 执行的正文，必须扫。
 */
const TEXT_EXTENSIONS = [
  '.md',
  '.sh',
  '.js',
  '.dot',
  '.py',
  '.txt',
  '.json',
  '.xml',
];

const skillsRoot = path.resolve(process.cwd(), '.deskwand/skills');

function isSkillDirectory(name: string): boolean {
  try {
    return fs.statSync(path.join(skillsRoot, name)).isDirectory();
  } catch {
    return false;
  }
}

function collectTextFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTextFiles(full));
    else if (
      entry.isFile() &&
      TEXT_EXTENSIONS.includes(path.extname(entry.name))
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 技能引用的两种真实写法。
 *
 * 只认前缀形式 `superpowers:name` 会漏掉一大类边：`using-superpowers/references/
 * codex-tools.md` 里写的是 `` `dispatching-parallel-agents` ``，
 * `subagent-driven-development/SKILL.md` 里写的是 `` `finishing-a-development-branch` ``。
 * 裸反引号形式按 PACK_SKILLS 白名单收窄，避免把普通代码词当成引用。
 */
function referencedSkills(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(/superpowers:([a-z0-9-]+)/g)) {
    names.add(match[1]);
  }
  for (const match of content.matchAll(/`([a-z0-9-]+)`/g)) {
    if (PACK_SKILLS.includes(match[1])) names.add(match[1]);
  }
  return [...names];
}

describe('内置技能引用闭合', () => {
  it('工作目录下有技能根目录（否则下面的断言会退化成空集）', () => {
    expect(fs.existsSync(skillsRoot)).toBe(true);
  });

  it('superpowers 技能包的 15 个目录齐备', () => {
    const missing = PACK_SKILLS.filter((name) => !isSkillDirectory(name));
    expect(missing).toEqual([]);
  });

  it('每个技能引用都指向存在的技能目录', () => {
    const dangling: string[] = [];
    for (const file of collectTextFiles(skillsRoot)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const name of referencedSkills(content)) {
        if (!isSkillDirectory(name)) {
          dangling.push(`${path.relative(skillsRoot, file)} → ${name}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });
});
