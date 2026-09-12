import { describe, it, expect } from 'vitest';
import {
  buildTitleInput,
  buildTitlePrompt,
  normalizeGeneratedTitle,
  shouldGenerateTitle,
} from '../src/main/session/session-title-utils';
import { normalizeSessionTitle } from '../src/shared/session-title';

describe('session title utils', () => {
  it('generates title only for first user message and default title', () => {
    expect(
      shouldGenerateTitle({
        userMessageCount: 1,
        currentTitle: 'Hello world',
        prompt: 'Hello world',
        hasAttempted: false,
      })
    ).toBe(true);

    expect(
      shouldGenerateTitle({
        userMessageCount: 2,
        currentTitle: 'Hello world',
        prompt: 'Hello world',
        hasAttempted: false,
      })
    ).toBe(false);
  });

  it('skips when title was manually changed', () => {
    expect(
      shouldGenerateTitle({
        userMessageCount: 1,
        currentTitle: 'Custom title',
        prompt: 'Hello world',
        hasAttempted: false,
      })
    ).toBe(false);
  });

  it('skips when already attempted', () => {
    expect(
      shouldGenerateTitle({
        userMessageCount: 1,
        currentTitle: 'Hello world',
        prompt: 'Hello world',
        hasAttempted: true,
      })
    ).toBe(false);
  });

  it('builds a bilingual prompt requiring <=15 chars and same language', () => {
    const prompt = buildTitlePrompt('帮我做一个PPT');
    expect(prompt).toContain('15');
    expect(prompt).toContain('同语言');
    expect(prompt).toContain('same language');
  });

  it('normalizes generated title by taking first line and stripping quotes', () => {
    const title = normalizeGeneratedTitle('"  我的标题  "\n第二行');
    expect(title).toBe('我的标题');
  });

  it('normalizes manually entered session titles', () => {
    expect(normalizeSessionTitle('  Project notes  ')).toBe('Project notes');
    expect(normalizeSessionTitle('')).toBeNull();
    expect(normalizeSessionTitle('   ')).toBeNull();

    const longTitle = normalizeSessionTitle('a'.repeat(60));
    expect(longTitle).toHaveLength(50);
    expect(longTitle?.endsWith('...')).toBe(true);
  });

  it('drops synthetic empty placeholder titles', () => {
    expect(normalizeGeneratedTitle('(no content)')).toBeNull();
    expect(normalizeGeneratedTitle('(empty content)')).toBeNull();
  });
});

describe('attachment-derived initial titles', () => {
  it('generates a title when the current title came from an attachment name', () => {
    expect(
      shouldGenerateTitle({
        userMessageCount: 1,
        currentTitle: '季度总结-最终版.pptx',
        prompt: '',
        firstAttachmentName: '季度总结-最终版.pptx',
        hasAttempted: false,
      })
    ).toBe(true);
  });

  it('still skips when the title is neither the initial title nor the default', () => {
    expect(
      shouldGenerateTitle({
        userMessageCount: 1,
        currentTitle: '用户改过的标题',
        prompt: '',
        firstAttachmentName: '季度总结-最终版.pptx',
        hasAttempted: false,
      })
    ).toBe(false);
  });
});

describe('buildTitleInput', () => {
  it('uses the prompt text when present, trimmed', () => {
    expect(buildTitleInput('  帮我做个 PPT  ', '季度总结.pptx')).toBe('帮我做个 PPT');
  });

  it('falls back to the attachment name when prompt text is empty', () => {
    expect(buildTitleInput('', '季度总结-最终版.pptx')).toBe('季度总结-最终版.pptx');
    expect(buildTitleInput('   ', '季度总结-最终版.pptx')).toBe('季度总结-最终版.pptx');
  });

  it('returns null when there is neither text nor an attachment name', () => {
    expect(buildTitleInput('', null)).toBe(null);
    expect(buildTitleInput('', undefined)).toBe(null);
    expect(buildTitleInput('   ', '   ')).toBe(null);
  });
});
