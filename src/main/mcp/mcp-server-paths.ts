/**
 * MCP 服务器启动所需的路径解析与环境组装（从 mcp-manager.ts 抽出）。
 *
 * 三组东西：
 *  1. 打包 Node 与 Windows npx 路径（投影的 `resolveBundledNode` / `resolveWindowsNpx` 用它）
 *  2. 登录 shell 环境采集 + 合并（打包版 process.env 很贫瘠，这是 npx/uvx 类 server 能被找到的前提）
 *  3. 供传输适配器在 spawn 前组装最终 env
 *
 * 与原实现的行为一致；唯一的结构变化是 `cachedBaseEnv` 从实例字段变为模块级缓存
 * （原来挂在 MCPManager 实例上，而该类已被删除）。
 */
import { app } from "electron";
import path from "node:path";
import {
  buildLegacyEnvBridgeSnapshot,
  configStore,
} from "../config/config-store";
import { getDefaultShell } from "../utils/shell-resolver";
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

/**
 * Get enhanced environment with proper PATH for packaged app
 * This is critical for packaged apps where process.env is very limited
 */
export async function getEnhancedEnv(
  configEnv: Record<string, string>,
): Promise<Record<string, string>> {
  if (!cachedBaseEnv) {
    cachedBaseEnv = await resolveBaseEnv();
  }
  const legacyBridgeEnv = buildLegacyEnvBridgeSnapshot(configStore.getAll());
  return { ...cachedBaseEnv, ...legacyBridgeEnv, ...configEnv };
}

/**
 * Resolve the base environment (shell env + PATH).
 * Heavy operation — called once, then cached by getEnhancedEnv.
 */
export async function resolveBaseEnv(): Promise<Record<string, string>> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  const os = await import("os");
  const path = await import("path");

  const platform = os.platform();
  const homeDir = os.homedir();

  // Start with current process env
  let env = { ...process.env } as Record<string, string>;

  // For macOS/Linux, try to get full environment from user's shell
  // This is essential for packaged apps where process.env is minimal
  if (platform === "darwin" || platform === "linux") {
    try {
      const shell = getDefaultShell();
      const shellName = path.basename(shell);

      log(`[MCP] Getting full environment from ${shellName}...`);

      // Use login shell to get full environment including PATH
      // execFile avoids shell injection — args passed as array, not interpolated string
      const { stdout } = await execFileAsync(shell, ["-l", "-c", "env"], {
        timeout: 5000,
        env: { HOME: homeDir },
      });

      // Parse environment variables
      const lines = stdout.split(/\r?\n/);
      const shellEnv: Record<string, string> = {};

      for (const line of lines) {
        const equalIndex = line.indexOf("=");
        if (equalIndex > 0) {
          const key = line.substring(0, equalIndex);
          const value = line.substring(equalIndex + 1);
          shellEnv[key] = value;
        }
      }

      // Merge shell environment safely: enrich missing runtime vars but never override
      // config-sensitive keys that were already set by app runtime.
      env = mergeShellEnvForMcp(env, shellEnv);

      // Special handling for PATH: merge both shell PATH and process PATH
      // This ensures we have both user tools (from shell) and system paths (from process)
      if (shellEnv.PATH && process.env.PATH) {
        // For Unix systems (darwin/linux), path delimiter is ':'
        const pathDelimiter = ":";

        const shellPaths = shellEnv.PATH.split(pathDelimiter).filter((p) =>
          p.trim(),
        );
        const processPaths = process.env.PATH.split(pathDelimiter).filter((p) =>
          p.trim(),
        );

        // Combine and deduplicate paths (shell paths first for priority)
        const allPaths = [...shellPaths];
        for (const p of processPaths) {
          if (!allPaths.includes(p)) {
            allPaths.push(p);
          }
        }

        env.PATH = allPaths.join(pathDelimiter);
        log(
          `[MCP] Merged PATH: ${shellPaths.length} paths from shell + ${processPaths.length - (allPaths.length - shellPaths.length)} unique paths from process = ${allPaths.length} total`,
        );
      } else if (shellEnv.PATH) {
        env.PATH = shellEnv.PATH;
        log(`[MCP] Using shell PATH only`);
      }

      log(
        `[MCP] Enhanced environment with ${Object.keys(shellEnv).length} variables from shell`,
      );
    } catch (error: unknown) {
      logWarn(
        `[MCP] Could not get environment from shell: ${error instanceof Error ? error.message : String(error)}`,
      );
      logWarn(`[MCP] Using limited process.env, MCP servers may fail`);
    }
  } else if (platform === "win32") {
    // Windows: try PowerShell to get user PATH
    // Use full path to avoid relying on PATH in Electron packaged environment
    const psExe = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    try {
      const { stdout } = await execFileAsync(
        psExe,
        [
          "-NoProfile",
          "-Command",
          "[Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')",
        ],
        { timeout: 5000 },
      );
      if (stdout.trim()) {
        const pathDelimiter = ";";
        const winPaths = stdout
          .trim()
          .split(pathDelimiter)
          .filter((p) => p.trim());
        const currentPaths = (env.PATH || "")
          .split(pathDelimiter)
          .filter((p) => p.trim());
        const allPaths = [...winPaths];
        for (const p of currentPaths) {
          if (!allPaths.some((ep) => ep.toLowerCase() === p.toLowerCase())) {
            allPaths.push(p);
          }
        }
        env.PATH = allPaths.join(pathDelimiter);
        log(
          `[MCP] Enhanced Windows PATH: ${winPaths.length} user/machine paths + ${allPaths.length - winPaths.length} unique process paths = ${allPaths.length} total`,
        );
      }
    } catch (error: unknown) {
      logWarn(
        `[MCP] Could not get Windows PATH from PowerShell: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Add bundled Node.js bin directory to PATH (highest priority)
  // This ensures npx can find the bundled node executable
  const bundledNode = getBundledNodePath();
  if (bundledNode && env.PATH) {
    const nodeBinDir = path.dirname(bundledNode.node);
    const pathDelimiter = platform === "win32" ? ";" : ":";

    // Prepend bundled node bin directory to PATH
    const pathParts = env.PATH.split(pathDelimiter).filter((p) => p.trim());

    // Remove bundled path if it already exists (to avoid duplicates)
    const filteredPaths = pathParts.filter((p) => p !== nodeBinDir);

    // Add bundled path at the beginning
    env.PATH = [nodeBinDir, ...filteredPaths].join(pathDelimiter);
    log(`[MCP] Prepended bundled Node.js bin to PATH: ${nodeBinDir}`);
  }

  log(`[MCP] Final PATH: ${env.PATH?.substring(0, 150)}...`);

  return env;
}

let cachedBaseEnv: Record<string, string> | undefined;

function hasNonEmptyEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isProtectedConfigEnvKey(key: string): boolean {
  return (
    key.startsWith("OPENAI_") ||
    key.startsWith("ANTHROPIC_") ||
    key.startsWith("DeskWand_") ||
    key.startsWith("COWORK_")
  );
}

export function mergeShellEnvForMcp(
  baseEnv: Record<string, string>,
  shellEnv: Record<string, string>,
): Record<string, string> {
  const merged = { ...baseEnv };
  for (const [key, value] of Object.entries(shellEnv)) {
    if (key === "PATH") {
      continue;
    }
    if (isProtectedConfigEnvKey(key)) {
      continue;
    }
    if (hasNonEmptyEnvValue(merged[key])) {
      continue;
    }
    if (typeof value === "string" && value.length > 0) {
      merged[key] = value;
    }
  }
  return merged;
}
