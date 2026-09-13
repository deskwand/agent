import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8');
}

describe('browser load failure surfacing', () => {
  it('enables the Chromium pdf viewer plugin', () => {
    const manager = read('../src/main/browser/browser-view-manager.ts');
    expect(manager).toContain('plugins: true');
  });

  it('catches loadURL rejections instead of leaking an unhandled rejection', () => {
    const manager = read('../src/main/browser/browser-view-manager.ts');
    const call = manager.indexOf('loadURL(url).catch(');
    expect(call).toBeGreaterThan(-1);
    expect(manager.slice(call, call + 200)).toContain('logError(');
  });

  it('reports main-frame load failures and ignores aborted navigations', () => {
    const manager = read('../src/main/browser/browser-view-manager.ts');
    expect(manager).toContain('"did-fail-load"');
    expect(manager).toContain('if (!isMainFrame) return;');
    expect(manager).toContain('ERR_ABORTED');
    expect(manager).toContain('loadError');
  });

  it('clears the error when a new load starts', () => {
    const manager = read('../src/main/browser/browser-view-manager.ts');
    const start = manager.indexOf('wc.on("did-start-loading"');
    // prettier 会把 `wc.on(` 与 `"did-fail-load"` 拆成两行，
    // 因此锚点只能是错误事件字符串本身。
    const fail = manager.indexOf('"did-fail-load"');
    expect(start).toBeGreaterThan(-1);
    expect(fail).toBeGreaterThan(-1);
    expect(manager.slice(start, fail)).toContain('this._loadError = undefined');
  });

  it('clears the error once a load finishes too', () => {
    const manager = read('../src/main/browser/browser-view-manager.ts');
    const start = manager.indexOf('wc.on("did-finish-load"');
    const fail = manager.indexOf('"did-fail-load"');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(fail);
    expect(manager.slice(start, fail)).toContain('this._loadError = undefined');
  });

  it('ships the panel copy under the browser group in both locales', () => {
    // 必须精确到 browser 组：'loadFailed' 这个 key 在别的分组里已经存在，
    // 用 toContain('"loadFailed"') 会在改动前就通过（假通过）。
    const zh = JSON.parse(read('../src/renderer/i18n/locales/zh.json')) as {
      browser?: Record<string, string>;
    };
    const en = JSON.parse(read('../src/renderer/i18n/locales/en.json')) as {
      browser?: Record<string, string>;
    };
    expect(zh.browser?.loadFailed).toBe('页面加载失败');
    expect(en.browser?.loadFailed).toBe('Failed to load page');
  });

  it('renders the load error inside the browser panel', () => {
    const panel = read('../src/renderer/components/BrowserPanel.tsx');
    expect(panel).toContain('loadError?: string;');
    expect(panel).toContain('status.loadError');
  });
});
