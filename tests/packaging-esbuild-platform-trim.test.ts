import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const afterPack = require('../scripts/after-pack.js');

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** 取出 electron-builder.yml 里某个顶层段的原文（到下一个顶层 key 为止）。 */
function readBuilderSection(name: string): string {
  const config = fs.readFileSync(path.resolve(process.cwd(), 'electron-builder.yml'), 'utf8');
  const start = config.indexOf(`\n${name}:`);
  if (start < 0) throw new Error(`section not found in electron-builder.yml: ${name}`);
  const rest = config.slice(start + 1);
  const end = rest.search(/\n[a-z][a-zA-Z0-9]*:/);
  return end < 0 ? rest : rest.slice(0, end);
}

function makeAppTree(
  electronPlatformName: string,
  platformDirs: string[],
): { appOutDir: string; esbuildDir: string } {
  const appOutDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-packaging-trim-'));
  tempDirs.push(appOutDir);
  // macOS keeps resources inside the .app bundle; win32/linux use <appOutDir>/resources.
  const resourcesDir =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, 'DeskWand.app', 'Contents', 'Resources')
      : path.join(appOutDir, 'resources');
  const esbuildDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', '@esbuild');
  for (const name of platformDirs) {
    fs.mkdirSync(path.join(esbuildDir, name), { recursive: true });
  }
  return { appOutDir, esbuildDir };
}

describe('after-pack @esbuild trim', () => {
  it.each([
    { electronPlatformName: 'darwin', arch: 3, keep: 'darwin-arm64' },
    { electronPlatformName: 'win32', arch: 1, keep: 'win32-x64' },
    { electronPlatformName: 'linux', arch: 1, keep: 'linux-x64' },
  ])(
    'keeps only $keep under node_modules/@esbuild for $electronPlatformName',
    async ({ electronPlatformName, arch, keep }) => {
      const { appOutDir, esbuildDir } = makeAppTree(electronPlatformName, [
        'darwin-arm64',
        'linux-x64',
        'win32-x64',
        'android-arm64',
      ]);

      await afterPack({
        appOutDir,
        electronPlatformName,
        arch,
        packager: { appInfo: { productFilename: 'DeskWand' } },
      });

      expect(fs.readdirSync(esbuildDir)).toEqual([keep]);
    },
  );
});

describe('electron-builder platform config', () => {
  it.each(['mac', 'win', 'linux'])(
    'does not redefine `files` inside the %s section',
    (section) => {
      // A platform-level `files` array replaces the top-level `files` list: the main matcher
      // then collapses to `**/*` and packs local-only junk (e.g. .codegraph/codegraph.db).
      // Platform-specific payload trimming belongs in scripts/after-pack.js instead.
      expect(readBuilderSection(section)).not.toMatch(/^\s{2}files:/m);
    },
  );
});

describe('publish-local version guard', () => {
  it('refuses to stage artifacts whose manifest version differs from package.json', () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-publish-local-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'deskwand', version: '1.0.35' }));
    fs.mkdirSync(path.join(dir, 'release'));
    fs.writeFileSync(
      path.join(dir, 'release', 'latest-mac.yml'),
      ['version: 1.0.34', 'files:', '  - url: DeskWand-1.0.34-mac-arm64.dmg', '    size: 1', ''].join('\n'),
    );
    fs.writeFileSync(path.join(dir, 'release', 'DeskWand-1.0.34-mac-arm64.dmg'), 'x');

    const result = spawnSync(
      process.execPath,
      [path.resolve(process.cwd(), 'scripts/publish-local.js'), '--dir', path.join(dir, 'out')],
      { cwd: dir, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('do not match package.json version 1.0.35');
  });
});
