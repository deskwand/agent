/**
 * Path resolution for executables bundled with the app.
 *
 * Deliberately free of Electron imports so every branch is unit-testable: the
 * caller passes the environment in instead of reading `app.isPackaged` /
 * `process.resourcesPath` at module scope.
 *
 * Layout contract:
 *   packaged:  <resourcesPath>/bin, <resourcesPath>/node, <resourcesPath>/python
 *   dev:       <projectRoot>/resources/bin/<platform>-<arch>,
 *              <projectRoot>/resources/node/<platform>-<arch>,
 *              <projectRoot>/resources/python/<platform>-<arch>
 *
 * `resources/bin/<platform>-<arch>/` is the single home for single-file helper
 * binaries (officecli, cliclick, ...). Adding a tool there needs no code change
 * here — PATH injection and prompt hints both enumerate the directory.
 */

import * as fs from "fs";
import * as path from "path";

export interface BundleContext {
  isPackaged: boolean;
  resourcesPath: string;
  projectRoot: string;
  platform: NodeJS.Platform;
  arch: string;
}

function platformArchKey(ctx: BundleContext): string {
  const arch = ctx.arch === "arm64" ? "arm64" : "x64";
  return `${ctx.platform}-${arch}`;
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function dirExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The unified helper-binary directory, or null when it is absent.
 */
export function resolveBundledBinDir(ctx: BundleContext): string | null {
  const candidate = ctx.isPackaged
    ? path.join(ctx.resourcesPath, "bin")
    : path.join(ctx.projectRoot, "resources", "bin", platformArchKey(ctx));
  return dirExists(candidate) ? candidate : null;
}

/**
 * Bundled Node (and npx), or null when not present.
 */
export function resolveBundledNodePaths(
  ctx: BundleContext,
): { node: string; npx: string } | null {
  const resourcesPath = ctx.isPackaged
    ? path.join(ctx.resourcesPath, "node")
    : path.join(ctx.projectRoot, "resources", "node", platformArchKey(ctx));

  const binDir =
    ctx.platform === "win32" ? resourcesPath : path.join(resourcesPath, "bin");

  const nodePath = path.join(
    binDir,
    ctx.platform === "win32" ? "node.exe" : "node",
  );
  const npxPath = path.join(
    binDir,
    ctx.platform === "win32" ? "npx.cmd" : "npx",
  );

  return fileExists(nodePath) && fileExists(npxPath)
    ? { node: nodePath, npx: npxPath }
    : null;
}

/**
 * Bundled Python bin directory, or null when python3 is not present.
 */
export function resolveBundledPythonBinDir(ctx: BundleContext): string | null {
  const candidates = ctx.isPackaged
    ? [path.join(ctx.resourcesPath, "python", "bin")]
    : [
        path.join(
          ctx.projectRoot,
          "resources",
          "python",
          platformArchKey(ctx),
          "bin",
        ),
        path.join(ctx.projectRoot, "resources", "python", "bin"),
      ];

  const pythonExe = ctx.platform === "win32" ? "python.exe" : "python3";
  for (const binDir of candidates) {
    if (fileExists(path.join(binDir, pythonExe))) return binDir;
  }
  return null;
}

/**
 * Every bundled bin directory, highest priority first.
 *
 * Order matters: `resources/bin` goes first so a bundled helper (officecli)
 * shadows anything of the same name the user happens to have installed.
 */
export function resolveBundledBinDirs(ctx: BundleContext): string[] {
  const dirs: string[] = [];

  const binDir = resolveBundledBinDir(ctx);
  if (binDir) dirs.push(binDir);

  const nodePaths = resolveBundledNodePaths(ctx);
  if (nodePaths) dirs.push(path.dirname(nodePaths.node));

  const pythonBinDir = resolveBundledPythonBinDir(ctx);
  if (pythonBinDir) dirs.push(pythonBinDir);

  return dirs;
}
