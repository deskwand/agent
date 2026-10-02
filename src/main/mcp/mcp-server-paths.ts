/**
 * 打包 Node 与 Windows npx 的路径解析 —— 配置投影用它把 `command` 改写成绝对路径。
 *
 * 原先这里还有「登录 shell 环境采集与合并」（`getEnhancedEnv` / `resolveBaseEnv` /
 * `mergeShellEnvForMcp`，含 `spawn $SHELL -ilc env`）与 `getDefaultShell`。
 * **已全部删除** —— 传输层交还 SDK 后它们在配置投影里被 `env.PATH` 注入取代
 * （见 design-docs/2026-10-02-mcp-transport-revert-plan.md §3）。
 */
import { app } from "electron";
import path from "node:path";
import { log, logWarn } from "../utils/logger";

export function normalizeWindowsPathForComparison(candidate: string): string {
  return path.win32.normalize(candidate).replace(/\//g, "\\").toLowerCase();
}

function normalizeWindowsDirectoryForComparison(candidate: string): string {
  return normalizeWindowsPathForComparison(candidate).replace(/[\\/]+$/, "");
}

export function getTrustedWindowsNpxDirectories(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const candidates = [
    env.ProgramW6432,
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );

  return Array.from(
    new Set(
      candidates.map((directory) =>
        normalizeWindowsDirectoryForComparison(
          path.win32.join(directory, "nodejs"),
        ),
      ),
    ),
  );
}

export function findPreferredWindowsNpxPath(
  pathEnv: string | undefined,
  bundledNpxPath: string | null,
  pathExists: (candidate: string) => boolean = (candidate) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    return fs.existsSync(candidate);
  },
  trustedDirectories?: string[],
): string | null {
  const bundledNormalized = bundledNpxPath
    ? normalizeWindowsPathForComparison(bundledNpxPath)
    : null;
  const normalizedTrustedDirectories = trustedDirectories?.map(
    normalizeWindowsDirectoryForComparison,
  );

  for (const rawEntry of (pathEnv || "").split(";")) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, "$1");
    if (!entry) {
      continue;
    }

    const candidate = path.win32.join(entry, "npx.cmd");
    if (!pathExists(candidate)) {
      continue;
    }

    if (
      bundledNormalized &&
      normalizeWindowsPathForComparison(candidate) === bundledNormalized
    ) {
      continue;
    }

    if (
      normalizedTrustedDirectories &&
      !normalizedTrustedDirectories.includes(
        normalizeWindowsDirectoryForComparison(entry),
      )
    ) {
      continue;
    }

    return candidate;
  }

  return bundledNpxPath;
}

export function getBundledNodePath(): { node: string; npx: string } | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require("os");

  const platform = os.platform();
  const arch = os.arch();

  // In production, resources are in app.asar.unpacked or extraResources
  let resourcesPath: string;

  if (!app.isPackaged) {
    // Development: use downloaded node in resources/node
    // __dirname is dist-electron/main, so go up to project root
    log("[MCP] Development mode, using downloaded node in resources/node");
    const projectRoot = path.join(__dirname, "..", "..");
    resourcesPath = path.join(
      projectRoot,
      "resources",
      "node",
      `${platform}-${arch}`,
    );
  } else {
    // Production: use bundled node in extraResources
    log("[MCP] Production mode, using bundled node in extraResources");
    resourcesPath = path.join(process.resourcesPath, "node");
  }

  log(`[MCP] Looking for bundled Node.js at: ${resourcesPath}`);

  if (!fs.existsSync(resourcesPath)) {
    logWarn(`[MCP] Bundled Node.js not found at: ${resourcesPath}`);
    return null;
  }

  // Determine binary paths based on platform
  const binDir =
    platform === "win32" ? resourcesPath : path.join(resourcesPath, "bin");
  const nodeExe = platform === "win32" ? "node.exe" : "node";
  const npxExe = platform === "win32" ? "npx.cmd" : "npx";

  const nodePath = path.join(binDir, nodeExe);
  const npxPath = path.join(binDir, npxExe);

  // Verify files exist
  if (fs.existsSync(nodePath) && fs.existsSync(npxPath)) {
    log(`[MCP] Found bundled Node.js: ${nodePath}`);
    log(`[MCP] Found bundled npx: ${npxPath}`);
    return { node: nodePath, npx: npxPath };
  } else {
    logWarn(
      `[MCP] Bundled binaries incomplete - node: ${fs.existsSync(nodePath)}, npx: ${fs.existsSync(npxPath)}`,
    );
    return null;
  }
}
