import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8');
}

describe('file download fallback', () => {
  it('installs a file:// only will-download guard on the default session', () => {
    const manager = read('../src/main/browser/browser-view-manager.ts');
    expect(manager).toContain('export function installFileDownloadFallback()');
    expect(manager).toContain('session.defaultSession.on("will-download"');
    expect(manager).toContain('url.startsWith("file://")');
    expect(manager).toContain('item.cancel()');
    expect(manager).toContain('shell.openPath(');
    expect(manager).toContain('fileURLToPath(');
  });

  it('keeps http downloads untouched', () => {
    const manager = read('../src/main/browser/browser-view-manager.ts');
    const guard = manager.slice(
      manager.indexOf('export function installFileDownloadFallback()')
    );
    const body = guard.slice(0, guard.indexOf('\n}\n'));
    expect(body).toContain('if (!url.startsWith("file://")) return;');
  });

  it('installs the guard once at app level, right after the media protocol', () => {
    const index = read('../src/main/index.ts');
    expect(index).toContain('installFileDownloadFallback();');
    expect(index.indexOf('await installVideoProtocol();')).toBeLessThan(
      index.indexOf('installFileDownloadFallback();')
    );
  });
});
