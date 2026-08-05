/**
 * 打包版（hoisted）布局下 getAliases 解析逻辑的回归测试。
 *
 * 背景：SDK getAliases 的 resolveWorkspaceOrImport 在打包版布局
 * （electron-builder 把 @earendil-works/* 提升到顶层 node_modules）下，
 * 必须剥离子路径 specifier 再拼接路径（如 "@earendil-works/pi-ai/compat"
 * → basePkg "@earendil-works/pi-ai" → <top>/node_modules/@earendil-works/pi-ai/...）。
 * 若直接拼接完整 specifier，会产生 <pkg>/compat/... 这种不存在的路径，
 * 最终 require.resolve 走 CJS 语义报 ERR_PACKAGE_PATH_NOT_EXPORTED。
 *
 * 本测试复刻 patch 后的解析逻辑（loader.js resolveWorkspaceOrImport 的
 * hoisted 分支），在模拟的打包布局目录上断言：
 *   1. 无子路径 specifier（@earendil-works/pi-agent-core）解析命中
 *   2. 子路径 specifier（@earendil-works/pi-ai/compat、/oauth、/providers/all）
 *      解析命中正确的 dist 文件
 *   3. dev 布局（嵌套 node_modules）下解析行为不被破坏（仍走嵌套路径）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * 复刻 patch 后 loader.js resolveWorkspaceOrImport 的解析顺序。
 * 返回解析到的绝对路径，未命中返回 undefined。
 */
