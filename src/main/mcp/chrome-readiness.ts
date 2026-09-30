/**
 * Chrome debug port 就绪等待与拉起（从 mcp-manager.ts 抽出的独立模块）。
 *
 * 与旧实现的一处行为差异（设计 §5.3.1 已记录）：
 * 旧 `ensureChromeReady(serverId, serverName, client)` 里有两层 `client.callTool({name:"list_pages"})`
 * 探测（已就绪时一次；拉起 Chrome 后最多 5 次重试）。而传输的 `start()` 阶段**还没有 MCP client**，
 * 那两层探测无处可放。因此改为：
 *  - `start()` 前只做端口就绪等待（本模块）
 *  - 探测挪到**首次工具调用失败时**（`withChromeRetry`，由传输适配器在 send 失败时调用），
 *    保留「失败后重新等 Chrome 再重试」的恢复行为
 *
 * 错误文案仍用 `errors.chromeNotReady`，与旧实现一致。
 */
import { app } from "electron";
import path from "node:path";
import { log, logWarn, logError } from "../utils/logger";
import { t } from "../i18n";

export async function isChromeDebugPortReady(): Promise<boolean> {
  try {
    log(`[MCP] Checking Chrome debug port: http://localhost:9222/json/version`);
    const response = await fetch("http://localhost:9222/json/version", {
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      const data = await response.json();
      log(`[MCP] Chrome debug port response: ${JSON.stringify(data)}`);
      return true;
    } else {
      log(`[MCP] Chrome debug port returned status: ${response.status}`);
      return false;
    }
  } catch (error: unknown) {
    log(
      `[MCP] Chrome debug port check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
export async function waitForChromeDebugPort(
  maxRetries: number = 15,
  delayMs: number = 1000,
): Promise<boolean> {
  log(`[MCP] Waiting for Chrome debug port (max ${maxRetries} retries)...`);

  for (let i = 0; i < maxRetries; i++) {
    const isReady = await isChromeDebugPortReady();
    if (isReady) {
      log(`[MCP] Chrome debug port ready ✓ (attempt ${i + 1})`);
      return true;
    }

    if (i < maxRetries - 1) {
      log(
        `[MCP] Port not ready, retrying in ${delayMs}ms... (${i + 1}/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  logWarn(`[MCP] Chrome debug port not ready after ${maxRetries} attempts`);
  return false;
}
export function getChromeUserDataDir(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path");
  // Use userData so the debug profile survives reboots and isn't wiped by OS temp-dir cleanup
  return path.join(app.getPath("userData"), "chrome-mcp-debug");
}
export async function startChromeWithDebugging(): Promise<void> {
  const { spawn } = await import("child_process");
  const os = await import("os");

  const platform = os.platform();
  const userDataDir = getChromeUserDataDir();

  log(`[MCP] Platform: ${platform}`);
  log(`[MCP] User data dir: ${userDataDir}`);

  // Chrome 136+ requires --user-data-dir for remote debugging
  // Without it, --remote-debugging-port may be ignored

  const chromeArgs = [
    "--remote-debugging-port=9222",
    "--user-data-dir=" + userDataDir,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    "about:blank",
  ];

  let chromePath: string;
  if (platform === "darwin") {
    chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  } else if (platform === "win32") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    // Chrome can be installed in per-user (%LOCALAPPDATA%) or system-wide locations
    const candidates = [
      path.join(
        process.env.LOCALAPPDATA || "",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
      path.join(
        process.env["PROGRAMFILES"] || "C:\\Program Files",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
      path.join(
        process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
    ];
    chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"; // fallback
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        chromePath = candidate;
        break;
      }
    }
  } else {
    chromePath = "google-chrome";
  }

  log(`[MCP] Chrome path: ${chromePath}`);
  log(`[MCP] Chrome args: ${JSON.stringify(chromeArgs)}`);

  try {
    const chromeProcess = spawn(chromePath, chromeArgs, {
      detached: true,
      stdio: "ignore",
    });
    chromeProcess.unref();

    log(`[MCP] Chrome spawned successfully`);
  } catch (error: unknown) {
    // ENOENT means the Chrome executable was not found — re-throw so the caller knows
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Chrome executable not found at: ${chromePath}. Please install Google Chrome.`,
      );
    }
    logWarn(`[MCP] Chrome startup command completed with warning`);
    logWarn(
      `[MCP] Error message: ${error instanceof Error ? error.message : String(error)}`,
    );
    const spawnErr = error as { stdout?: string; stderr?: string };
    if (spawnErr.stdout) {
      log(`[MCP] stdout: ${spawnErr.stdout}`);
    }
    if (spawnErr.stderr) {
      log(`[MCP] stderr: ${spawnErr.stderr}`);
    }
  }
}
/**
 * `start()` 前调用：确保 Chrome 就绪。签名从旧的
 * `(serverId, serverName, client)` 收敛为 `(serverName)`，探测部分见文件头说明。
 */
export async function ensureChromeReady(serverName: string): Promise<void> {
  log(`[MCP] Ensuring Chrome is ready for ${serverName}...`);

  if (await isChromeDebugPortReady()) {
    log(`[MCP] ✓ Chrome debug port (9222) is accessible`);
    return;
  }

  log(`[MCP] ✗ Chrome debug port (9222) not accessible`);
  await startChromeWithDebugging();
  const ready = await waitForChromeDebugPort(15, 1000);
  if (!ready) {
    logError(
      `[MCP] ❌ Chrome debug port did not become ready after 15 seconds`,
    );
    throw new Error(
      t("errors.chromeNotReady", { detail: "debug port did not become ready" }),
    );
  }
  log(`[MCP] ✓ Chrome debug port is now ready`);
}

/** 需要 Chrome 的 MCP server 名单（沿用旧实现的判定语义）。 */
export function mcpServerNeedsChrome(serverName: string): boolean {
  return /chrome|gui[_-]?operate/i.test(serverName);
}

/**
 * 首次工具调用失败时的恢复路径：重新等 Chrome 就绪，再让调用方重试一次。
 */
export async function withChromeRetry<T>(
  serverName: string,
  attempt: () => Promise<T>,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!mcpServerNeedsChrome(serverName)) throw error;
    logWarn(`[MCP] tool call failed for ${serverName}, re-waiting for Chrome`);
    await waitForChromeDebugPort(15, 1000);
    return attempt();
  }
}
