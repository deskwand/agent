/**
 * @module main/index
 *
 * Electron main-process entry point (2181 lines).
 *
 * Responsibilities:
 * - App lifecycle: ready, activate, before-quit, window-will-close
 * - Central IPC hub: ~60 handlers namespaced as config.*, mcp.*, session.*,
 *   sandbox.*, logs.*, remote.*, schedule.*, etc.
 * - BrowserWindow creation and deep-link / protocol handling
 *
 * Dependencies: session-manager, config-store, mcp-manager, sandbox-adapter,
 *               skills-manager, scheduled-task-manager, nav-server, remote-manager
 */
import "./setup-userdata";
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  nativeTheme,
  Tray,
} from "electron";
import { join, resolve, dirname, isAbsolute, basename, extname } from "path";
import * as fs from "fs";
import { execFileSync } from "child_process";
import { config } from "dotenv";
import { initDatabase, closeDatabase } from "./db/database";
import { SessionManager } from "./session/session-manager";
import { SkillsManager } from "./skills/skills-manager";
import { MemoryService } from "./memory/memory-service";
import { MemoryExtension } from "./memory/memory-extension";
import { GoalExtension } from "./extensions/goal-extension";
import {
  BrowserViewManager,
  BROWSER_CDP_PORT,
} from "./browser/browser-view-manager";
import { AgentRuntimeExtensionManager } from "./extensions/agent-runtime-extension-manager";
import {
  buildLegacyEnvBridgeSnapshot,
  configStore,
  getPiAiModelPresets,
  PROVIDER_PRESETS,
  type AppConfig,
  type AppTheme,
  type ThemePreset,
  type SaveProviderPayload,
  type ProviderProfileKey,
} from "./config/config-store";
import { runConfigApiTest } from "./config/config-test-routing";
import { listOllamaModels } from "./config/ollama-api";
import { mcpConfigStore } from "./mcp/mcp-config-store";
import { getSandboxAdapter, shutdownSandbox } from "./sandbox/sandbox-adapter";
import { SandboxSync } from "./sandbox/sandbox-sync";
import { WSLBridge } from "./sandbox/wsl-bridge";
import { LimaBridge } from "./sandbox/lima-bridge";
import { getSandboxBootstrap } from "./sandbox/sandbox-bootstrap";
import type { MCPServerConfig } from "./mcp/mcp-manager";
import type {
  ClientEvent,
  ServerEvent,
  ApiTestInput,
  ApiTestResult,
  DiagnosticInput,
  ProviderModelInfo,
} from "../renderer/types";
import { remoteManager, type AgentExecutor } from "./remote/remote-manager";
import { remoteConfigStore } from "./remote/remote-config-store";
import type {
  GatewayConfig,
  FeishuChannelConfig,
  ChannelType,
} from "./remote/types";
import { startNavServer, stopNavServer } from "./nav-server";
import {
  ScheduledTaskManager,
  type ScheduledTaskCreateInput,
  type ScheduledTaskUpdateInput,
} from "./schedule/scheduled-task-manager";
import { createScheduledTaskStore } from "./schedule/scheduled-task-store";
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
} from "../shared/schedule/task-title";
import {
  isUncPath,
  isWindowsDrivePath,
  localPathFromAppUrlPathname,
  localPathFromFileUrl,
  decodePathSafely,
} from "../shared/local-file-path";
import { eventRequiresSessionManager } from "./client-event-utils";
import { getUnsupportedWorkspacePathReason } from "./workspace-path-constraints";
import { getDefaultWorkingDirPath } from "../shared/workspace-path";
import {
  log,
  logWarn,
  logError,
  getLogFilePath,
  getLogsDirectory,
  getAllLogFiles,
  closeLogFile,
  setDevLogsEnabled,
  isDevLogsEnabled,
} from "./utils/logger";
import { listRecentWorkspaceFiles } from "./utils/recent-workspace-files";
import { buildDiagnosticsSummary } from "./utils/diagnostics-summary";
import { autoUpdater } from "electron-updater";
import { initUpdater } from "./updater";

// Current working directory (persisted between sessions)
let currentWorkingDir: string | null = null;

// Diff buffer for review panel (pushed by editor tools)
interface PushedDiff {
  title: string;
  source: "editor";
  content: string; // unified diff text
  createdAt: number;
}
let pushedDiff: PushedDiff | null = null;

// Load .env file from project root (for development)
const envPath = resolve(__dirname, "../../.env");
log("[dotenv] Loading from:", envPath);
const dotenvResult = config({ path: envPath });
if (dotenvResult.error) {
  logWarn("[dotenv] Failed to load .env:", dotenvResult.error.message);
} else {
  log("[dotenv] Loaded successfully");
}

// Saved config is read directly by runtime services; legacy MCP env is injected per subprocess.
if (configStore.isConfigured()) {
  log(
    "[Config] Saved configuration detected. Runtime services will read config directly.",
  );
}

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let browserViewManager: BrowserViewManager | null = null;
let sessionManager: SessionManager | null = null;
let skillsManager: SkillsManager | null = null;
let memoryService: MemoryService | null = null;
let scheduledTaskManager: ScheduledTaskManager | null = null;

function sanitizeDiagnosticBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.origin}${pathname}`;
  } catch {
    return value.replace(/[?#].*$/, "");
  }
}

async function resolveScheduledTaskTitle(
  prompt: string,
  _cwd?: string,
  fallbackTitle?: string,
): Promise<string> {
  const normalizedPrompt = prompt.trim();
  const fallback = fallbackTitle
    ? buildScheduledTaskTitle(fallbackTitle)
    : buildScheduledTaskFallbackTitle(normalizedPrompt);
  if (!sessionManager) {
    return fallback;
  }
  try {
    return await sessionManager.generateScheduledTaskTitle(normalizedPrompt);
  } catch (error) {
    logWarn(
      "[Schedule] Failed to generate title via session title flow, using fallback",
      error,
    );
    return fallback;
  }
}

async function waitForDevServer(
  url: string,
  maxAttempts = 30,
  intervalMs = 500,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        if (attempt > 1) {
          log(`[App] Dev server ready after ${attempt} attempt(s): ${url}`);
        }
        return true;
      }
    } catch {
      // Ignore and retry until timeout
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  logWarn(`[App] Dev server did not become ready within timeout: ${url}`);
  return false;
}

// Single-instance lock: skip in dev mode so vite-plugin-electron can restart freely
// without the old process blocking the new one during async cleanup.
const isDev = !!process.env.VITE_DEV_SERVER_URL;
const ELECTRON_DEVTOOLS_DEBUG_PORT = BROWSER_CDP_PORT;

// Enable Chrome DevTools Protocol so the renderer and internal browser can be
// inspected and controlled via CDP (e.g. by chrome-devtools-mcp).
// External Chrome MCP uses 9222 → keep a separate port.
app.commandLine.appendSwitch(
  "remote-debugging-port",
  ELECTRON_DEVTOOLS_DEBUG_PORT,
);
app.commandLine.appendSwitch(
  "remote-allow-origins",
  `http://localhost:${ELECTRON_DEVTOOLS_DEBUG_PORT}`,
);

// Linux sandbox / GPU workarounds.
//
// Sandbox: AppImage mounts are nosuid → SUID chrome-sandbox helper cannot work.
// deb installs have chrome-sandbox with root:root 4755 (set by postinst script).
// Detect at runtime: only add --no-sandbox when SUID sandbox is not available.
//
// GPU: Vulkan/ANGLE init often fails on headless, SSH, or misconfigured
// X11/Wayland sessions, leaving a blank white window. --disable-gpu falls back
// to software rasterizer (slower but reliable).
if (process.platform === "linux") {
  // Check whether SUID sandbox is properly configured.
  let suidSandboxOk = false;
  try {
    const sandboxPath = join(dirname(process.execPath), "chrome-sandbox");
    const stats = fs.statSync(sandboxPath);
    // SUID bit (0o4000) + owned by root (uid 0)
    suidSandboxOk = (stats.mode & 0o4000) !== 0 && stats.uid === 0;
  } catch {
    // chrome-sandbox not found — no SUID sandbox available.
  }

  if (!suidSandboxOk) {
    app.commandLine.appendSwitch("no-sandbox");
    log("[App] Linux — SUID sandbox not available, --no-sandbox");
  } else {
    log("[App] Linux — SUID sandbox properly configured, keeping sandbox");
  }

  if (process.env.DESKWAND_ENABLE_GPU === "1") {
    log("[App] Linux — GPU acceleration enabled via DESKWAND_ENABLE_GPU=1");
  } else {
    app.commandLine.appendSwitch("disable-gpu");
    log("[App] Linux — --disable-gpu (set DESKWAND_ENABLE_GPU=1 to override)");
  }
}

const hasSingleInstanceLock = isDev || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  logWarn("[App] Another instance is already running, quitting this instance");
  app.quit();
} else if (!isDev) {
  app.on("second-instance", () => {
    const existingWindow =
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());

    if (!existingWindow) {
      log("[App] No existing window found, creating new one");
      createWindow();
      return;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = existingWindow;
    }
    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }
    existingWindow.show();
    existingWindow.focus();
    log("[App] Blocked second instance and focused existing window");
  });
}

// Tray instance (kept alive to prevent GC)
let tray: Tray | null = null;

const THEME_PRESET_BG: Record<string, { dark: string; light: string }> = {
  graphite: { dark: "#18181b", light: "#ffffff" },
  paper: { dark: "#1c1a16", light: "#fdfbf7" },
  void: { dark: "#000000", light: "#ffffff" },
  ocean: { dark: "#0c1222", light: "#f8fafc" },
  forest: { dark: "#111810", light: "#fafbf9" },
  ember: { dark: "#1a1512", light: "#fdfbf9" },
  aurora: { dark: "#120f1a", light: "#faf9fd" },
};

function buildMacMenu() {
  if (process.platform !== "darwin") return;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Preferences…",
          accelerator: "CmdOrCtrl+,",
          click: () =>
            mainWindow?.webContents.send("server-event", {
              type: "navigate",
              payload: "settings",
            }),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "close" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupTray() {
  if (tray) return;

  // Use .ico on Windows for proper multi-resolution tray support; fall back to .png if absent
  const iconName =
    process.platform === "darwin"
      ? "tray-iconTemplate.png"
      : process.platform === "win32"
        ? "tray-icon.ico"
        : "tray-icon.png";
  // TODO: create resources/tray-icon.ico from tray-icon.png for full Windows tray fidelity
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, iconName)
    : join(__dirname, "../../resources", iconName);

  // On Windows, fall back to .png if the .ico file has not been created yet
  const resolvedIconPath =
    process.platform === "win32" && !fs.existsSync(iconPath)
      ? app.isPackaged
        ? join(process.resourcesPath, "tray-icon.png")
        : join(__dirname, "../../resources", "tray-icon.png")
      : iconPath;

  // Gracefully skip tray if icon is missing (e.g. dev environment)
  if (!fs.existsSync(resolvedIconPath)) {
    log("[Tray] Icon not found at", resolvedIconPath, "— skipping tray setup");
    return;
  }

  tray = new Tray(resolvedIconPath);
  tray.setToolTip("DeskWand");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show / Hide Window",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow();
        } else if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "New Session",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send("server-event", { type: "new-session" });
        }
      },
    },
    {
      label: "Settings",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send("server-event", {
            type: "navigate",
            payload: "settings",
          });
        }
      },
    },
    { type: "separator" },
    { label: "Quit", role: "quit" },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getSavedThemePreference(): AppTheme {
  const theme = configStore.get("theme");
  return theme === "dark" || theme === "system" ? theme : "light";
}

