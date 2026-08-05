import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');

describe('dark theme palette', () => {
  it('uses a graphite zinc palette for the default theme', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-background: #18181b;');
    expect(source).toContain('--color-surface: #27272a;');
    expect(source).toContain('--color-text-primary: #f4f4f5;');
  });

  it('keeps the accent as a neutral zinc gray', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-accent: #d4d4d8;');
    expect(source).toContain('--color-accent-hover: #e4e4e7;');
  });
});
