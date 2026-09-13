import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8');
}

describe('message area file open routing', () => {
  it('routes the three ContentBlockView entry points to the built-in browser', () => {
    const source = read(
      '../src/renderer/components/message/ContentBlockView.tsx'
    );
    // 必须匹配「调用形态」（带左括号）：import 行里也有这个名字，裸名计数会多算一次
    expect(source.match(/isBrowserOpenableExt\(/g)?.length).toBe(3);
    // 用「if (」前缀比位置：裸名 indexOf 会被 import 块里的成员顺序干扰而假通过
    expect(source.indexOf('if (isBrowserOpenableExt(')).toBeGreaterThan(-1);
    expect(source.indexOf('if (isBrowserOpenableExt(')).toBeLessThan(
      source.indexOf('if (isPreviewableExt(')
    );
  });

  it('keeps the attachment card clickable for browser-openable files', () => {
    const source = read(
      '../src/renderer/components/message/ContentBlockView.tsx'
    );
    expect(source).toContain('opensInBrowser');
    expect(source).toContain('canPreview || opensInBrowser');
  });

  it('routes the artifact panel entry point to the built-in browser', () => {
    const source = read('../src/renderer/components/ArtifactPanel.tsx');
    expect(source.match(/isBrowserOpenableExt\(/g)?.length).toBe(1);
    expect(source.indexOf('if (isBrowserOpenableExt(')).toBeGreaterThan(-1);
    expect(source.indexOf('if (isBrowserOpenableExt(')).toBeLessThan(
      source.indexOf('if (isPreviewableExt(')
    );
  });
});