function resolveEffectiveTheme(theme: AppTheme): "dark" | "light" {
  if (theme === "system") {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }
  return theme;
}

function createWindow() {
  const savedTheme = getSavedThemePreference();
  // Leave nativeTheme.themeSource at its default ("system") so OS theme
  // changes always trigger the "updated" event and are forwarded to the
  // renderer as native-theme.changed. The visual theme is independently
  // controlled by CSS and the window background color.
  const effectiveTheme = resolveEffectiveTheme(savedTheme);
  const themePreset = (configStore.get("themePreset") as string) || "graphite";
  const presetBg = THEME_PRESET_BG[themePreset] || THEME_PRESET_BG.graphite;
  const THEME =
    effectiveTheme === "dark"
      ? {
          background: presetBg.dark,
          titleBar: presetBg.dark,
          titleBarSymbol: "#f4f4f5",
        }
      : {
          background: presetBg.light,
          titleBar: presetBg.light,
          titleBarSymbol: "#09090b",
        };

  // Platform-specific window configuration
  const isMac = process.platform === "darwin";
  const isWindows = process.platform === "win32";

  // Base window options
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: THEME.background,
    icon: (() => {
      const windowIconName = isMac
        ? "icon.icns"
        : isWindows
          ? "icon.ico"
          : "icon.png";
      return app.isPackaged
        ? join(process.resourcesPath, windowIconName)
        : join(__dirname, `../../resources/${windowIconName}`);
    })(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };

  if (isMac) {
    // macOS: Use hiddenInset for native traffic light buttons
    windowOptions.titleBarStyle = "hiddenInset";
    windowOptions.trafficLightPosition = { x: 16, y: 12 };
  } else if (isWindows) {
    // Windows: Use frameless window with custom titlebar
    // Note: frame: false removes native frame, allowing custom titlebar
    windowOptions.frame = false;
  } else {
    // Linux: Use frameless window
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);

  const allowedOrigins = new Set<string>();
  if (process.env.VITE_DEV_SERVER_URL) {
    try {
      allowedOrigins.add(new URL(process.env.VITE_DEV_SERVER_URL).origin);
    } catch {
      // 忽略无效的开发服务地址
    }
  }
  const allowedProtocols = new Set<string>(["file:", "devtools:"]);

  const isExternalUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (allowedProtocols.has(parsed.protocol)) {
        return false;
      }
      if (allowedOrigins.has(parsed.origin)) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const extractLocalPathFromNavigationUrl = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "file:") {
        return localPathFromFileUrl(url);
      }
      if (!allowedOrigins.has(parsed.origin)) {
        return null;
      }
      return localPathFromAppUrlPathname(parsed.pathname || "");
    } catch {
      return null;
    }
  };

  async function revealNavigationTarget(url: string): Promise<boolean> {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (!localPath) {
      return false;
    }
    return revealFileInFolder(localPath);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      void revealNavigationTarget(url);
      return { action: "deny" };
    }
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      event.preventDefault();
      void revealNavigationTarget(url);
      return;
    }
    if (isExternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    void (async () => {
      await waitForDevServer(devServerUrl, 40, 500);
      if (!mainWindow || mainWindow.isDestroyed()) return;

      try {
        await mainWindow.loadURL(devServerUrl);
      } catch (error) {
        logError("[App] Failed to load dev server URL:", error);
      }
    })();
    // mainWindow.webContents.openDevTools(); // Commented out - open manually with Cmd+Option+I if needed
  } else {
    mainWindow.loadFile(join(__dirname, "../../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Notify renderer of fullscreen state changes (for macOS titlebar spacer)
  mainWindow.on("enter-full-screen", () => {
    log("[Window] enter-full-screen");
    mainWindow?.webContents.send("window.fullscreen-changed", true);
  });
  mainWindow.on("leave-full-screen", () => {
    log("[Window] leave-full-screen");
    mainWindow?.webContents.send("window.fullscreen-changed", false);
  });

  // Notify renderer about config status after window is ready
  mainWindow.webContents.on("did-finish-load", () => {
    const isConfigured = configStore.isConfigured();
    log("[Config] Notifying renderer, isConfigured:", isConfigured);
    sendToRenderer({
      type: "config.status",
      payload: {
        isConfigured,
        config: configStore.getAll(),
      },
    });

    // Send current working directory to renderer
    sendToRenderer({
      type: "workdir.changed",
      payload: { path: currentWorkingDir || "" },
    });

    // Start sandbox bootstrap after window is loaded
    startSandboxBootstrap();
  });
}

/**
 * Initialize default working directory
 * This is always the app's default_working_dir in userData - it never changes
 * Each session can have its own cwd that differs from this default
 */
function initializeDefaultWorkingDir(): string {
  // Create default working directory in user data path (this is the permanent global default)
  const userDataPath = app.getPath("userData");
  const defaultDir = getDefaultWorkingDirPath(userDataPath);

  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
    log("[App] Created default working directory:", defaultDir);
  }

  currentWorkingDir = defaultDir;

  log("[App] Global default working directory:", currentWorkingDir);
  return currentWorkingDir;
}

/**
 * Get current working directory
 */
function getWorkingDir(): string | null {
  return currentWorkingDir;
}

function createProjectDirectory(name: string): {
  success: boolean;
  path: string;
  error?: string;
} {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return { success: false, path: "", error: "Project name is required" };
  }

  if (/[\\/:*?"<>|]/.test(normalizedName)) {
    return {
      success: false,
      path: "",
      error: "Project name contains invalid characters",
    };
  }

  const baseDir = join(
    currentWorkingDir || initializeDefaultWorkingDir(),
    "projects",
  );
  const projectDir = join(baseDir, normalizedName);
  const unsupportedReason = getWorkspacePathUnsupportedReason(projectDir);
  if (unsupportedReason) {
    return { success: false, path: projectDir, error: unsupportedReason };
  }

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  if (fs.existsSync(projectDir)) {
    return {
      success: false,
      path: projectDir,
      error: "Project already exists",
    };
  }

  fs.mkdirSync(projectDir, { recursive: true });
  return { success: true, path: projectDir };
}

function normalizeWorkspacePath(
  workspacePath: string | null | undefined,
): string {
  return workspacePath?.trim().replace(/[\/]+$/, "") || "";
}

function getWorkspacePathUnsupportedReason(
  workspacePath?: string,
): string | null {
  return getUnsupportedWorkspacePathReason({
    platform: process.platform,
    sandboxEnabled: configStore.get("sandboxEnabled") !== false,
    workspacePath,
  });
}

/**
 * Set working directory
 * - If sessionId is provided: update only that session's cwd (for switching directories within a chat)
 * - If no sessionId: update UI display only (for WelcomeView - will be used when creating new session)
 *
 * Note: The global default (currentWorkingDir) is NEVER changed after initialization.
 * It is always app.getPath('userData')/default_working_dir
 */
async function setWorkingDir(
  newDir: string,
  sessionId?: string,
): Promise<{ success: boolean; path: string; error?: string }> {
  const unsupportedReason = getWorkspacePathUnsupportedReason(newDir);
  if (unsupportedReason) {
    return { success: false, path: newDir, error: unsupportedReason };
  }

  if (!fs.existsSync(newDir)) {
    return { success: false, path: newDir, error: "Directory does not exist" };
  }

  if (sessionId && sessionManager) {
    // Update only this session's cwd - don't change the global default
    log("[App] Updating session cwd:", sessionId, "->", newDir);
    sessionManager.updateSessionCwd(sessionId, newDir);

    // Clear this session's sandbox mapping so next query uses the new directory
    SandboxSync.clearSession(sessionId);
    const { LimaSync } = await import("./sandbox/lima-sync");
    LimaSync.clearSession(sessionId);
  }

  // Notify renderer of workdir change (for UI display)
  // This updates what the user sees, and will be passed to startSession for new sessions
  sendToRenderer({
    type: "workdir.changed",
    payload: { path: newDir },
  });

  log(
    "[App] Working directory for UI updated:",
    newDir,
    sessionId ? `(session: ${sessionId})` : "(pending new session)",
  );

  return { success: true, path: newDir };
}

/**
 * Start sandbox bootstrap in the background
 * This pre-initializes WSL/Lima environment at app startup
 */
async function startSandboxBootstrap(): Promise<void> {
  // Skip sandbox bootstrap if disabled - use native mode directly
  const sandboxEnabled = configStore.get("sandboxEnabled");
  if (sandboxEnabled === false) {
    log("[App] Sandbox disabled, skipping bootstrap (using native mode)");
    return;
  }

  const bootstrap = getSandboxBootstrap();

  // Skip if already complete
  if (bootstrap.isComplete()) {
    log("[App] Sandbox bootstrap already complete");
    return;
  }

  // Set up progress callback to notify renderer
  bootstrap.setProgressCallback((progress) => {
    sendToRenderer({
      type: "sandbox.progress",
      payload: progress,
    });
  });

  // Start bootstrap (non-blocking)
  log("[App] Starting sandbox bootstrap...");
  try {
    const result = await bootstrap.bootstrap();
    log("[App] Sandbox bootstrap complete:", result.mode);
  } catch (error) {
    logError("[App] Sandbox bootstrap error:", error);
  }
}

// 发送事件到渲染进程（含远程会话拦截）
function sendToRenderer(event: ServerEvent) {
  const payload =
    "payload" in event
      ? (event.payload as { sessionId?: string; [key: string]: unknown })
      : undefined;
  const sessionId = payload?.sessionId;

  // 判断是否远程会话
  if (sessionId && remoteManager.isRemoteSession(sessionId)) {
    // 处理远程会话事件

    // 拦截 stream.message，用于回传到远程通道
    if (event.type === "stream.message") {
      const message = payload.message as {
        role?: string;
        content?: Array<{ type: string; text?: string }>;
      };
      if (message?.role === "assistant" && message?.content) {
        // 提取助手文本内容
        const textContent = message.content
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text)
          .join("\n");

        if (textContent) {
          // 发送到远程通道（带缓冲）
          remoteManager
            .sendResponseToChannel(sessionId, textContent)
            .catch((err: Error) => {
              logError("[Remote] Failed to send response to channel:", err);
            });
        }
      }
    }

    // 拦截 trace.step 作为工具进度
    if (event.type === "trace.step") {
      const step = payload.step as {
        type?: string;
        toolName?: string;
        status?: string;
        title?: string;
      };
      if (step?.type === "tool_call" && step?.toolName) {
        remoteManager
          .sendToolProgress(
            sessionId,
            step.toolName,
            step.status === "completed"
              ? "completed"
              : step.status === "error"
                ? "error"
                : "running",
          )
          .catch((err: Error) => {
            logError("[Remote] Failed to send tool progress:", err);
          });
      }
    }

    // trace.update 预留；当前主要用 trace.step

    // 拦截 session.status 用于清理
    if (event.type === "session.status") {
      const status = payload.status as string;
      if (status === "idle" || status === "error") {
        // 会话结束，清空缓冲
        remoteManager.clearSessionBuffer(sessionId).catch((err: Error) => {
          logError("[Remote] Failed to clear session buffer:", err);
        });
      }
    }

    // 拦截 permission.request
    if (
      event.type === "permission.request" &&
      payload.toolUseId &&
      payload.toolName
    ) {
      log("[Remote] Intercepting permission for remote session:", sessionId);
      remoteManager
        .handlePermissionRequest(
          sessionId,
          payload.toolUseId as string,
          payload.toolName as string,
          (payload.input as Record<string, unknown> | undefined) ?? {},
        )
        .then((result) => {
          if (result !== null && sessionManager) {
            let permissionResult: "allow" | "deny" | "allow_always";
            if (result.allow) {
              permissionResult = result.remember ? "allow_always" : "allow";
            } else {
              permissionResult = "deny";
            }
            sessionManager.handlePermissionResponse(
              payload.toolUseId as string,
              permissionResult,
            );
          }
        })
        .catch((err) => {
          logError("[Remote] Failed to handle permission request:", err);
        });
      return; // 不发送到本地 UI
    }
  }

  // 发送到本地 UI
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("server-event", event);
  }
}

