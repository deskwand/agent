// shared 代码的浏览器安全守卫。
//
// `src/shared` 同时被 main（Node/Electron）与 renderer（浏览器）引用。renderer 构建时
// Vite 把 Node 内建模块替换成 `__vite-browser-external` 空壳：构建期往往只有一条
// `Module "path" has been externalized for browser compatibility` 的 warning，
// 真正炸的是 rollup ——`import { posix } from "path"` 找不到 `posix` 导出，整次
// `vite build` 直接失败（2026-10 的 ssh 远程工作区提交就这么把 `src/shared/workspace-cwd.ts`
// 写坏了；主进程那半边一直好着，所以 `npm run dev` 也未必立刻发现）。
//
// 因此按源码扫描兜底：shared 里不许出现 Node 内建模块，需要路径/IO 的地方自己写纯字符串实现
// （先例见 `src/shared/workspace-path.ts` 的 joinRelativePath / toWorkspaceKey）。
//
// 用 ts.preProcessFile 而不是正则：注释里写一句 `import "path"` 不该算违规
// （`workspace-cwd.ts` 的说明注释里正好有），正则要区分注释与代码得自己写状态机。
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SHARED = path.resolve(import.meta.dirname, "../../shared");

/** `fs` 与 `node:fs` 两种写法都算内建。 */
const BUILTINS = new Set(
  builtinModules.flatMap((m) => [m, m.replace(/^node:/, "")]),
);

/** 源码里 Node 内建模块的说明符（import / export-from / require / import()，跳过注释与字符串）。 */
function nodeBuiltinSpecifiersInSource(source: string): string[] {
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map((file) => file.fileName)
    .filter((specifier) => {
      if (specifier.startsWith("node:")) return true;
      // `fs/promises` 这类子路径也算；`node-fetch` / `path-browserify` 这类包名不算。
      return BUILTINS.has(specifier.split("/")[0]);
    });
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("src/shared 的浏览器安全守卫", () => {
  it("认得出内建模块的各种引入写法（正控）", () => {
    expect(
      nodeBuiltinSpecifiersInSource('import { posix } from "path";'),
    ).toEqual(["path"]);
    expect(nodeBuiltinSpecifiersInSource('import fs from "node:fs";')).toEqual([
      "node:fs",
    ]);
    expect(
      nodeBuiltinSpecifiersInSource('const cp = require("child_process");'),
    ).toEqual(["child_process"]);
    expect(
      nodeBuiltinSpecifiersInSource('await import("fs/promises");'),
    ).toEqual(["fs/promises"]);
    expect(nodeBuiltinSpecifiersInSource('export * from "os";')).toEqual([
      "os",
    ]);
  });

  it("反控：普通包名、相对引入与注释里的字样都不算", () => {
    expect(
      nodeBuiltinSpecifiersInSource(
        [
          'import { z } from "zod";',
          'import { cn } from "./utils";',
          'import "path-browserify";',
          '// 历史写法：import { posix } from "path"',
          '/* 也不要 import "fs" */',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("共享模块不 import 任何 Node 内建模块", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SHARED)) {
      const source = fs.readFileSync(file, "utf8");
      for (const specifier of nodeBuiltinSpecifiersInSource(source)) {
        offenders.push(`${path.relative(SHARED, file)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
