import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ssh2 把 cpu-features 列为 optionalDependencies。它是需要 node-gyp 从源码编译的
 * 原生模块，而 node-gyp 不支持交叉编译 —— 在 macOS 上打 linux-x64 时
 * electron-builder 的 rebuild 步会直接失败（"node-gyp does not support
 * cross-compiling native modules from source"），整个 linux 阶段产不出
 * AppImage 与 deb。1.0.52 就是这么卡住的。
 *
 * 两道防线，缺一不可：
 *   1. linux 构建脚本跳过依赖重建（与 build:win-x64 已有的做法一致）；
 *   2. 打包时排除 cpu-features，免得把一份 darwin 编译出来的 .node 塞进 linux 包。
 *
 * 两道防线都建立在一个前提上：少了这个原生绑定，ssh2 仍能工作。它确实是可选的。
 */
function scripts(): Record<string, string> {
  return (JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }).scripts;
}

function builderFilesSection(): string {
  const config = fs.readFileSync(path.resolve(process.cwd(), 'electron-builder.yml'), 'utf8');
  const start = config.indexOf('\nfiles:');
  if (start < 0) throw new Error('electron-builder.yml has no files: section');
  const rest = config.slice(start + 1);
  const end = rest.search(/\n[a-z][a-zA-Z0-9]*:/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('linux packaging skips the cpu-features rebuild', () => {
  it.each(['build:linux', 'build:linux:deb'])(
    '%s passes --config.npmRebuild=false to electron-builder',
    (name) => {
      expect(scripts()[name]).toContain('--config.npmRebuild=false');
    },
  );

  it('excludes cpu-features so a darwin-built .node never ships in a linux package', () => {
    expect(builderFilesSection()).toContain('"!**/node_modules/cpu-features/**"');
  });

  it('only skips a module ssh2 declares optional, so ssh2 still loads', () => {
    const ssh2 = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'node_modules/ssh2/package.json'), 'utf8'),
    ) as { optionalDependencies?: Record<string, string>; dependencies?: Record<string, string> };

    expect(ssh2.optionalDependencies?.['cpu-features']).toBeTruthy();
    // 若哪天 ssh2 把它挪进 dependencies，上面的两道防线就变成硬缺失，这条会先响。
    expect(ssh2.dependencies?.['cpu-features']).toBeUndefined();
  });
});