// Initialize app
app
  .whenReady()
  .then(async () => {
    // Smoke test mode: verify the app can start, then exit cleanly
    if (process.argv.includes("--smoke-test")) {
      log("[SmokeTest] App launched successfully in smoke test mode");
      log("[SmokeTest] Platform:", process.platform, "Arch:", process.arch);
      log(
        "[SmokeTest] Electron:",
        process.versions.electron,
        "Node:",
        process.versions.node,
      );
      try {
        // Verify critical native modules load
        require("node:sqlite");
        log("[SmokeTest] node:sqlite: OK");
      } catch (e) {
        log("[SmokeTest] FAIL: node:sqlite failed to load:", e);
        process.exit(1);
      }
      log("[SmokeTest] PASSED");
      process.exit(0);
    }

    // Apply dev logs setting from config
    const enableDevLogs = configStore.get("enableDevLogs");
    setDevLogsEnabled(enableDevLogs);

    // Log environment variables for debugging
    log("=== DeskWand Starting ===");
    log("Config file:", configStore.getPath());
    log("Is configured:", configStore.isConfigured());
    log("[Runtime] Using pi-coding-agent SDK for all providers");
    log("Developer logs:", enableDevLogs ? "Enabled" : "Disabled");
    const legacyEnvSnapshot = buildLegacyEnvBridgeSnapshot(
      configStore.getAll(),
    );
    log("Legacy MCP env snapshot:");
    log(
      "  ANTHROPIC_AUTH_TOKEN:",
      legacyEnvSnapshot.ANTHROPIC_AUTH_TOKEN ? "✓ Set" : "✗ Not set",
    );
    log(
      "  ANTHROPIC_BASE_URL:",
      legacyEnvSnapshot.ANTHROPIC_BASE_URL || "(not set)",
    );
    log("  DESKWAND_MODEL:", legacyEnvSnapshot.DESKWAND_MODEL || "(not set)");
    log("  DESKWAND_CODE_PATH:", process.env.DESKWAND_CODE_PATH || "(not set)");
    log(
      "  OPENAI_API_KEY:",
      legacyEnvSnapshot.OPENAI_API_KEY ? "✓ Set" : "✗ Not set",
    );
    log("  OPENAI_BASE_URL:", legacyEnvSnapshot.OPENAI_BASE_URL || "(not set)");
    log("  OPENAI_MODEL:", legacyEnvSnapshot.OPENAI_MODEL || "(not set)");
    log("  OPENAI_API_MODE:", legacyEnvSnapshot.OPENAI_API_MODE || "(default)");

    log("===========================");

    // Initialize default working directory
    initializeDefaultWorkingDir();
    log("Working directory:", currentWorkingDir);
    // 远程会话默认使用全局工作目录
    remoteManager.setDefaultWorkingDirectory(currentWorkingDir || undefined);

    // Initialize database
    const db = initDatabase();

    memoryService = new MemoryService(db);
    const extensionManager = new AgentRuntimeExtensionManager([
      new MemoryExtension(memoryService),
      new GoalExtension(),
    ]);

    // Initialize session manager before creating an interactive window.
    // This avoids session.start racing the startup path and hitting a null manager.
    sessionManager = new SessionManager(
      db,
      sendToRenderer,
      extensionManager,
    );
    skillsManager = new SkillsManager(db);
    // pi-ai handles model routing natively — no proxy warmup needed

    // macOS: application menu, dock menu, tray icon
    buildMacMenu();
    setupTray();

    // Show window after core managers are ready so first-load actions can be handled.
    createWindow();

    // Initialize internal browser panel (WebContentsView embedded in main window)
    if (mainWindow) {
      browserViewManager = new BrowserViewManager();
      browserViewManager.create(mainWindow);

      // Push browser state changes to renderer
      browserViewManager.setStatusChangeHandler((status) => {
        mainWindow?.webContents.send("browser.state-changed", status);
      });

      // Inject into session manager so AgentRunner can build internal browser tools
      sessionManager?.setBrowserViewManager(browserViewManager);
    }

    // macOS: dock menu
    if (process.platform === "darwin") {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: "New Session",
          click: () =>
            mainWindow?.webContents.send("server-event", {
              type: "new-session",
            }),
        },
        {
          label: "Settings",
          click: () =>
            mainWindow?.webContents.send("server-event", {
              type: "navigate",
              payload: "settings",
            }),
        },
      ]);
      app.dock?.setMenu(dockMenu);
    }

    // macOS: send initial system theme to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.on("did-finish-load", () => {
        sendToRenderer({
          type: "native-theme.changed",
          payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
        });
      });
    }

    // Listen for system theme changes
    nativeTheme.on("updated", () => {
      sendToRenderer({
        type: "native-theme.changed",
        payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
      });
      if (
        getSavedThemePreference() === "system" &&
        mainWindow &&
        !mainWindow.isDestroyed()
      ) {
        const tp = (configStore.get("themePreset") as string) || "graphite";
        const presetBg = THEME_PRESET_BG[tp] || THEME_PRESET_BG.graphite;
        mainWindow.setBackgroundColor(
          nativeTheme.shouldUseDarkColors ? presetBg.dark : presetBg.light,
        );
      }
    });

    // Auto-updater (delegated to updater.ts)
    initUpdater(sendToRenderer);

    startNavServer(() => mainWindow);

    const scheduledTaskStore = createScheduledTaskStore(db);
    scheduledTaskManager = new ScheduledTaskManager({
      store: scheduledTaskStore,
      executeTask: async (task) => {
        if (!sessionManager) {
          throw new Error("Session manager not initialized");
        }
        const unsupportedReason = getWorkspacePathUnsupportedReason(task.cwd);
        if (unsupportedReason) {
          throw new Error(unsupportedReason);
        }
        const fallbackTitle = buildScheduledTaskFallbackTitle(task.prompt);
        const needsRegeneratedTitle =
          !task.title?.trim() || task.title === fallbackTitle;
        const title = needsRegeneratedTitle
          ? await resolveScheduledTaskTitle(task.prompt, task.cwd, task.title)
          : buildScheduledTaskTitle(task.title);
        if (title !== task.title) {
          scheduledTaskStore.update(task.id, { title });
        }
        const started = await sessionManager.startSession(
          title,
          task.prompt,
          task.cwd,
        );
        // 定时任务创建的新会话需要主动同步到前端会话列表
        sendToRenderer({
          type: "session.update",
          payload: { sessionId: started.id, updates: started },
        });
        return { sessionId: started.id };
      },
      onTaskError: (taskId, error) => {
        sendToRenderer({
          type: "scheduled-task.error",
          payload: { taskId, error },
        });
      },
      now: () => Date.now(),
    });
    scheduledTaskManager.start();

    // 初始化远程管理器
    remoteManager.setRendererCallback(sendToRenderer);
    const agentExecutor: AgentExecutor = {
      startSession: async (title, prompt, cwd) => {
        if (!sessionManager) throw new Error("Session manager not initialized");
        const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
        if (unsupportedReason) {
          throw new Error(unsupportedReason);
        }
        return sessionManager.startSession(title, prompt, cwd);
      },
      continueSession: async (sessionId, prompt, content, cwd) => {
        if (!sessionManager) throw new Error("Session manager not initialized");
        if (cwd) {
          const result = await setWorkingDir(cwd, sessionId);
          if (!result.success) {
            throw new Error(
              result.error || "Failed to update working directory",
            );
          }
        }
        await sessionManager.continueSession(sessionId, prompt, content);
      },
      stopSession: async (sessionId) => {
        if (!sessionManager) throw new Error("Session manager not initialized");
        await sessionManager.stopSession(sessionId);
      },
      validateWorkingDirectory: async (cwd) => {
        const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
        if (unsupportedReason) {
          return unsupportedReason;
        }
        if (!fs.existsSync(cwd)) {
          return "Directory does not exist";
        }
        return null;
      },
    };
    remoteManager.setAgentExecutor(agentExecutor);

    // 远程控制启用时启动
    if (remoteConfigStore.isEnabled()) {
      remoteManager.start().catch((error) => {
        logError("[App] Failed to start remote control:", error);
      });
    }

    app.on("activate", () => {
      const hasVisibleWindow = BrowserWindow.getAllWindows().some(
        (w) => !w.isDestroyed(),
      );
      if (!hasVisibleWindow) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    logError("[App] Startup failed:", error);
    const message =
      error instanceof Error ? error.message : "Unknown startup error";
    dialog.showErrorBox(
      "DeskWand 启动失败",
      `${message}\n\n请查看日志获取更多信息。`,
    );
    app.quit();
  });

// Flag to prevent double cleanup
let isCleaningUp = false;

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}

/**
 * Cleanup all sandbox resources
 * Called on app quit (both Windows and macOS)
 */