function resolveWorkspaceOrImport(
  workspaceRelativePath: string,
  specifier: string,
  packagesRoot: string,
): string | undefined {
  // 1. npm-installed under packagesRoot/node_modules/<specifier>/<relPath>
  const nmPath = path.join(
    packagesRoot,
    "node_modules",
    specifier,
    workspaceRelativePath,
  );
  if (fs.existsSync(nmPath)) return nmPath;

  // 2. Monorepo workspace sibling
  const workspacePath = path.join(packagesRoot, workspaceRelativePath);
  if (fs.existsSync(workspacePath)) return workspacePath;

  // 3. Subpath specifier (e.g. @scope/pkg/sub) — try base package
  {
    const parts = specifier.split("/");
    const basePkg =
      specifier.startsWith("@") && parts.length >= 2
        ? parts.slice(0, 2).join("/")
        : parts[0];
    if (basePkg && basePkg !== specifier) {
      const baseNmPath = path.join(
        packagesRoot,
        "node_modules",
        basePkg,
        workspaceRelativePath,
      );
      if (fs.existsSync(baseNmPath)) return baseNmPath;
      const relParts = workspaceRelativePath.split("/");
      if (relParts.length > 1) {
        const stripped = path.join(
          packagesRoot,
          "node_modules",
          basePkg,
          ...relParts.slice(1),
        );
        if (fs.existsSync(stripped)) return stripped;
      }
    }
  }

  // 4. Packaged (hoisted) layout: electron-builder lifts @earendil-works/*
  // deps to the app's top-level node_modules root (packagesRoot/../..).
  {
    const topLevelNodeModules = path.resolve(packagesRoot, "../..");
    // Strip subpath specifier (e.g. "@earendil-works/pi-ai/compat" →
    // "@earendil-works/pi-ai") so we look under the package dir, not a
    // non-existent "<pkg>/compat" dir. Mirrors step 3's basePkg logic.
    const parts = specifier.split("/");
    const basePkg =
      specifier.startsWith("@") && parts.length >= 2
        ? parts.slice(0, 2).join("/")
        : parts[0];
    const topNmPath = path.join(
      topLevelNodeModules,
      basePkg,
      workspaceRelativePath,
    );
    if (fs.existsSync(topNmPath)) return topNmPath;
    const relParts = workspaceRelativePath.split("/");
    if (relParts.length > 1) {
      const topStripped = path.join(
        topLevelNodeModules,
        basePkg,
        ...relParts.slice(1),
      );
      if (fs.existsSync(topStripped)) return topStripped;
    }
    // read package.json main/exports as last resort before require.resolve
    const topPkgRoot = path.join(topLevelNodeModules, basePkg);
    if (fs.existsSync(topPkgRoot)) {
      const topPkgJsonPath = path.join(topPkgRoot, "package.json");
      if (fs.existsSync(topPkgJsonPath)) {
        try {
          const topPkg = JSON.parse(fs.readFileSync(topPkgJsonPath, "utf-8"));
          const topEntry =
            typeof topPkg.exports === "object" &&
            typeof topPkg.exports["."]?.import === "string"
              ? topPkg.exports["."].import
              : topPkg.main;
          if (typeof topEntry === "string") {
            const topEntryPath = path.join(topPkgRoot, topEntry);
            if (fs.existsSync(topEntryPath)) return topEntryPath;
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  // 5. Fallback: read package.json main
  const pkgRoot = path.join(packagesRoot, "node_modules", specifier);
  if (fs.existsSync(pkgRoot)) {
    const pkgJsonPath = path.join(pkgRoot, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        const entry =
          typeof pkg.exports === "object" &&
          typeof pkg.exports["."]?.import === "string"
            ? pkg.exports["."].import
            : pkg.main;
        if (typeof entry === "string") {
          const entryPath = path.join(pkgRoot, entry);
          if (fs.existsSync(entryPath)) return entryPath;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return undefined;
}

interface LayoutCtx {
  root: string;
  /** packagesRoot：<root>/node_modules/@earendil-works/pi-coding-agent */
  packagesRoot: string;
}

const PI_AI_FILES = [
  "dist/index.js",
  "dist/compat.js",
  "dist/oauth.js",
  "dist/providers/all.js",
];
const PI_AI_EXPORTS = {
  ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  "./compat": { types: "./dist/compat.d.ts", import: "./dist/compat.js" },
  "./oauth": { types: "./dist/oauth.d.ts", import: "./dist/oauth.js" },
};

function mkPkg(
  topDir: string,
  name: string,
  files: string[],
  exportsMap: Record<string, unknown>,
): void {
  const dir = path.join(topDir, "@earendil-works", name);
  for (const f of files) {
    const full = path.join(dir, f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "export const x = 1;\n");
  }
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: `@earendil-works/${name}`,
      type: "module",
      exports: exportsMap,
    }),
  );
}

/** 打包布局：生态包仅提升到顶层 node_modules（electron-builder 真实行为，
 *  pi-coding-agent/node_modules 下无 @earendil-works 嵌套副本） */
function makePackagedLayout(): LayoutCtx {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-alias-packaged-"));
  const topNM = path.join(root, "node_modules");
  const pkgDir = path.join(topNM, "@earendil-works", "pi-coding-agent");
  fs.mkdirSync(pkgDir, { recursive: true });
  mkPkg(topNM, "pi-agent-core", ["dist/index.js"], {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  });
  mkPkg(topNM, "pi-ai", PI_AI_FILES, PI_AI_EXPORTS);
  return { root, packagesRoot: pkgDir };
}

/** dev 布局：生态包嵌套在 pi-coding-agent/node_modules 下（npm 嵌套安装），
 *  顶层 node_modules 无 @earendil-works 生态包 */
function makeDevLayout(): LayoutCtx {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-alias-dev-"));
  const topNM = path.join(root, "node_modules");
  const pkgDir = path.join(topNM, "@earendil-works", "pi-coding-agent");
  const nestedTop = path.join(pkgDir, "node_modules");
  fs.mkdirSync(nestedTop, { recursive: true });
  mkPkg(nestedTop, "pi-agent-core", ["dist/index.js"], {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  });
  mkPkg(nestedTop, "pi-ai", PI_AI_FILES, PI_AI_EXPORTS);
  return { root, packagesRoot: pkgDir };
}

describe("getAliases packaged (hoisted) layout resolution", () => {
  let ctx: LayoutCtx | undefined;

  beforeEach(() => {
    ctx = makePackagedLayout();
  });

  afterEach(() => {
    if (ctx) fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx = undefined;
  });

  it("resolves non-subpath specifier in hoisted layout", () => {
    const r = resolveWorkspaceOrImport(
      "agent/dist/index.js",
      "@earendil-works/pi-agent-core",
      ctx!.packagesRoot,
    );
    expect(r).toBe(
      path.join(
        ctx!.root,
        "node_modules",
        "@earendil-works",
        "pi-agent-core",
        "dist",
        "index.js",
      ),
    );
  });

  it("resolves subpath specifier in hoisted layout (regression for ERR_PACKAGE_PATH_NOT_EXPORTED)", () => {
    const cases: Array<[string, string, string[]]> = [
      [
        "ai/dist/compat.js",
        "@earendil-works/pi-ai/compat",
        ["dist", "compat.js"],
      ],
      ["ai/dist/oauth.js", "@earendil-works/pi-ai/oauth", ["dist", "oauth.js"]],
      [
        "ai/dist/providers/all.js",
        "@earendil-works/pi-ai/providers/all",
        ["dist", "providers", "all.js"],
      ],
    ];
    for (const [rel, spec, expectedRel] of cases) {
      const r = resolveWorkspaceOrImport(rel, spec, ctx!.packagesRoot);
      expect(r).toBe(
        path.join(
          ctx!.root,
          "node_modules",
          "@earendil-works",
          "pi-ai",
          ...expectedRel,
        ),
      );
    }
  });
});

describe("getAliases dev (nested) layout resolution", () => {
  let ctx: LayoutCtx | undefined;

  beforeEach(() => {
    ctx = makeDevLayout();
  });

  afterEach(() => {
    if (ctx) fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx = undefined;
  });

  it("resolves subpath specifier via nested layout (step 3)", () => {
    const r = resolveWorkspaceOrImport(
      "ai/dist/compat.js",
      "@earendil-works/pi-ai/compat",
      ctx!.packagesRoot,
    );
    expect(r).toBe(
      path.join(
        ctx!.root,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
        "node_modules",
        "@earendil-works",
        "pi-ai",
        "dist",
        "compat.js",
      ),
    );
  });
});