async function cleanupSandboxResources(): Promise<void> {
  if (isCleaningUp) {
    log("[App] Cleanup already in progress, skipping...");
    return;
  }
  isCleaningUp = true;

  stopNavServer();
  scheduledTaskManager?.stop();
  tray?.destroy();
  tray = null;

  // 停止远程控制
  try {
    log("[App] Stopping remote control...");
    await withTimeout(remoteManager.stop(), 5000, "Remote control shutdown");
    log("[App] Remote control stopped");
  } catch (error) {
    logError("[App] Error stopping remote control:", error);
  }

  // Cleanup all sandbox sessions (sync changes back to host OS first)
  try {
    log("[App] Cleaning up all sandbox sessions...");

    // Cleanup WSL sessions
    await withTimeout(
      SandboxSync.cleanupAllSessions(),
      30000,
      "WSL session cleanup",
    );

    // Cleanup Lima sessions
    const { LimaSync } = await import("./sandbox/lima-sync");
    await withTimeout(
      LimaSync.cleanupAllSessions(),
      30000,
      "Lima session cleanup",
    );

    log("[App] Sandbox sessions cleanup complete");
  } catch (error) {
    logError("[App] Error cleaning up sandbox sessions:", error);
  }

  // Shutdown sandbox adapter
  try {
    await withTimeout(shutdownSandbox(), 8000, "Sandbox shutdown");
    log("[App] Sandbox shutdown complete");
  } catch (error) {
    logError("[App] Error shutting down sandbox:", error);
  }

  // Shutdown MCP servers
  try {
    const mcpManager = sessionManager?.getMCPManager();
    if (mcpManager) {
      log("[App] Shutting down MCP servers...");
      await withTimeout(mcpManager.shutdown(), 5000, "MCP shutdown");
      log("[App] MCP servers shutdown complete");
    }
  } catch (error) {
    logError("[App] Error shutting down MCP servers:", error);
  }

  try {
    closeDatabase();
  } catch (error) {
    logError("[App] Error closing database:", error);
  }

  closeLogFile();

  // pi-ai doesn't need proxy shutdown
}

// Handle app quit - window-all-closed (primary for Windows/Linux)
app.on("window-all-closed", async () => {
  if (process.platform !== "darwin" || process.env.VITE_DEV_SERVER_URL) {
    // On Windows/Linux, closing all windows means quit.
    // On macOS dev mode, also quit — so vite-plugin-electron can restart cleanly
    // without the old process holding the single-instance lock.
    await cleanupSandboxResources();
    app.quit();
  }
  // On macOS production, keep app alive — cleanup happens in before-quit
});

// Handle SIGTERM/SIGINT (e.g. pkill) — route through app.quit() for clean shutdown
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => app.quit());
}

// Handle app quit - before-quit (for macOS Cmd+Q and other quit methods)
app.on("before-quit", async (event) => {
  if (!isCleaningUp) {
    // In dev mode, exit quickly — no need for async sandbox cleanup
    if (process.env.VITE_DEV_SERVER_URL) {
      stopNavServer();
      try {
        closeDatabase();
      } catch {
        /* best-effort */
      }
      closeLogFile();
      tray?.destroy();
      tray = null;
      return;
    }
    // Set the flag immediately before any await to prevent re-entrant cleanup
    isCleaningUp = true;
    event.preventDefault();
    try {
      await cleanupSandboxResources();
      browserViewManager?.destroy();
    } catch (error) {
      logError("[App] before-quit cleanup failed, forcing quit:", error);
    }
    app.quit();
  }
});

// IPC Handlers
ipcMain.on("client-event", async (_event, data: ClientEvent) => {
  try {
    await handleClientEvent(data);
  } catch (error) {
    logError("Error handling client event:", error);
    sendToRenderer({
      type: "error",
      payload: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
});

ipcMain.handle("client-invoke", async (_event, data: ClientEvent) => {
  return handleClientEvent(data);
});

ipcMain.handle("get-version", () => {
  try {
    return app.getVersion();
  } catch (error) {
    logError("[IPC] Error getting version:", error);
    return "unknown";
  }
});

ipcMain.handle("system.getTheme", () => {
  try {
    return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
  } catch (error) {
    logError("[IPC] Error getting theme:", error);
    return { shouldUseDarkColors: true };
  }
});

ipcMain.handle("shell.openExternal", async (_event, url: string) => {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      logWarn(
        "[shell.openExternal] Blocked URL with disallowed protocol:",
        parsed.protocol,
      );
      return false;
    }
  } catch {
    logWarn("[shell.openExternal] Blocked invalid URL:", url);
    return false;
  }

  return shell.openExternal(url);
});

async function revealFileInFolder(
  filePath: string,
  cwd?: string,
): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  const trimInput = filePath.trim();
  if (!trimInput) {
    return false;
  }

  let normalizedPath = decodePathSafely(trimInput);

  if (normalizedPath.startsWith("file://")) {
    const localPath = localPathFromFileUrl(normalizedPath);
    if (!localPath) {
      logWarn(
        "[shell.showItemInFolder] could not parse file URL:",
        normalizedPath,
      );
      return false;
    }
    normalizedPath = localPath;
  }

  const baseDir =
    cwd && isAbsolute(cwd) ? cwd : getWorkingDir() || app.getPath("home");
  if (
    !isAbsolute(normalizedPath) &&
    !isWindowsDrivePath(normalizedPath) &&
    !isUncPath(normalizedPath)
  ) {
    normalizedPath = resolve(baseDir, normalizedPath);
  }

  if (
    normalizedPath.startsWith("/workspace/") ||
    /^[A-Za-z]:[/\\]workspace[/\\]/i.test(normalizedPath)
  ) {
    const relativePart = normalizedPath.startsWith("/workspace/")
      ? normalizedPath.slice("/workspace/".length)
      : normalizedPath.replace(/^[A-Za-z]:[/\\]workspace[/\\]/i, "");
    normalizedPath = resolve(baseDir, relativePart);
  }

  if (!isUncPath(normalizedPath)) {
    normalizedPath = resolve(normalizedPath);
  }
  log("[shell.showItemInFolder] request:", {
    filePath,
    cwd,
    resolved: normalizedPath,
  });

  const findFileByName = (fileName: string, roots: string[]): string | null => {
    if (!fileName) {
      return null;
    }

    const visited = new Set<string>();
    const queue = roots
      .map((root) => resolve(root))
      .filter(
        (root) =>
          !!root && fs.existsSync(root) && fs.statSync(root).isDirectory(),
      );

    let scannedDirs = 0;
    const MAX_DIRS = 2000;

    while (queue.length > 0 && scannedDirs < MAX_DIRS) {
      const dir = queue.shift()!;
      if (visited.has(dir)) {
        continue;
      }
      visited.add(dir);
      scannedDirs += 1;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && entry.name === fileName) {
          return fullPath;
        }
        if (entry.isDirectory()) {
          queue.push(fullPath);
        }
      }
    }

    return null;
  };

  try {
    if (fs.existsSync(normalizedPath)) {
      const stat = fs.statSync(normalizedPath);
      if (stat.isDirectory()) {
        const openDirResult = await shell.openPath(normalizedPath);
        if (openDirResult) {
          logWarn(
            "[shell.showItemInFolder] openPath returned warning:",
            openDirResult,
          );
        }
      } else {
        if (process.platform === "darwin") {
          try {
            execFileSync("open", ["-R", normalizedPath]);
          } catch (error) {
            logWarn(
              "[shell.showItemInFolder] open -R failed, fallback to shell.showItemInFolder:",
              error,
            );
            shell.showItemInFolder(normalizedPath);
          }
        } else {
          shell.showItemInFolder(normalizedPath);
        }
      }
      return true;
    }

    const fileName = basename(normalizedPath);
    const defaultWorkingDir = getWorkingDir() || "";
    const discoveredPath = findFileByName(fileName, [
      cwd || "",
      defaultWorkingDir,
      join(app.getPath("userData"), "default_working_dir"),
    ]);

    if (discoveredPath) {
      logWarn(
        "[shell.showItemInFolder] resolved path not found, discovered by filename:",
        {
          requested: normalizedPath,
          discoveredPath,
        },
      );
      if (process.platform === "darwin") {
        try {
          execFileSync("open", ["-R", discoveredPath]);
        } catch (error) {
          logWarn(
            "[shell.showItemInFolder] open -R discovered file failed, fallback to shell.showItemInFolder:",
            error,
          );
          shell.showItemInFolder(discoveredPath);
        }
      } else {
        shell.showItemInFolder(discoveredPath);
      }
      return true;
    }

    const parentDir = dirname(normalizedPath);
    if (parentDir && fs.existsSync(parentDir)) {
      logWarn(
        "[shell.showItemInFolder] file not found, opening parent directory:",
        parentDir,
      );
      const openParentResult = await shell.openPath(parentDir);
      if (openParentResult) {
        logWarn(
          "[shell.showItemInFolder] openPath parent returned warning:",
          openParentResult,
        );
      }
      return true;
    }

    logWarn(
      "[shell.showItemInFolder] path and parent directory do not exist:",
      normalizedPath,
    );
    return false;
  } catch (error) {
    logError("[shell.showItemInFolder] failed:", error);
    return false;
  }
}

ipcMain.handle(
  "shell.showItemInFolder",
  async (_event, filePath: string, cwd?: string) => {
    return revealFileInFolder(filePath, cwd);
  },
);

ipcMain.handle("shell.openPath", async (_event, filePath: string) => {
  if (!filePath) return { error: "no-path" };
  const err = await shell.openPath(filePath);
  return { error: err || null };
});

// --- Review / Diff IPC handlers ---

ipcMain.handle(
  "review.pushDiff",
  async (_event, title: string, content: string) => {
    pushedDiff = { title, source: "editor", content, createdAt: Date.now() };
    log("[review] Pushed editor diff:", title, `(${content.length} chars)`);
    return { success: true };
  },
);

ipcMain.handle("review.clearDiff", async () => {
  pushedDiff = null;
  return { success: true };
});

async function getGitRoot(dirPath: string): Promise<string> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const { stdout } = await promisify(exec)("git rev-parse --show-toplevel", {
      cwd: dirPath,
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return dirPath;
  }
}

async function runGitDiffStat(
  dirPath: string,
): Promise<
  Array<{ path: string; additions: number; deletions: number; status: string }>
> {
  const gitRoot = await getGitRoot(dirPath);
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    const { stdout } = await execAsync("git diff HEAD --numstat", {
      cwd: gitRoot,
      timeout: 10000,
    });
    const files: Array<{
      path: string;
      additions: number;
      deletions: number;
      status: string;
    }> = [];
    for (const line of stdout.trim().split("\n")) {
      const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (match) {
        const additions = parseInt(match[1], 10) || 0;
        const deletions = parseInt(match[2], 10) || 0;
        const gitRelPath = match[3].trim();
        files.push({ path: gitRelPath, additions, deletions, status: "M" });
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function runGitDiffForFile(
  dirPath: string,
  filePath: string,
): Promise<string> {
  const gitRoot = await getGitRoot(dirPath);
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    const { stdout } = await execAsync(`git diff -- "${filePath}"`, {
      cwd: gitRoot,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return "";
  }
}

function extractDiffFilesFromContent(content: string): Array<{
  path: string;
  additions: number;
  deletions: number;
  status: string;
}> {
  const files: Array<{
    path: string;
    additions: number;
    deletions: number;
    status: string;
  }> = [];
  const fileHeaderRegex = /^diff --git a\/(.+) b\/(.+)$/gm;
  let match;
  while ((match = fileHeaderRegex.exec(content)) !== null) {
    const path = match[2]; // b/ path
    // Count additions and deletions in this file's hunk
    const nextDiff = content.indexOf("\ndiff --git", match.index + 1);
    const fileContent = content.slice(
      match.index,
      nextDiff === -1 ? undefined : nextDiff,
    );
    const additions = (fileContent.match(/^\+(?!\+\+)/gm) || []).length;
    const deletions = (fileContent.match(/^-(?!--)/gm) || []).length;
    // Determine status from mode line or new file line
    const hasNew = fileContent.includes("\nnew file");
    const hasDeleted = fileContent.includes("\ndeleted file");
    const hasRename = fileContent.includes("\nrename ");
    const status = hasNew ? "A" : hasDeleted ? "D" : hasRename ? "R" : "M";
    files.push({ path, additions, deletions, status });
  }
  return files;
}

ipcMain.handle("review.getDiffFiles", async (_event, dirPath?: string) => {
  if (dirPath) {
    return await runGitDiffStat(dirPath);
  }
  if (pushedDiff) {
    return extractDiffFilesFromContent(pushedDiff.content);
  }
  return [];
});

ipcMain.handle(
  "review.getFileDiff",
  async (_event, filePath: string, dirPath?: string) => {
    if (dirPath) {
      return await runGitDiffForFile(dirPath, filePath);
    }
    if (pushedDiff) {
      // Extract the file's diff from the unified content
      const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(
        `diff --git a/${escaped} b/${escaped}[\\s\\S]*?(?=\\ndiff --git|$)`,
        "m",
      );
      const match = pushedDiff.content.match(pattern);
      return match ? match[0] : "";
    }
    return "";
  },
);

ipcMain.handle("git.hasChanges", async (_event, dirPath?: string) => {
  if (!dirPath) return { isRepo: false, changeCount: 0 };
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const { stdout } = await promisify(exec)("git diff HEAD --name-only", {
      cwd: dirPath,
      timeout: 5000,
    });
    const files = [...new Set(stdout.trim().split("\n").filter(Boolean))];
    return { isRepo: true, changeCount: files.length };
  } catch {
    return { isRepo: false, changeCount: 0 };
  }
});

ipcMain.handle(
  "artifacts.listRecentFiles",
  async (_event, cwd: string, sinceMs: number, limit: number = 50) => {
    if (!cwd || !isAbsolute(cwd)) {
      return [];
    }
    return listRecentWorkspaceFiles(cwd, sinceMs, limit);
  },
);

ipcMain.handle("dialog.selectFiles", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    title: "Select Files",
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths;
});

// File browser: list directory contents
ipcMain.handle("fs.listDirectory", async (_event, dirPath: string) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory())
          return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => ({
        name: entry.name,
        isDir: entry.isDirectory(),
        size: entry.isFile() ? fs.statSync(join(dirPath, entry.name)).size : 0,
        ext: entry.isFile() ? extname(entry.name).toLowerCase() : "",
      }));
  } catch (error) {
    logError("[fs.listDirectory] failed:", error);
    return [];
  }
});

// Read file content for file browser preview (text/image)

const IMAGE_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".avif",
] as const;
const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

ipcMain.handle("fs.readFile", async (_event, filePath: string) => {
  try {
    const resolved = resolve(filePath);
    if (!fs.existsSync(resolved)) {
      return { type: "error", message: "File not found" };
    }
    const stat = fs.statSync(resolved);
    const MAX = 10 * 1024 * 1024; // 10MB
    if (stat.size > MAX) {
      return { type: "error", message: "File too large" };
    }
    const ext = extname(resolved).toLowerCase();

    if ((IMAGE_EXTS as readonly string[]).includes(ext)) {
      const buf = fs.readFileSync(resolved);
      const b64 = buf.toString("base64");
      const mime = MIME_MAP[ext] || "application/octet-stream";
      return {
        type: "image",
        content: `data:${mime};base64,${b64}`,
        mimeType: mime,
      };
    }

    // Read as UTF-8 text
    const buf = fs.readFileSync(resolved);
    const text = buf.toString("utf-8");
    return { type: "text", content: text, ext };
  } catch (error) {
    logError("[fs.readFile] failed:", error);
    return { type: "error", message: String(error) };
  }
});

// Config IPC handlers
ipcMain.handle("config.get", () => {
  try {
    return configStore.getAll();
  } catch (error) {
    logError("[Config] Error getting config:", error);
    return {};
  }
});

ipcMain.handle("config.getPresets", async () => {
  try {
    return await getPiAiModelPresets();
  } catch (error) {
    logError("[Config] Error getting presets:", error);
    return PROVIDER_PRESETS;
  }
});

const buildAgentRuntimeSignature = (config: AppConfig): string =>
  JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    customProtocol: config.customProtocol,
    model: config.model,
    memoryEnabled: config.memoryEnabled,
    memoryRuntime: config.memoryRuntime,
  });

const syncConfigAfterMutation = async (previousConfig: AppConfig) => {
  // Mark as configured if any config set has usable credentials
  configStore.set("isConfigured", configStore.hasAnyUsableCredentials());

  const updatedConfig = configStore.getAll();
  const shouldReloadRunner =
    buildAgentRuntimeSignature(previousConfig) !==
    buildAgentRuntimeSignature(updatedConfig);
  const shouldReloadSandbox =
    previousConfig.sandboxEnabled !== updatedConfig.sandboxEnabled;

  if (sessionManager) {
    if (shouldReloadRunner) {
      sessionManager.reloadConfig();
    }
    if (shouldReloadSandbox) {
      await sessionManager
        .reloadSandbox()
        .catch((err) => logError("[Config] Sandbox reload failed:", err));
    }
    if (shouldReloadRunner || shouldReloadSandbox) {
      log(
        "[Config] Session manager config synced:",
        JSON.stringify({
          runnerReloaded: shouldReloadRunner,
          sandboxReloaded: shouldReloadSandbox,
        }),
      );
    }
  }

  // Notify renderer of config update
  const isConfigured = configStore.isConfigured();
  sendToRenderer({
    type: "config.status",
    payload: {
      isConfigured,
      config: updatedConfig,
    },
  });
  log(
    "[Config] Notified renderer of config update, isConfigured:",
    isConfigured,
  );
  return updatedConfig;
};

ipcMain.handle("config.save", async (_event, newConfig: Partial<AppConfig>) => {
  log("[Config] Saving config:", {
    ...newConfig,
    apiKey: newConfig.apiKey ? "***" : "",
    memoryRuntime: newConfig.memoryRuntime
      ? {
          ...newConfig.memoryRuntime,
          llm: newConfig.memoryRuntime.llm
            ? {
                ...newConfig.memoryRuntime.llm,
                apiKey: newConfig.memoryRuntime.llm.apiKey ? "***" : "",
              }
            : undefined,
          embedding: newConfig.memoryRuntime.embedding
            ? {
                ...newConfig.memoryRuntime.embedding,
                apiKey: newConfig.memoryRuntime.embedding.apiKey ? "***" : "",
              }
            : undefined,
        }
      : undefined,
  });

  const previousConfig = configStore.getAll();
  // Update config
  configStore.update(newConfig);
  const updatedConfig = await syncConfigAfterMutation(previousConfig);

  return { success: true, config: updatedConfig };
});

ipcMain.handle(
  "config.saveProvider",
  async (_event, payload: SaveProviderPayload) => {
    log("[Config] Saving provider:", payload.profileKey);
    const previousConfig = configStore.getAll();
    configStore.saveProvider(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  },
);

ipcMain.handle(
  "config.deleteProvider",
  async (_event, payload: { profileKey: ProviderProfileKey }) => {
    log("[Config] Deleting provider:", payload.profileKey);
    const previousConfig = configStore.getAll();
    configStore.deleteProvider(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  },
);

ipcMain.handle(
  "config.setActiveProvider",
  async (
    _event,
    payload: { profileKey: ProviderProfileKey; defaultModel?: string },
  ) => {
    log(
      "[Config] Setting active provider:",
      payload.profileKey,
      payload.defaultModel || "",
    );
    const previousConfig = configStore.getAll();
    configStore.setActiveProvider(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  },
);

ipcMain.handle(
  "config.renameSet",
  async (_event, payload: { id: string; name: string }) => {
    log("[Config] Renaming config set (legacy no-op):", payload);
    const previousConfig = configStore.getAll();
    // Keep handler temporarily to avoid hard crashes from stale renderer code during refactor.
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  },
);

ipcMain.handle("config.isConfigured", () => {
  try {
    return configStore.isConfigured();
  } catch (error) {
    logError("[Config] Error checking configured status:", error);
    return false;
  }
});

ipcMain.handle(
  "config.test",
  async (_event, payload: ApiTestInput): Promise<ApiTestResult> => {
    try {
      return await runConfigApiTest(payload, configStore.getAll());
    } catch (error) {
      logError("[Config] API test failed:", error);
      return {
        ok: false,
        errorType: "unknown",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle(
  "config.listModels",
  async (
    _event,
    payload: {
      provider: AppConfig["provider"];
      apiKey: string;
      baseUrl?: string;
    },
  ): Promise<ProviderModelInfo[]> => {
    if (payload.provider !== "ollama") {
      return [];
    }
    return listOllamaModels(payload);
  },
);

ipcMain.handle("config.diagnose", async (_event, payload: DiagnosticInput) => {
  try {
    const { runDiagnostics } = await import("./config/api-diagnostics");
    return await runDiagnostics(payload);
  } catch (error) {
    logError("[Config] Error running diagnostics:", error);
    throw error;
  }
});

ipcMain.handle(
  "config.discover-local",
  async (_event, payload?: { baseUrl?: string }) => {
    try {
      const { discoverLocalOllama } = await import("./config/api-diagnostics");
      return await discoverLocalOllama(payload);
    } catch (error) {
      logError("[Config] Error discovering local services:", error);
      return [];
    }
  },
);

// MCP Server IPC handlers
ipcMain.handle("mcp.getServers", () => {
  try {
    return mcpConfigStore.getServers();
  } catch (error) {
    logError("[MCP] Error getting servers:", error);
    return [];
  }
});

ipcMain.handle("mcp.getServer", (_event, serverId: string) => {
  try {
    return mcpConfigStore.getServer(serverId);
  } catch (error) {
    logError("[MCP] Error getting server:", error);
    return null;
  }
});

ipcMain.handle("mcp.saveServer", async (_event, config: MCPServerConfig) => {
  mcpConfigStore.saveServer(config);
  // Update only this specific server, not all servers
  if (sessionManager) {
    const mcpManager = sessionManager.getMCPManager();
    try {
      await mcpManager.updateServer(config);
      sessionManager.invalidateMcpServersCache();
      log(`[MCP] Server ${config.name} updated successfully`);
    } catch (err) {
      logError("[MCP] Failed to update server:", err);
      // Roll back: save the config with enabled=false so a broken connector
      // is not retried on next app startup
      if (config.enabled) {
        mcpConfigStore.saveServer({ ...config, enabled: false });
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMessage };
    }
  }
  return { success: true };
});

ipcMain.handle("mcp.deleteServer", async (_event, serverId: string) => {
  mcpConfigStore.deleteServer(serverId);
  // Remove and disconnect only this specific server
  if (sessionManager) {
    const mcpManager = sessionManager.getMCPManager();
    try {
      await mcpManager.removeServer(serverId);
      sessionManager.invalidateMcpServersCache();
      log(`[MCP] Server ${serverId} removed successfully`);
    } catch (err) {
      logError("[MCP] Failed to remove server:", err);
    }
  }
  return { success: true };
});

ipcMain.handle("mcp.getTools", () => {
  try {
    if (!sessionManager) {
      return [];
    }
    const mcpManager = sessionManager.getMCPManager();
    return mcpManager.getTools();
  } catch (error) {
    logError("[MCP] Error getting tools:", error);
    return [];
  }
});

ipcMain.handle("mcp.getServerStatus", () => {
  try {
    if (!sessionManager) {
      return [];
    }
    const mcpManager = sessionManager.getMCPManager();
    return mcpManager.getServerStatus();
  } catch (error) {
    logError("[MCP] Error getting server status:", error);
    return [];
  }
});

ipcMain.handle("mcp.getPresets", () => {
  try {
    return mcpConfigStore.getPresets();
  } catch (error) {
    logError("[MCP] Error getting presets:", error);
    return {};
  }
});

// Skills API handlers
ipcMain.handle("skills.getAll", async () => {
  try {
    if (!skillsManager) {
      throw new Error("Skills manager is still starting");
    }
    return await skillsManager.listSkills();
  } catch (error) {
    logError("[Skills] Error getting skills:", error);
    throw error;
  }
});

ipcMain.handle("skills.install", async (_event, skillPath: string) => {
  try {
    if (!skillsManager) {
      throw new Error("SkillsManager not initialized");
    }
    const skill = await skillsManager.installSkill(skillPath);
    sessionManager?.invalidateSkillsSetup();
    return { success: true, skill };
  } catch (error) {
    logError("[Skills] Error installing skill:", error);
    throw error;
  }
});

ipcMain.handle("skills.delete", async (_event, skillId: string) => {
  try {
    if (!skillsManager) {
      throw new Error("SkillsManager not initialized");
    }
    await skillsManager.uninstallSkill(skillId);
    sessionManager?.invalidateSkillsSetup();
    return { success: true };
  } catch (error) {
    logError("[Skills] Error deleting skill:", error);
    throw error;
  }
});

ipcMain.handle(
  "skills.setEnabled",
  async (_event, skillId: string, enabled: boolean) => {
    try {
      if (!skillsManager) {
        throw new Error("SkillsManager not initialized");
      }
      skillsManager.setSkillEnabled(skillId, enabled);
      sessionManager?.invalidateSkillsSetup();
      return { success: true };
    } catch (error) {
      logError("[Skills] Error toggling skill:", error);
      throw error;
    }
  },
);

ipcMain.handle("skills.validate", async (_event, skillPath: string) => {
  try {
    if (!skillsManager) {
      return { valid: false, errors: ["SkillsManager not initialized"] };
    }
    const result = await skillsManager.validateSkillFolder(skillPath);
    return result;
  } catch (error) {
    logError("[Skills] Error validating skill:", error);
    return { valid: false, errors: ["Validation failed"] };
  }
});

// Window control IPC handlers
ipcMain.on("window.minimize", () => {
  try {
    mainWindow?.minimize();
  } catch (error) {
    logError("[Window] Error minimizing:", error);
  }
});

ipcMain.on("window.maximize", () => {
  try {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  } catch (error) {
    logError("[Window] Error maximizing:", error);
  }
});

ipcMain.on("window.close", () => {
  try {
    mainWindow?.close();
  } catch (error) {
    logError("[Window] Error closing:", error);
  }
});

// Sandbox IPC handlers
ipcMain.handle("sandbox.getStatus", async () => {
  try {
    const adapter = getSandboxAdapter();
    const platform = process.platform;

    if (platform === "win32") {
      const wslStatus = await WSLBridge.checkWSLStatus();
      return {
        platform: "win32",
        mode: adapter.initialized ? adapter.mode : "none",
        initialized: adapter.initialized,
        wsl: wslStatus,
        lima: null,
      };
    } else if (platform === "darwin") {
      const limaStatus = await LimaBridge.checkLimaStatus();
      return {
        platform: "darwin",
        mode: adapter.initialized ? adapter.mode : "native",
        initialized: adapter.initialized,
        wsl: null,
        lima: limaStatus,
      };
    } else {
      return {
        platform,
        mode: adapter.initialized ? adapter.mode : "native",
        initialized: adapter.initialized,
        wsl: null,
        lima: null,
      };
    }
  } catch (error) {
    logError("[Sandbox] Error getting status:", error);
    return {
      platform: process.platform,
      mode: "none",
      initialized: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

// WSL IPC handlers (Windows)
ipcMain.handle("sandbox.checkWSL", async () => {
  try {
    return await WSLBridge.checkWSLStatus();
  } catch (error) {
    logError("[Sandbox] Error checking WSL:", error);
    return {
      available: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

ipcMain.handle("sandbox.installNodeInWSL", async (_event, distro: string) => {
  try {
    return await WSLBridge.installNodeInWSL(distro);
  } catch (error) {
    logError("[Sandbox] Error installing Node.js:", error);
    return false;
  }
});

ipcMain.handle("sandbox.installPythonInWSL", async (_event, distro: string) => {
  try {
    return await WSLBridge.installPythonInWSL(distro);
  } catch (error) {
    logError("[Sandbox] Error installing Python:", error);
    return false;
  }
});

// Lima IPC handlers (macOS)
ipcMain.handle("sandbox.checkLima", async () => {
  try {
    return await LimaBridge.checkLimaStatus();
  } catch (error) {
    logError("[Sandbox] Error checking Lima:", error);
    return {
      available: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

ipcMain.handle("sandbox.createLimaInstance", async () => {
  try {
    return await LimaBridge.createLimaInstance();
  } catch (error) {
    logError("[Sandbox] Error creating Lima instance:", error);
    return false;
  }
});

ipcMain.handle("sandbox.startLimaInstance", async () => {
  try {
    return await LimaBridge.startLimaInstance();
  } catch (error) {
    logError("[Sandbox] Error starting Lima instance:", error);
    return false;
  }
});

ipcMain.handle("sandbox.stopLimaInstance", async () => {
  try {
    return await LimaBridge.stopLimaInstance();
  } catch (error) {
    logError("[Sandbox] Error stopping Lima instance:", error);
    return false;
  }
});

ipcMain.handle("sandbox.installNodeInLima", async () => {
  try {
    return await LimaBridge.installNodeInLima();
  } catch (error) {
    logError("[Sandbox] Error installing Node.js in Lima:", error);
    return false;
  }
});

ipcMain.handle("sandbox.installPythonInLima", async () => {
  try {
    return await LimaBridge.installPythonInLima();
  } catch (error) {
    logError("[Sandbox] Error installing Python in Lima:", error);
    return false;
  }
});

// Logs IPC handlers
ipcMain.handle("logs.getPath", () => {
  try {
    return getLogFilePath();
  } catch (error) {
    logError("[Logs] Error getting log path:", error);
    return null;
  }
});

ipcMain.handle("logs.getDirectory", () => {
  try {
    return getLogsDirectory();
  } catch (error) {
    logError("[Logs] Error getting logs directory:", error);
    return null;
  }
});

ipcMain.handle("logs.getAll", () => {
  try {
    return getAllLogFiles();
  } catch (error) {
    logError("[Logs] Error getting all log files:", error);
    return [];
  }
});

ipcMain.handle("logs.export", async () => {
  try {
    const logFiles = getAllLogFiles();
    const diagnosticsSummary = buildDiagnosticsSummary({
      app: {
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
      },
      runtime: {
        currentWorkingDir,
        logsDirectory: getLogsDirectory(),
        logFileCount: logFiles.length,
        totalLogSizeBytes: logFiles.reduce(
          (total, file) => total + file.size,
          0,
        ),
        devLogsEnabled: isDevLogsEnabled(),
      },
      config: {
        provider: configStore.get("provider"),
        model: configStore.get("model"),
        baseUrl: sanitizeDiagnosticBaseUrl(
          configStore.get("baseUrl") || undefined,
        ),
        customProtocol: configStore.get("customProtocol") || null,
        sandboxEnabled: !!configStore.get("sandboxEnabled"),
        thinkingEnabled: !!configStore.get("enableThinking"),
        apiKeyConfigured: !!configStore.get("apiKey"),
        deskWandCodePathConfigured: !!configStore.get("deskWandCodePath"),
        defaultWorkdir: configStore.get("defaultWorkdir") || null,
      },
      sandbox: {
        mode: getSandboxAdapter().mode,
        initialized: getSandboxAdapter().initialized,
      },
      sessions: sessionManager ? sessionManager.listSessions().sessions : [],
      logFiles,
      deps: {
        getMessages: (sessionId: string) =>
          sessionManager ? sessionManager.getMessages(sessionId) : [],
        getTraceSteps: (sessionId: string) =>
          sessionManager ? sessionManager.getTraceSteps(sessionId) : [],
      },
    });

    // Show save dialog
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Export Logs",
      defaultPath: `deskwand-logs-${new Date().toISOString().split("T")[0]}.zip`,
      filters: [
        { name: "ZIP Archive", extensions: ["zip"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: "User cancelled" };
    }

    // Dynamic import archiver
    const archiver = await import("archiver");
    const output = fs.createWriteStream(result.filePath);
    const archive = archiver.default("zip", { zlib: { level: 9 } });

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: {
        success: boolean;
        path?: string;
        size?: number;
        error?: string;
      }) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      output.on("close", () => {
        log("[Logs] Exported logs to:", result.filePath);
        settle({
          success: true,
          path: result.filePath,
          size: archive.pointer(),
        });
      });

      output.on("error", (err: Error) => {
        logError("[Logs] Error writing exported archive:", err);
        settle({ success: false, error: err.message });
      });

      archive.on("error", (err: Error) => {
        logError("[Logs] Error creating archive:", err);
        settle({ success: false, error: err.message });
      });

      archive.pipe(output);

      // Add all log files
      for (const logFile of logFiles) {
        archive.file(logFile.path, { name: logFile.name });
      }

      // Add system info
      const systemInfo = {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        appVersion: app.getVersion(),
        exportDate: new Date().toISOString(),
        logFiles: logFiles.map((f) => ({
          name: f.name,
          size: f.size,
          modified: f.mtime,
        })),
      };
      archive.append(JSON.stringify(systemInfo, null, 2), {
        name: "system-info.json",
      });
      archive.append(JSON.stringify(diagnosticsSummary, null, 2), {
        name: "diagnostics-summary.json",
      });
      archive.append(
        [
          "DeskWand diagnostic bundle",
          `Exported at: ${diagnosticsSummary.exportedAt}`,
          "",
          "Included files:",
          "- Application log files (*.log)",
          "- system-info.json",
          "- diagnostics-summary.json",
          "",
          "diagnostics-summary.json contains a redacted runtime/config snapshot,",
          "plus metadata-only session summaries and recent error traces to speed up debugging.",
        ].join("\n"),
        { name: "README.txt" },
      );

      archive.finalize();
    });
  } catch (error) {
    logError("[Logs] Error exporting logs:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

ipcMain.handle("logs.open", async () => {
  try {
    const logsDir = getLogsDirectory();
    await shell.openPath(logsDir);
    return { success: true };
  } catch (error) {
    logError("[Logs] Error opening logs directory:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

ipcMain.handle("logs.clear", async () => {
  try {
    const logFiles = getAllLogFiles();

    // Close current log file
    closeLogFile();

    // Delete all log files
    for (const logFile of logFiles) {
      try {
        fs.unlinkSync(logFile.path);
        log("[Logs] Deleted log file:", logFile.name);
      } catch (err) {
        logError("[Logs] Failed to delete log file:", logFile.name, err);
      }
    }

    // Log will automatically reinitialize on next log call
    log("[Logs] Log files cleared and reinitialized");

    return { success: true, deletedCount: logFiles.length };
  } catch (error) {
    logError("[Logs] Error clearing logs:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

ipcMain.handle("logs.setEnabled", async (_event, enabled: boolean) => {
  try {
    setDevLogsEnabled(enabled);
    configStore.set("enableDevLogs", enabled);
    log("[Logs] Developer logs", enabled ? "enabled" : "disabled");
    return { success: true, enabled };
  } catch (error) {
    logError("[Logs] Error setting dev logs enabled:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

ipcMain.handle("logs.isEnabled", () => {
  try {
    return { success: true, enabled: isDevLogsEnabled() };
  } catch (error) {
    logError("[Logs] Error getting dev logs enabled:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

// ============================================================================
// 远程控制 IPC 处理
// ============================================================================

ipcMain.handle("remote.getConfig", () => {
  try {
    return remoteConfigStore.getAll();
  } catch (error) {
    logError("[Remote] Error getting config:", error);
    return null;
  }
});

ipcMain.handle("remote.getStatus", () => {
  try {
    return remoteManager.getStatus();
  } catch (error) {
    logError("[Remote] Error getting status:", error);
    return {
      running: false,
      channels: [],
      activeSessions: 0,
      pendingPairings: 0,
    };
  }
});

ipcMain.handle("remote.setEnabled", async (_event, enabled: boolean) => {
  try {
    remoteConfigStore.setEnabled(enabled);

    if (enabled) {
      await remoteManager.start();
    } else {
      await remoteManager.stop();
    }

    return { success: true };
  } catch (error) {
    logError("[Remote] Error setting enabled:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

ipcMain.handle(
  "remote.updateGatewayConfig",
  async (_event, config: Partial<GatewayConfig>) => {
    try {
      await remoteManager.updateGatewayConfig(config);
      return { success: true };
    } catch (error) {
      logError("[Remote] Error updating gateway config:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
);

ipcMain.handle(
  "remote.updateFeishuConfig",
  async (_event, config: FeishuChannelConfig) => {
    try {
      await remoteManager.updateFeishuConfig(config);
      return { success: true };
    } catch (error) {
      logError("[Remote] Error updating Feishu config:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
);

ipcMain.handle("remote.getPairedUsers", () => {
  try {
    return remoteManager.getPairedUsers();
  } catch (error) {
    logError("[Remote] Error getting paired users:", error);
    return [];
  }
});

ipcMain.handle("remote.getPendingPairings", () => {
  try {
    return remoteManager.getPendingPairings();
  } catch (error) {
    logError("[Remote] Error getting pending pairings:", error);
    return [];
  }
});

ipcMain.handle(
  "remote.approvePairing",
  (_event, channelType: ChannelType, userId: string) => {
    try {
      const success = remoteManager.approvePairing(channelType, userId);
      return { success };
    } catch (error) {
      logError("[Remote] Error approving pairing:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
);

ipcMain.handle(
  "remote.revokePairing",
  (_event, channelType: ChannelType, userId: string) => {
    try {
      const success = remoteManager.revokePairing(channelType, userId);
      return { success };
    } catch (error) {
      logError("[Remote] Error revoking pairing:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
);

ipcMain.handle(
  "remote.rejectPairing",
  (_event, channelType: ChannelType, userId: string) => {
    try {
      const success = remoteManager.rejectPairing(channelType, userId);
      return { success };
    } catch (error) {
      logError("[Remote] Error rejecting pairing:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
);

ipcMain.handle("remote.getRemoteSessions", () => {
  try {
    return remoteManager.getRemoteSessions();
  } catch (error) {
    logError("[Remote] Error getting remote sessions:", error);
    return [];
  }
});

ipcMain.handle("remote.clearRemoteSession", (_event, sessionId: string) => {
  try {
    const success = remoteManager.clearRemoteSession(sessionId);
    return { success };
  } catch (error) {
    logError("[Remote] Error clearing remote session:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

ipcMain.handle("remote.getTunnelStatus", () => {
  try {
    return remoteManager.getTunnelStatus();
  } catch (error) {
    logError("[Remote] Error getting tunnel status:", error);
    return { connected: false, url: null, provider: "none" };
  }
});

ipcMain.handle("remote.getWebhookUrl", () => {
  try {
    return remoteManager.getFeishuWebhookUrl();
  } catch (error) {
    logError("[Remote] Error getting webhook URL:", error);
    return null;
  }
});

ipcMain.handle("remote.restart", async () => {
  try {
    await remoteManager.restart();
    return { success: true };
  } catch (error) {
    logError("[Remote] Error restarting:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

ipcMain.handle("schedule.list", () => {
  try {
    if (!scheduledTaskManager) return [];
    return scheduledTaskManager.list();
  } catch (error) {
    logError("[Schedule] Error listing tasks:", error);
    return [];
  }
});

ipcMain.handle(
  "schedule.create",
  async (_event, payload: ScheduledTaskCreateInput) => {
    if (!scheduledTaskManager) {
      throw new Error("Scheduled task manager not initialized");
    }
    const unsupportedReason = getWorkspacePathUnsupportedReason(payload.cwd);
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    const normalizedPrompt = payload.prompt.trim();
    const title = await resolveScheduledTaskTitle(
      normalizedPrompt,
      payload.cwd,
      payload.title,
    );
    return scheduledTaskManager.create({
      ...payload,
      prompt: normalizedPrompt,
      title,
    });
  },
);

ipcMain.handle(
  "schedule.update",
  async (_event, id: string, updates: ScheduledTaskUpdateInput) => {
    if (!scheduledTaskManager) {
      throw new Error("Scheduled task manager not initialized");
    }
    const existing = scheduledTaskManager.get(id);
    if (!existing) return null;
    const nextCwd = updates.cwd ?? existing.cwd;
    const unsupportedReason = getWorkspacePathUnsupportedReason(nextCwd);
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    const normalizedPrompt =
      updates.prompt === undefined ? existing.prompt : updates.prompt.trim();
    const normalizedUpdates: ScheduledTaskUpdateInput = {
      ...updates,
      prompt: normalizedPrompt,
    };

    if (updates.prompt !== undefined) {
      normalizedUpdates.title = await resolveScheduledTaskTitle(
        normalizedPrompt,
        updates.cwd ?? existing.cwd,
        updates.title ?? existing.title,
      );
    } else if (updates.title !== undefined) {
      normalizedUpdates.title = buildScheduledTaskTitle(updates.title);
    }

    return scheduledTaskManager.update(id, normalizedUpdates);
  },
);

ipcMain.handle("schedule.delete", (_event, id: string) => {
  if (!scheduledTaskManager) {
    throw new Error("Scheduled task manager not initialized");
  }
  return { success: scheduledTaskManager.delete(id) };
});

ipcMain.handle("schedule.toggle", (_event, id: string, enabled: boolean) => {
  if (!scheduledTaskManager) {
    throw new Error("Scheduled task manager not initialized");
  }
  return scheduledTaskManager.toggle(id, enabled);
});

ipcMain.handle("schedule.runNow", async (_event, id: string) => {
  if (!scheduledTaskManager) {
    throw new Error("Scheduled task manager not initialized");
  }
  return scheduledTaskManager.runNow(id);
});

ipcMain.handle("memory.getOverview", (_event, cwd?: string) => {
  if (!memoryService) {
    throw new Error("Memory service not initialized");
  }
  return memoryService.getOverview(cwd);
});

ipcMain.handle(
  "memory.search",
  (
    _event,
    payload: {
      query: string;
      cwd?: string;
      sourceWorkspace?: string | null;
      scope?: "workspace" | "global" | "all";
      limit?: number;
    },
  ) => {
    if (!memoryService) {
      throw new Error("Memory service not initialized");
    }
    return memoryService.search(payload);
  },
);

ipcMain.handle("memory.read", (_event, id: string) => {
  if (!memoryService) {
    throw new Error("Memory service not initialized");
  }
  return memoryService.read(id);
});

ipcMain.handle("memory.rebuildWorkspace", async (_event, cwd: string) => {
  if (!memoryService) {
    throw new Error("Memory service not initialized");
  }
  return memoryService.rebuildWorkspace(cwd);
});

ipcMain.handle("memory.clearWorkspace", (_event, cwd: string) => {
  if (!memoryService) {
    throw new Error("Memory service not initialized");
  }
  return memoryService.clearWorkspace(cwd);
});

ipcMain.handle("memory.clearCoreMemory", () => {
  if (!memoryService) {
    throw new Error("Memory service not initialized");
  }
  return memoryService.clearCoreMemory();
});

ipcMain.handle("memory.rebuildAll", async () => {
  if (!memoryService) {
    throw new Error("Memory service not initialized");
  }
  return memoryService.rebuildAll();
});

ipcMain.handle("memory.listFiles", () => {
  if (!memoryService) {
    throw new Error("Memory service not initialized");
  }
  return memoryService.listFiles();
});

ipcMain.handle("memory.readFile", (_event, filePath: string) => {
  if (!memoryService) {
    throw new Error("Memory service not initialized");
  }
  return memoryService.readFile(filePath);
});

ipcMain.handle(
  "memory.inspectSession",
  (_event, sessionId: string, workspaceKey?: string) => {
    if (!memoryService) {
      throw new Error("Memory service not initialized");
    }
    return memoryService.inspectSession(sessionId, workspaceKey);
  },
);

ipcMain.handle("memory.setEnabled", (_event, enabled: boolean) => {
  if (!memoryService) {
    throw new Error("Memory service not initialized");
  }
  const result = memoryService.setEnabled(enabled);
  sessionManager?.clearAllCachedAgentSessions();
  sendToRenderer({
    type: "config.status",
    payload: {
      isConfigured: configStore.isConfigured(),
      config: configStore.getAll(),
    },
  });
  return result;
});

ipcMain.handle(
  "logs.write",
  (_event, level: "info" | "warn" | "error", args: unknown[]) => {
    try {
      if (level === "warn") {
        logWarn(...args);
      } else if (level === "error") {
        logError(...args);
      } else {
        log(...args);
      }
      return { success: true };
    } catch (error) {
      console.error("[Logs] Error writing log:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
);

ipcMain.handle("sandbox.retryLimaSetup", async () => {
  if (process.platform !== "darwin") {
    return { success: false, error: "Lima is only available on macOS" };
  }

  try {
    const bootstrap = getSandboxBootstrap();
    bootstrap.setProgressCallback((progress) => {
      sendToRenderer({
        type: "sandbox.progress",
        payload: progress,
      });
    });

    try {
      await LimaBridge.stopLimaInstance();
    } catch (error) {
      logError("[Sandbox] Error stopping Lima before retry:", error);
    }

    bootstrap.reset();
    const result = await bootstrap.bootstrap();
    const success = !result.error;
    return { success, result, error: result.error };
  } catch (error) {
    logError("[Sandbox] Error retrying Lima setup:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

// Generic retry setup for both WSL and Lima
ipcMain.handle("sandbox.retrySetup", async () => {
  try {
    const bootstrap = getSandboxBootstrap();
    bootstrap.setProgressCallback((progress) => {
      sendToRenderer({
        type: "sandbox.progress",
        payload: progress,
      });
    });

    // Reset and re-run bootstrap
    bootstrap.reset();
    const result = await bootstrap.bootstrap();
    const success = !result.error;
    return { success, result, error: result.error };
  } catch (error) {
    logError("[Sandbox] Error retrying setup:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

// --- Browser IPC handlers ---

function safeBrowserCall<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch (error) {
    logError("[Browser] IPC handler error:", error);
    return fallback;
  }
}

ipcMain.handle("browser.toggle", () =>
  safeBrowserCall(() => {
    browserViewManager?.toggle();
    return browserViewManager?.getStatus() ?? null;
  }, null),
);

ipcMain.handle("browser.show", () =>
  safeBrowserCall(() => {
    browserViewManager?.show();
    return browserViewManager?.getStatus() ?? null;
  }, null),
);

ipcMain.handle("browser.hide", () =>
  safeBrowserCall(() => {
    browserViewManager?.hide();
    return browserViewManager?.getStatus() ?? null;
  }, null),
);

ipcMain.handle("browser.navigate", (_event, url: string) =>
  safeBrowserCall(() => {
    browserViewManager?.navigate(url);
    return browserViewManager?.getStatus() ?? null;
  }, null),
);

ipcMain.handle("browser.getStatus", () =>
  safeBrowserCall(() => browserViewManager?.getStatus() ?? null, null),
);

ipcMain.handle("browser.goBack", () =>
  safeBrowserCall(() => {
    browserViewManager?.goBack();
    return browserViewManager?.getStatus() ?? null;
  }, null),
);

ipcMain.handle("browser.goForward", () =>
  safeBrowserCall(() => {
    browserViewManager?.goForward();
    return browserViewManager?.getStatus() ?? null;
  }, null),
);

ipcMain.handle("browser.reload", () =>
  safeBrowserCall(() => {
    browserViewManager?.reload();
    return browserViewManager?.getStatus() ?? null;
  }, null),
);

ipcMain.handle("browser.stop", () =>
  safeBrowserCall(() => {
    browserViewManager?.stop();
    return browserViewManager?.getStatus() ?? null;
  }, null),
);

ipcMain.handle(
  "browser.setBounds",
  (_event, x: number, y: number, width: number, height: number) =>
    safeBrowserCall(() => {
      browserViewManager?.setBounds(x, y, width, height);
    }, undefined),
);

ipcMain.handle(
  "browser.setTheme",
  (_event, theme: string, blankPageBg: string) =>
    safeBrowserCall(() => {
      browserViewManager?.setTheme(theme as "dark" | "light", blankPageBg);
    }, undefined),
);

// ---

async function handleClientEvent(event: ClientEvent): Promise<unknown> {
  // Check if configured before starting sessions
  if (
    event.type === "session.start" &&
    !configStore.hasAnyUsableCredentials()
  ) {
    sendToRenderer({
      type: "error",
      payload: {
        message: "当前方案未配置可用凭证，请先在 API 设置中完成配置",
        code: "CONFIG_REQUIRED_ACTIVE_SET",
        action: "open_api_settings",
      },
    });
    return null;
  }

  if (eventRequiresSessionManager(event) && !sessionManager) {
    throw new Error("Session manager not initialized");
  }
  // After the guard above, sessionManager is guaranteed non-null for session.* events.
  // Use a local alias to satisfy TypeScript's control-flow narrowing.
  const sm = sessionManager!;

  switch (event.type) {
    case "session.start":
      if (getWorkspacePathUnsupportedReason(event.payload.cwd)) {
        sendToRenderer({
          type: "error",
          payload: {
            message: getWorkspacePathUnsupportedReason(event.payload.cwd)!,
          },
        });
        return null;
      }
      return sm.startSession(
        event.payload.title,
        event.payload.prompt,
        event.payload.cwd,
        event.payload.allowedTools,
        event.payload.content,
        event.payload.memoryEnabled,
        event.payload.thinkingLevel,
        event.payload.providerProfileKey,
        event.payload.model,
        event.payload.turnId,
      );

    case "session.continue":
      return sm.continueSession(
        event.payload.sessionId,
        event.payload.prompt,
        event.payload.content,
        event.payload.providerProfileKey,
        event.payload.model,
        event.payload.turnId,
      );

    case "session.setThinkingLevel":
      return sm.setSessionThinkingLevel(
        event.payload.sessionId,
        event.payload.thinkingLevel,
      );
    case "session.setProviderModel":
      return sm.setSessionProviderModel(
        event.payload.sessionId,
        event.payload.providerProfileKey,
        event.payload.model,
      );

    case "session.stop":
      return sm.stopSession(event.payload.sessionId);

    case "session.compact": {
      const status = await sm.compactSession(
        event.payload.sessionId,
        event.payload.instructions,
      );
      return { success: true, status };
    }

    case "session.abortCompaction":
      sm.abortCompactionSession(event.payload.sessionId);
      return { success: true };

    case "session.steer":
      sm.steerSession(event.payload.sessionId, event.payload.prompt);
      return { success: true };

    case "session.delete":
      return sm.deleteSession(event.payload.sessionId);

    case "session.batchDelete":
      return sm.batchDeleteSessions(event.payload.sessionIds);

    case "session.archive":
      return sm.archiveSession(event.payload.sessionId);

    case "session.unarchive":
      return sm.unarchiveSession(event.payload.sessionId);

    case "session.batchArchive":
      return sm.batchArchiveSessions(event.payload.sessionIds);

    case "session.batchUnarchive":
      return sm.batchUnarchiveSessions(event.payload.sessionIds);

    case "session.archiveDelete":
      return sm.permanentDeleteArchivedSession(event.payload.sessionId);

    case "session.list": {
      const result = sm.listSessions();
      sendToRenderer({
        type: "session.list",
        payload: {
          sessions: result.sessions,
          contextWindows: result.contextWindows,
        },
      });
      return result.sessions;
    }

    case "session.getMessages":
      return sm.getMessages(event.payload.sessionId);

    case "session.getTraceSteps":
      return sm.getTraceSteps(event.payload.sessionId);

    case "permission.response":
      return sm.handlePermissionResponse(
        event.payload.toolUseId,
        event.payload.result,
      );

    case "sudo.password.response":
      return sm.handleSudoPasswordResponse(
        event.payload.toolUseId,
        event.payload.password,
      );

    case "folder.select": {
      const folderResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ["openDirectory"],
      });
      if (!folderResult.canceled && folderResult.filePaths.length > 0) {
        sendToRenderer({
          type: "folder.selected",
          payload: { path: folderResult.filePaths[0] },
        });
        return folderResult.filePaths[0];
      }
      return null;
    }

    case "workdir.get":
      return getWorkingDir();

    case "workdir.set":
      return setWorkingDir(event.payload.path, event.payload.sessionId);

    case "workdir.select": {
      const dialogDefaultPath =
        event.payload.currentPath && isAbsolute(event.payload.currentPath)
          ? event.payload.currentPath
          : currentWorkingDir || undefined;
      const workdirResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ["openDirectory"],
        title: "Select Working Directory",
        defaultPath: dialogDefaultPath,
      });
      if (!workdirResult.canceled && workdirResult.filePaths.length > 0) {
        const selectedPath = workdirResult.filePaths[0];
        return setWorkingDir(selectedPath, event.payload.sessionId);
      }
      return { success: false, path: "", error: "User cancelled" };
    }

    case "project.create": {
      const result = createProjectDirectory(event.payload.name);
      if (!result.success) {
        return result;
      }
      return setWorkingDir(result.path);
    }

    case "project.delete": {
      const normalizedCwd = normalizeWorkspacePath(event.payload.cwd);
      if (!normalizedCwd) {
        return {
          success: false,
          path: "",
          deletedSessionIds: [],
          error: "Project path is required",
        };
      }

      const deletedSessionIds = sessionManager
        ? await sessionManager.deleteProjectByCwd(normalizedCwd)
        : [];
      if (normalizeWorkspacePath(getWorkingDir()) === normalizedCwd) {
        const defaultDir = initializeDefaultWorkingDir();
        await setWorkingDir(defaultDir);
      }
      return { success: true, path: normalizedCwd, deletedSessionIds };
    }

    case "settings.update":
      if (
        event.payload.theme === "dark" ||
        event.payload.theme === "light" ||
        event.payload.theme === "system"
      ) {
        const nextTheme = event.payload.theme as AppTheme;
        configStore.update({ theme: nextTheme });
        sendToRenderer({
          type: "native-theme.changed",
          payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
          const effectiveTheme = resolveEffectiveTheme(nextTheme);
          const tp = (configStore.get("themePreset") as string) || "graphite";
          const presetBg = THEME_PRESET_BG[tp] || THEME_PRESET_BG.graphite;
          mainWindow.setBackgroundColor(
            effectiveTheme === "dark" ? presetBg.dark : presetBg.light,
          );
        }
        sendToRenderer({
          type: "config.status",
          payload: {
            isConfigured: configStore.isConfigured(),
            config: configStore.getAll(),
          },
        });
      }
      if (
        typeof event.payload.themePreset === "string" &&
        ["graphite", "paper", "void", "ocean", "forest", "ember", "aurora"].includes(event.payload.themePreset)
      ) {
        configStore.update({
          themePreset: event.payload.themePreset as ThemePreset,
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
          const tp = event.payload.themePreset;
          const presetBg = THEME_PRESET_BG[tp] || THEME_PRESET_BG.graphite;
          const effectiveTheme = resolveEffectiveTheme(
            getSavedThemePreference(),
          );
          mainWindow.setBackgroundColor(
            effectiveTheme === "dark" ? presetBg.dark : presetBg.light,
          );
        }
        sendToRenderer({
          type: "config.status",
          payload: {
            isConfigured: configStore.isConfigured(),
            config: configStore.getAll(),
          },
        });
      }
      if (typeof event.payload.autoSkillLearning === "boolean") {
        configStore.update({
          autoSkillLearning: event.payload.autoSkillLearning,
        });
        sendToRenderer({
          type: "config.status",
          payload: {
            isConfigured: configStore.isConfigured(),
            config: configStore.getAll(),
          },
        });
      }
      return null;

    case "update.check":
      autoUpdater.checkForUpdates().catch((err: unknown) => {
        logWarn("[Update] Manual check failed:", err);
      });
      return null;

    case "update.install":
      autoUpdater.quitAndInstall();
      return null;

    default:
      logWarn("Unknown event type:", event);
      return null;
  }
}
