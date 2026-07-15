import { contextBridge, ipcRenderer } from "electron";
import type {
  ClientEvent,
  ServerEvent,
  AppConfig,
  SaveProviderPayload,
  ProviderProfileKey,
  ProviderPresets,
  Skill,
  ApiTestInput,
  ApiTestResult,
  ScheduleTask,
  ScheduleCreateInput,
  ScheduleUpdateInput,
  ProviderModelInfo,
  LocalOllamaDiscoveryResult,
  MemoryOverview,
  MemorySearchResult,
  MemoryReadResult,
  MemorySearchScope,
  MemoryDebugFileInfo,
  MemoryDebugFileContent,
  MemoryInspectSessionResult,
} from "../renderer/types";
import type { DiagnosticInput, DiagnosticResult } from "../renderer/types";
import type {
  McpServerConfig,
  McpTool,
  McpServerStatus,
  McpPresetsMap,
  RemoteConfig,
  GatewayConfig,
  FeishuChannelConfig,
  PairedUser,
  PairingRequest,
  RemoteSessionMapping,
} from "../shared/ipc-types";

// Fan out one IPC listener to all active renderer subscribers.
const registeredCallbacks = new Set<(event: ServerEvent) => void>();
let ipcListener:
  | ((event: Electron.IpcRendererEvent, data: ServerEvent) => void)
  | null = null;

// Allowlist of valid ClientEvent types to prevent spoofing arbitrary IPC channels
const ALLOWED_CLIENT_EVENTS: ReadonlySet<string> = new Set<ClientEvent["type"]>(
  [
    "session.start",
    "session.continue",
    "session.stop",
    "session.compact",
    "session.abortCompaction",
    "session.steer",
    "session.delete",
    "session.batchDelete",
    "session.list",
    "session.getMessages",
    "session.getTraceSteps",
    "permission.response",
    "sudo.password.response",
    "settings.update",
    "folder.select",
    "workdir.get",
    "workdir.set",
    "workdir.select",
    "project.create",
    "project.delete",
    "update.check",
    "update.install",
  ],
);

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Send events to main process
  send: (event: ClientEvent) => {
    if (!ALLOWED_CLIENT_EVENTS.has(event.type)) {
      console.warn("[Preload] Blocked unauthorized event type:", event.type);
      return;
    }
    ipcRenderer.send("client-event", event);
  },

  // Receive events from main process
  on: (callback: (event: ServerEvent) => void) => {
    registeredCallbacks.add(callback);

    if (!ipcListener) {
      ipcListener = (_: Electron.IpcRendererEvent, data: ServerEvent) => {
        for (const registeredCallback of registeredCallbacks) {
          registeredCallback(data);
        }
      };
      ipcRenderer.on("server-event", ipcListener);
    }

    // Return cleanup function
    return () => {
      registeredCallbacks.delete(callback);
      if (ipcListener && registeredCallbacks.size === 0) {
        ipcRenderer.removeListener("server-event", ipcListener);
        ipcListener = null;
      }
    };
  },

  // Invoke and wait for response
  invoke: async <T>(event: ClientEvent): Promise<T> => {
    if (!ALLOWED_CLIENT_EVENTS.has(event.type)) {
      console.warn("[Preload] Blocked unauthorized invoke type:", event.type);
      throw new Error(`Unauthorized event type: ${event.type}`);
    }
    return ipcRenderer.invoke("client-invoke", event);
  },

  // Platform info
  platform: process.platform,

  // System theme
  getSystemTheme: () => ipcRenderer.invoke("system.getTheme"),

  // App info
  getVersion: () => ipcRenderer.invoke("get-version"),

  // Open links in default browser
  openExternal: (url: string) => {
    // Sanitize mailto: URLs to strip dangerous query params that could attach files
    let safeUrl = url;
    if (/^mailto:/i.test(url)) {
      try {
        const parsed = new URL(url);
        parsed.searchParams.delete("attach");
        parsed.searchParams.delete("attachment");
        safeUrl = parsed.toString();
      } catch {
        // If URL parsing fails, block the call
        return Promise.resolve(false);
      }
    }
    return ipcRenderer.invoke("shell.openExternal", safeUrl);
  },
  showItemInFolder: (filePath: string, cwd?: string) =>
    ipcRenderer.invoke("shell.showItemInFolder", filePath, cwd),

  // Select files using native dialog
  selectFiles: (): Promise<string[]> =>
    ipcRenderer.invoke("dialog.selectFiles"),
  getVideoSourceUrl: (filePath: string): Promise<string> =>
    ipcRenderer.invoke("video.getSourceUrl", filePath),

  // List directory contents for file browser
  listDirectory: (
    dirPath: string,
  ): Promise<
    Array<{ name: string; isDir: boolean; size: number; ext: string }>
  > => ipcRenderer.invoke("fs.listDirectory", dirPath),

  // Read file content for preview (text/image)
  readFile: (
    filePath: string,
  ): Promise<
    | { type: "text"; content: string; ext: string }
    | { type: "image"; content: string; mimeType: string }
    | { type: "error"; message: string }
  > => ipcRenderer.invoke("fs.readFile", filePath),

  // Open file with system default application
  openPath: (filePath: string): Promise<{ error: string | null }> =>
    ipcRenderer.invoke("shell.openPath", filePath),

  // Review / diff
  review: {
    getDiffFiles: (
      dirPath?: string,
    ): Promise<
      Array<{
        path: string;
        additions: number;
        deletions: number;
        status: string;
      }>
    > => ipcRenderer.invoke("review.getDiffFiles", dirPath),
    getFileDiff: (filePath: string, dirPath?: string): Promise<string> =>
      ipcRenderer.invoke("review.getFileDiff", filePath, dirPath),
    pushDiff: (title: string, content: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("review.pushDiff", title, content),
    clearDiff: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("review.clearDiff"),
  },

  // Git
  git: {
    hasChanges: (
      dirPath?: string,
    ): Promise<{ isRepo: boolean; changeCount: number }> =>
      ipcRenderer.invoke("git.hasChanges", dirPath),
    revertFiles: (
      cwd: string,
      paths: string[],
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("git.revertFiles", cwd, paths),
  },

  artifacts: {
    listRecentFiles: (
      cwd: string,
      sinceMs: number,
      limit = 50,
    ): Promise<Array<{ path: string; modifiedAt: number; size: number }>> =>
      ipcRenderer.invoke(
        "artifacts.listRecentFiles",
        cwd,
        sinceMs,
        Math.min(limit, 500),
      ),
  },

  // Config methods
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke("config.get"),
    getPresets: (): Promise<ProviderPresets> =>
      ipcRenderer.invoke("config.getPresets"),
    save: (
      config: Partial<AppConfig>,
    ): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke("config.save", config),
    saveProvider: (
      payload: SaveProviderPayload,
    ): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke("config.saveProvider", payload),
    deleteProvider: (payload: {
      profileKey: ProviderProfileKey;
    }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke("config.deleteProvider", payload),
    setActiveProvider: (payload: {
      profileKey: ProviderProfileKey;
      defaultModel?: string;
    }): Promise<{ success: boolean; config: AppConfig }> =>
      ipcRenderer.invoke("config.setActiveProvider", payload),
    isConfigured: (): Promise<boolean> =>
      ipcRenderer.invoke("config.isConfigured"),
    test: (config: ApiTestInput): Promise<ApiTestResult> =>
      ipcRenderer.invoke("config.test", config),
    listModels: (payload: {
      provider: AppConfig["provider"];
      apiKey: string;
      baseUrl?: string;
    }): Promise<ProviderModelInfo[]> =>
      ipcRenderer.invoke("config.listModels", payload),
    fetchOpenRouterModels: (): Promise<
      import("../shared/ipc-types").OpenRouterModelsResult
    > => ipcRenderer.invoke("config.fetchOpenRouterModels"),
    diagnose: (input: DiagnosticInput): Promise<DiagnosticResult> =>
      ipcRenderer.invoke("config.diagnose", input),
    discoverLocal: (payload?: {
      baseUrl?: string;
    }): Promise<LocalOllamaDiscoveryResult> =>
      ipcRenderer.invoke("config.discover-local", payload),
  },

  // Window control methods
  window: {
    minimize: () => ipcRenderer.send("window.minimize"),
    maximize: () => ipcRenderer.send("window.maximize"),
    close: () => ipcRenderer.send("window.close"),
    onFullScreenChanged: (callback: (isFullScreen: boolean) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        isFullScreen: boolean,
      ) => callback(isFullScreen);
      ipcRenderer.on("window.fullscreen-changed", handler);
      return () =>
        ipcRenderer.removeListener("window.fullscreen-changed", handler);
    },
  },

  // MCP methods
  mcp: {
    getServers: (): Promise<McpServerConfig[]> =>
      ipcRenderer.invoke("mcp.getServers"),
    getServer: (serverId: string): Promise<McpServerConfig | undefined> =>
      ipcRenderer.invoke("mcp.getServer", serverId),
    saveServer: (
      config: McpServerConfig,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("mcp.saveServer", config),
    deleteServer: (serverId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("mcp.deleteServer", serverId),
    getTools: (): Promise<McpTool[]> => ipcRenderer.invoke("mcp.getTools"),
    getServerStatus: (): Promise<McpServerStatus[]> =>
      ipcRenderer.invoke("mcp.getServerStatus"),
    getPresets: (): Promise<McpPresetsMap> =>
      ipcRenderer.invoke("mcp.getPresets"),
  },

  // Skills methods
  skills: {
    getAll: (): Promise<Skill[]> => ipcRenderer.invoke("skills.getAll"),
    install: (skillPath: string): Promise<{ success: boolean; skill: Skill }> =>
      ipcRenderer.invoke("skills.install", skillPath),
    delete: (skillId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("skills.delete", skillId),
    setEnabled: (
      skillId: string,
      enabled: boolean,
    ): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("skills.setEnabled", skillId, enabled),
    validate: (
      skillPath: string,
    ): Promise<{ valid: boolean; errors: string[] }> =>
      ipcRenderer.invoke("skills.validate", skillPath),
    getGlobalSkillsPath: (): Promise<string> =>
      ipcRenderer.invoke("skills.getGlobalSkillsPath"),
    packageToZip: (skillName: string): Promise<ArrayBuffer> =>
      ipcRenderer.invoke("skills.packageToZip", skillName),
    computeContentFingerprint: (skillName: string): Promise<string> =>
      ipcRenderer.invoke("skills.computeContentFingerprint", skillName),
    writeFingerprint: (skillName: string, fingerprint: string): Promise<void> =>
      ipcRenderer.invoke("skills.writeFingerprint", skillName, fingerprint),
    readFingerprint: (skillName: string): Promise<string | null> =>
      ipcRenderer.invoke("skills.readFingerprint", skillName),
    deleteFingerprint: (skillName: string): Promise<void> =>
      ipcRenderer.invoke("skills.deleteFingerprint", skillName),
    readSkillMd: (skillName: string): Promise<string | null> =>
      ipcRenderer.invoke("skills.readSkillMd", skillName),
    writeInstalledMeta: (
      skillName: string,
      meta: { skillId: string; version: number },
    ): Promise<void> =>
      ipcRenderer.invoke("skills.writeInstalledMeta", skillName, meta),
    readInstalledMeta: (
      skillName: string,
    ): Promise<{ skillId: string; version: number } | null> =>
      ipcRenderer.invoke("skills.readInstalledMeta", skillName),
  },
  // File methods
  file: {
    saveToTemp: (buffer: ArrayBuffer, filename: string): Promise<string> =>
      ipcRenderer.invoke("file.saveToTemp", buffer, filename),
    extractArchive: (archivePath: string): Promise<string> =>
      ipcRenderer.invoke("file.extractArchive", archivePath),
    removeTemp: (tempPath: string): Promise<void> =>
      ipcRenderer.invoke("file.removeTemp", tempPath),
  },

  // Sandbox methods
  sandbox: {
    getStatus: (): Promise<{
      platform: string;
      mode: string;
      initialized: boolean;
      wsl?: {
        available: boolean;
        distro?: string;
        nodeAvailable?: boolean;
        version?: string;
        pythonAvailable?: boolean;
        pythonVersion?: string;
        pipAvailable?: boolean;
        deskWandCodeAvailable?: boolean;
      };
      lima?: {
        available: boolean;
        instanceExists?: boolean;
        instanceRunning?: boolean;
        instanceName?: string;
        nodeAvailable?: boolean;
        version?: string;
        pythonAvailable?: boolean;
        pythonVersion?: string;
        pipAvailable?: boolean;
        deskWandCodeAvailable?: boolean;
      };
      error?: string;
    }> => ipcRenderer.invoke("sandbox.getStatus"),
    checkWSL: (): Promise<{
      available: boolean;
      distro?: string;
      nodeAvailable?: boolean;
      version?: string;
      pythonAvailable?: boolean;
      pythonVersion?: string;
      pipAvailable?: boolean;
      deskWandCodeAvailable?: boolean;
    }> => ipcRenderer.invoke("sandbox.checkWSL"),
    checkLima: (): Promise<{
      available: boolean;
      instanceExists?: boolean;
      instanceRunning?: boolean;
      instanceName?: string;
      nodeAvailable?: boolean;
      version?: string;
      pythonAvailable?: boolean;
      pythonVersion?: string;
      pipAvailable?: boolean;
      deskWandCodeAvailable?: boolean;
    }> => ipcRenderer.invoke("sandbox.checkLima"),
    installNodeInWSL: (distro: string): Promise<boolean> =>
      ipcRenderer.invoke("sandbox.installNodeInWSL", distro),
    installPythonInWSL: (distro: string): Promise<boolean> =>
      ipcRenderer.invoke("sandbox.installPythonInWSL", distro),
    installNodeInLima: (): Promise<boolean> =>
      ipcRenderer.invoke("sandbox.installNodeInLima"),
    installPythonInLima: (): Promise<boolean> =>
      ipcRenderer.invoke("sandbox.installPythonInLima"),
    startLimaInstance: (): Promise<boolean> =>
      ipcRenderer.invoke("sandbox.startLimaInstance"),
    stopLimaInstance: (): Promise<boolean> =>
      ipcRenderer.invoke("sandbox.stopLimaInstance"),
    retrySetup: (): Promise<{
      success: boolean;
      error?: string;
      result?: unknown;
    }> => ipcRenderer.invoke("sandbox.retrySetup"),
    retryLimaSetup: (): Promise<{
      success: boolean;
      error?: string;
      result?: unknown;
    }> => ipcRenderer.invoke("sandbox.retryLimaSetup"),
  },

  // Logs methods
  logs: {
    getPath: (): Promise<string | null> => ipcRenderer.invoke("logs.getPath"),
    getDirectory: (): Promise<string> =>
      ipcRenderer.invoke("logs.getDirectory"),
    getAll: (): Promise<
      Array<{ name: string; path: string; size: number; mtime: Date }>
    > => ipcRenderer.invoke("logs.getAll"),
    export: (): Promise<{
      success: boolean;
      path?: string;
      size?: number;
      error?: string;
    }> => ipcRenderer.invoke("logs.export"),
    open: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("logs.open"),
    clear: (): Promise<{
      success: boolean;
      deletedCount?: number;
      error?: string;
    }> => ipcRenderer.invoke("logs.clear"),
    setEnabled: (
      enabled: boolean,
    ): Promise<{ success: boolean; enabled?: boolean; error?: string }> =>
      ipcRenderer.invoke("logs.setEnabled", enabled),
    isEnabled: (): Promise<{
      success: boolean;
      enabled?: boolean;
      error?: string;
    }> => ipcRenderer.invoke("logs.isEnabled"),
    write: (
      level: "info" | "warn" | "error",
      ...args: unknown[]
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("logs.write", level, ...args),
  },

  // Remote control methods
  remote: {
    getConfig: (): Promise<RemoteConfig> =>
      ipcRenderer.invoke("remote.getConfig"),
    getStatus: (): Promise<{
      running: boolean;
      port?: number;
      publicUrl?: string;
      channels: Array<{ type: string; connected: boolean; error?: string }>;
      activeSessions: number;
      pendingPairings: number;
    }> => ipcRenderer.invoke("remote.getStatus"),
    setEnabled: (
      enabled: boolean,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("remote.setEnabled", enabled),
    updateGatewayConfig: (
      config: Partial<GatewayConfig>,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("remote.updateGatewayConfig", config),
    updateFeishuConfig: (
      config: FeishuChannelConfig,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("remote.updateFeishuConfig", config),
    getPairedUsers: (): Promise<PairedUser[]> =>
      ipcRenderer.invoke("remote.getPairedUsers"),
    getPendingPairings: (): Promise<PairingRequest[]> =>
      ipcRenderer.invoke("remote.getPendingPairings"),
    approvePairing: (
      channelType: string,
      userId: string,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("remote.approvePairing", channelType, userId),
    revokePairing: (
      channelType: string,
      userId: string,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("remote.revokePairing", channelType, userId),
    rejectPairing: (
      channelType: string,
      userId: string,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("remote.rejectPairing", channelType, userId),
    getRemoteSessions: (): Promise<RemoteSessionMapping[]> =>
      ipcRenderer.invoke("remote.getRemoteSessions"),
    clearRemoteSession: (
      sessionId: string,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("remote.clearRemoteSession", sessionId),
    getTunnelStatus: (): Promise<{
      connected: boolean;
      url: string | null;
      provider: string;
      error?: string;
    }> => ipcRenderer.invoke("remote.getTunnelStatus"),
    getWebhookUrl: (): Promise<string | null> =>
      ipcRenderer.invoke("remote.getWebhookUrl"),
    restart: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("remote.restart"),
  },

  schedule: {
    list: (): Promise<ScheduleTask[]> => ipcRenderer.invoke("schedule.list"),
    create: (payload: ScheduleCreateInput): Promise<ScheduleTask> =>
      ipcRenderer.invoke("schedule.create", payload),
    update: (
      id: string,
      updates: ScheduleUpdateInput,
    ): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke("schedule.update", id, updates),
    delete: (id: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("schedule.delete", id),
    toggle: (id: string, enabled: boolean): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke("schedule.toggle", id, enabled),
    runNow: (id: string): Promise<ScheduleTask | null> =>
      ipcRenderer.invoke("schedule.runNow", id),
  },

  memory: {
    getOverview: (cwd?: string): Promise<MemoryOverview> =>
      ipcRenderer.invoke("memory.getOverview", cwd),
    search: (payload: {
      query: string;
      cwd?: string;
      sourceWorkspace?: string | null;
      scope?: MemorySearchScope;
      limit?: number;
    }): Promise<MemorySearchResult[]> =>
      ipcRenderer.invoke("memory.search", payload),
    read: (id: string): Promise<MemoryReadResult | null> =>
      ipcRenderer.invoke("memory.read", id),
    rebuildWorkspace: (
      cwd: string,
    ): Promise<{ success: boolean; workspaceKey: string }> =>
      ipcRenderer.invoke("memory.rebuildWorkspace", cwd),
    clearWorkspace: (
      cwd: string,
    ): Promise<{ success: boolean; workspaceKey: string }> =>
      ipcRenderer.invoke("memory.clearWorkspace", cwd),
    clearCoreMemory: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("memory.clearCoreMemory"),
    rebuildAll: (): Promise<{
      success: boolean;
      workspaceCount: number;
      sessionCount: number;
    }> => ipcRenderer.invoke("memory.rebuildAll"),
    listFiles: (): Promise<MemoryDebugFileInfo[]> =>
      ipcRenderer.invoke("memory.listFiles"),
    readFile: (filePath: string): Promise<MemoryDebugFileContent> =>
      ipcRenderer.invoke("memory.readFile", filePath),
    inspectSession: (
      sessionId: string,
      workspaceKey?: string,
    ): Promise<MemoryInspectSessionResult | null> =>
      ipcRenderer.invoke("memory.inspectSession", sessionId, workspaceKey),
    setEnabled: (
      enabled: boolean,
    ): Promise<{ success: boolean; enabled: boolean }> =>
      ipcRenderer.invoke("memory.setEnabled", enabled),
  },

  // OAuth methods
  auth: {
    login: (providerId: string, force?: boolean): Promise<void> =>
      ipcRenderer.invoke("auth.login", providerId, force),
    logout: (providerId: string): Promise<void> =>
      ipcRenderer.invoke("auth.logout", providerId),
    status: (
      providerId: string,
    ): Promise<import("../shared/ipc-types").OAuthStatusResult> =>
      ipcRenderer.invoke("auth.status", providerId),
  },

  openrouterAuth: {
    login: (): Promise<import("../shared/ipc-types").OpenRouterLoginResult> =>
      ipcRenderer.invoke("openrouterAuth.login"),
    logout: (): Promise<void> => ipcRenderer.invoke("openrouterAuth.logout"),
    status: (): Promise<
      import("../shared/ipc-types").OpenRouterAuthStatusResult
    > => ipcRenderer.invoke("openrouterAuth.status"),
  },

  // Cloud Auth (Google OAuth login for DeskWand cloud)
  cloudAuth: {
    googleLogin: (): Promise<
      import("../shared/ipc-types").CloudAuthLoginResult
    > => ipcRenderer.invoke("cloudAuth.googleLogin"),
  },

  // Browser panel methods
  browser: {
    toggle: (): Promise<{
      visible: boolean;
      url: string;
      title: string;
      isLoading: boolean;
      canGoBack: boolean;
      canGoForward: boolean;
    } | null> => ipcRenderer.invoke("browser.toggle"),
    show: () => ipcRenderer.invoke("browser.show"),
    hide: () => ipcRenderer.invoke("browser.hide"),
    navigate: (url: string) => ipcRenderer.invoke("browser.navigate", url),
    getStatus: () => ipcRenderer.invoke("browser.getStatus"),
    goBack: () => ipcRenderer.invoke("browser.goBack"),
    goForward: () => ipcRenderer.invoke("browser.goForward"),
    reload: () => ipcRenderer.invoke("browser.reload"),
    stop: () => ipcRenderer.invoke("browser.stop"),
    setBounds: (x: number, y: number, w: number, h: number) =>
      ipcRenderer.invoke("browser.setBounds", x, y, w, h),
    setTheme: (theme: string, blankPageBg: string) =>
      ipcRenderer.invoke("browser.setTheme", theme, blankPageBg),
    enterFullscreen: () => ipcRenderer.invoke("browser.enterFullscreen"),
    exitFullscreen: () => ipcRenderer.invoke("browser.exitFullscreen"),
    onStateChanged: (
      callback: (status: {
        visible: boolean;
        url: string;
        title: string;
        isLoading: boolean;
        canGoBack: boolean;
        canGoForward: boolean;
      }) => void,
    ) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) =>
        callback(status as Parameters<typeof callback>[0]);
      ipcRenderer.on("browser.state-changed", handler);
      return () => ipcRenderer.removeListener("browser.state-changed", handler);
    },
  },
});

// Type declaration for the renderer process
declare global {
  interface Window {
    electronAPI: {
      send: (event: ClientEvent) => void;
      on: (callback: (event: ServerEvent) => void) => () => void;
      invoke: <T>(event: ClientEvent) => Promise<T>;
      platform: NodeJS.Platform;
      getSystemTheme: () => Promise<{ shouldUseDarkColors: boolean }>;
      getVersion: () => Promise<string>;
      openExternal: (url: string) => Promise<boolean>;
      showItemInFolder: (filePath: string, cwd?: string) => Promise<boolean>;
      selectFiles: () => Promise<string[]>;
      getVideoSourceUrl: (filePath: string) => Promise<string>;
      listDirectory: (
        dirPath: string,
      ) => Promise<
        Array<{ name: string; isDir: boolean; size: number; ext: string }>
      >;
      openPath: (filePath: string) => Promise<{ error: string | null }>;
      readFile: (
        filePath: string,
      ) => Promise<
        | { type: "text"; content: string; ext: string }
        | { type: "image"; content: string; mimeType: string }
        | { type: "error"; message: string }
      >;
      review: {
        getDiffFiles: (dirPath?: string) => Promise<
          Array<{
            path: string;
            additions: number;
            deletions: number;
            status: string;
          }>
        >;
        getFileDiff: (filePath: string, dirPath?: string) => Promise<string>;
        pushDiff: (
          title: string,
          content: string,
        ) => Promise<{ success: boolean }>;
        clearDiff: () => Promise<{ success: boolean }>;
      };
      git: {
        hasChanges: (
          dirPath?: string,
        ) => Promise<{ isRepo: boolean; changeCount: number }>;
        revertFiles: (
          cwd: string,
          paths: string[],
        ) => Promise<{ success: boolean; error?: string }>;
      };
      artifacts: {
        listRecentFiles: (
          cwd: string,
          sinceMs: number,
          limit?: number,
        ) => Promise<Array<{ path: string; modifiedAt: number; size: number }>>;
      };
      config: {
        get: () => Promise<AppConfig>;
        getPresets: () => Promise<ProviderPresets>;
        save: (
          config: Partial<AppConfig>,
        ) => Promise<{ success: boolean; config: AppConfig }>;
        saveProvider: (
          payload: SaveProviderPayload,
        ) => Promise<{ success: boolean; config: AppConfig }>;
        deleteProvider: (payload: {
          profileKey: ProviderProfileKey;
        }) => Promise<{ success: boolean; config: AppConfig }>;
        setActiveProvider: (payload: {
          profileKey: ProviderProfileKey;
          defaultModel?: string;
        }) => Promise<{ success: boolean; config: AppConfig }>;
        isConfigured: () => Promise<boolean>;
        test: (config: ApiTestInput) => Promise<ApiTestResult>;
        listModels: (payload: {
          provider: AppConfig["provider"];
          apiKey: string;
          baseUrl?: string;
        }) => Promise<ProviderModelInfo[]>;
        fetchOpenRouterModels: () => Promise<
          import("../shared/ipc-types").OpenRouterModelsResult
        >;
        diagnose: (input: DiagnosticInput) => Promise<DiagnosticResult>;
        discoverLocal: (payload?: {
          baseUrl?: string;
        }) => Promise<LocalOllamaDiscoveryResult>;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        onFullScreenChanged: (
          callback: (isFullScreen: boolean) => void,
        ) => () => void;
      };
      mcp: {
        getServers: () => Promise<McpServerConfig[]>;
        getServer: (serverId: string) => Promise<McpServerConfig | undefined>;
        saveServer: (
          config: McpServerConfig,
        ) => Promise<{ success: boolean; error?: string }>;
        deleteServer: (serverId: string) => Promise<{ success: boolean }>;
        getTools: () => Promise<McpTool[]>;
        getServerStatus: () => Promise<McpServerStatus[]>;
        getPresets: () => Promise<McpPresetsMap>;
      };
      skills: {
        getAll: () => Promise<Skill[]>;
        install: (
          skillPath: string,
        ) => Promise<{ success: boolean; skill: Skill }>;
        delete: (skillId: string) => Promise<{ success: boolean }>;
        setEnabled: (
          skillId: string,
          enabled: boolean,
        ) => Promise<{ success: boolean }>;
        validate: (
          skillPath: string,
        ) => Promise<{ valid: boolean; errors: string[] }>;
        getGlobalSkillsPath: () => Promise<string>;
        packageToZip: (skillName: string) => Promise<ArrayBuffer>;
        computeContentFingerprint: (skillName: string) => Promise<string>;
        writeFingerprint: (
          skillName: string,
          fingerprint: string,
        ) => Promise<void>;
        readFingerprint: (skillName: string) => Promise<string | null>;
        deleteFingerprint: (skillName: string) => Promise<void>;
        readSkillMd: (skillName: string) => Promise<string | null>;
        writeInstalledMeta: (
          skillName: string,
          meta: { skillId: string; version: number },
        ) => Promise<void>;
        readInstalledMeta: (
          skillName: string,
        ) => Promise<{ skillId: string; version: number } | null>;
        getStoragePath: () => Promise<string>;
        setStoragePath: (
          targetPath: string,
          migrate?: boolean,
        ) => Promise<{
          success: boolean;
          path: string;
          migratedCount: number;
          skippedCount: number;
          error?: string;
        }>;
        openStoragePath: () => Promise<{
          success: boolean;
          path: string;
          error?: string;
        }>;
      };
      file: {
        saveToTemp: (buffer: ArrayBuffer, filename: string) => Promise<string>;
        extractArchive: (archivePath: string) => Promise<string>;
        removeTemp: (tempPath: string) => Promise<void>;
      };
      sandbox: {
        getStatus: () => Promise<{
          platform: string;
          mode: string;
          initialized: boolean;
          wsl?: {
            available: boolean;
            distro?: string;
            nodeAvailable?: boolean;
            version?: string;
            pythonAvailable?: boolean;
            pythonVersion?: string;
            pipAvailable?: boolean;
            deskWandCodeAvailable?: boolean;
          };
          lima?: {
            available: boolean;
            instanceExists?: boolean;
            instanceRunning?: boolean;
            instanceName?: string;
            nodeAvailable?: boolean;
            version?: string;
            pythonAvailable?: boolean;
            pythonVersion?: string;
            pipAvailable?: boolean;
            deskWandCodeAvailable?: boolean;
          };
          error?: string;
        }>;
        checkWSL: () => Promise<{
          available: boolean;
          distro?: string;
          nodeAvailable?: boolean;
          version?: string;
          pythonAvailable?: boolean;
          pythonVersion?: string;
          pipAvailable?: boolean;
          deskWandCodeAvailable?: boolean;
        }>;
        checkLima: () => Promise<{
          available: boolean;
          instanceExists?: boolean;
          instanceRunning?: boolean;
          instanceName?: string;
          nodeAvailable?: boolean;
          version?: string;
          pythonAvailable?: boolean;
          pythonVersion?: string;
          pipAvailable?: boolean;
          deskWandCodeAvailable?: boolean;
        }>;
        installNodeInWSL: (distro: string) => Promise<boolean>;
        installPythonInWSL: (distro: string) => Promise<boolean>;
        installNodeInLima: () => Promise<boolean>;
        installPythonInLima: () => Promise<boolean>;
        startLimaInstance: () => Promise<boolean>;
        stopLimaInstance: () => Promise<boolean>;
        retrySetup: () => Promise<{
          success: boolean;
          error?: string;
          result?: unknown;
        }>;
        retryLimaSetup: () => Promise<{
          success: boolean;
          error?: string;
          result?: unknown;
        }>;
      };
      logs: {
        getPath: () => Promise<string | null>;
        getDirectory: () => Promise<string>;
        getAll: () => Promise<
          Array<{ name: string; path: string; size: number; mtime: Date }>
        >;
        export: () => Promise<{
          success: boolean;
          path?: string;
          size?: number;
          error?: string;
        }>;
        open: () => Promise<{ success: boolean; error?: string }>;
        clear: () => Promise<{
          success: boolean;
          deletedCount?: number;
          error?: string;
        }>;
        setEnabled: (
          enabled: boolean,
        ) => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
        isEnabled: () => Promise<{
          success: boolean;
          enabled?: boolean;
          error?: string;
        }>;
        write: (
          level: "info" | "warn" | "error",
          ...args: unknown[]
        ) => Promise<{ success: boolean; error?: string }>;
      };
      remote: {
        getConfig: () => Promise<RemoteConfig>;
        getStatus: () => Promise<{
          running: boolean;
          port?: number;
          publicUrl?: string;
          channels: Array<{ type: string; connected: boolean; error?: string }>;
          activeSessions: number;
          pendingPairings: number;
        }>;
        setEnabled: (
          enabled: boolean,
        ) => Promise<{ success: boolean; error?: string }>;
        updateGatewayConfig: (
          config: Partial<GatewayConfig>,
        ) => Promise<{ success: boolean; error?: string }>;
        updateFeishuConfig: (
          config: FeishuChannelConfig,
        ) => Promise<{ success: boolean; error?: string }>;
        getPairedUsers: () => Promise<PairedUser[]>;
        getPendingPairings: () => Promise<PairingRequest[]>;
        approvePairing: (
          channelType: string,
          userId: string,
        ) => Promise<{ success: boolean; error?: string }>;
        revokePairing: (
          channelType: string,
          userId: string,
        ) => Promise<{ success: boolean; error?: string }>;
        rejectPairing: (
          channelType: string,
          userId: string,
        ) => Promise<{ success: boolean; error?: string }>;
        getRemoteSessions: () => Promise<RemoteSessionMapping[]>;
        clearRemoteSession: (
          sessionId: string,
        ) => Promise<{ success: boolean; error?: string }>;
        getTunnelStatus: () => Promise<{
          connected: boolean;
          url: string | null;
          provider: string;
          error?: string;
        }>;
        getWebhookUrl: () => Promise<string | null>;
        restart: () => Promise<{ success: boolean; error?: string }>;
      };
      schedule: {
        list: () => Promise<ScheduleTask[]>;
        create: (payload: ScheduleCreateInput) => Promise<ScheduleTask>;
        update: (
          id: string,
          updates: ScheduleUpdateInput,
        ) => Promise<ScheduleTask | null>;
        delete: (id: string) => Promise<{ success: boolean }>;
        toggle: (id: string, enabled: boolean) => Promise<ScheduleTask | null>;
        runNow: (id: string) => Promise<ScheduleTask | null>;
      };
      memory: {
        getOverview: (cwd?: string) => Promise<MemoryOverview>;
        search: (payload: {
          query: string;
          cwd?: string;
          sourceWorkspace?: string | null;
          scope?: MemorySearchScope;
          limit?: number;
        }) => Promise<MemorySearchResult[]>;
        read: (id: string) => Promise<MemoryReadResult | null>;
        rebuildWorkspace: (
          cwd: string,
        ) => Promise<{ success: boolean; workspaceKey: string }>;
        clearWorkspace: (
          cwd: string,
        ) => Promise<{ success: boolean; workspaceKey: string }>;
        clearCoreMemory: () => Promise<{ success: boolean }>;
        rebuildAll: () => Promise<{
          success: boolean;
          workspaceCount: number;
          sessionCount: number;
        }>;
        listFiles: () => Promise<MemoryDebugFileInfo[]>;
        readFile: (filePath: string) => Promise<MemoryDebugFileContent>;
        inspectSession: (
          sessionId: string,
          workspaceKey?: string,
        ) => Promise<MemoryInspectSessionResult | null>;
        setEnabled: (
          enabled: boolean,
        ) => Promise<{ success: boolean; enabled: boolean }>;
      };
      auth: {
        login: (providerId: string, force?: boolean) => Promise<void>;
        logout: (providerId: string) => Promise<void>;
        status: (
          providerId: string,
        ) => Promise<import("../shared/ipc-types").OAuthStatusResult>;
      };
      openrouterAuth: {
        login: () => Promise<
          import("../shared/ipc-types").OpenRouterLoginResult
        >;
        logout: () => Promise<void>;
        status: () => Promise<
          import("../shared/ipc-types").OpenRouterAuthStatusResult
        >;
      };
      cloudAuth: {
        googleLogin: () => Promise<
          import("../shared/ipc-types").CloudAuthLoginResult
        >;
      };
      browser: {
        toggle: () => Promise<{
          visible: boolean;
          url: string;
          title: string;
          isLoading: boolean;
          canGoBack: boolean;
          canGoForward: boolean;
        } | null>;
        show: () => Promise<{
          visible: boolean;
          url: string;
          title: string;
          isLoading: boolean;
          canGoBack: boolean;
          canGoForward: boolean;
        } | null>;
        hide: () => Promise<{
          visible: boolean;
          url: string;
          title: string;
          isLoading: boolean;
          canGoBack: boolean;
          canGoForward: boolean;
        } | null>;
        navigate: (url: string) => Promise<{
          visible: boolean;
          url: string;
          title: string;
          isLoading: boolean;
          canGoBack: boolean;
          canGoForward: boolean;
        } | null>;
        getStatus: () => Promise<{
          visible: boolean;
          url: string;
          title: string;
          isLoading: boolean;
          canGoBack: boolean;
          canGoForward: boolean;
        } | null>;
        goBack: () => Promise<{
          visible: boolean;
          url: string;
          title: string;
          isLoading: boolean;
          canGoBack: boolean;
          canGoForward: boolean;
        } | null>;
        goForward: () => Promise<{
          visible: boolean;
          url: string;
          title: string;
          isLoading: boolean;
          canGoBack: boolean;
          canGoForward: boolean;
        } | null>;
        reload: () => Promise<{
          visible: boolean;
          url: string;
          title: string;
          isLoading: boolean;
          canGoBack: boolean;
          canGoForward: boolean;
        } | null>;
        stop: () => Promise<{
          visible: boolean;
          url: string;
          title: string;
          isLoading: boolean;
          canGoBack: boolean;
          canGoForward: boolean;
        } | null>;
        setBounds: (
          x: number,
          y: number,
          w: number,
          h: number,
        ) => Promise<void>;
        setTheme: (theme: string, blankPageBg: string) => Promise<void>;
        enterFullscreen: () => Promise<{ success: boolean; error?: string }>;
        exitFullscreen: () => Promise<{ success: boolean; error?: string }>;
        onStateChanged: (
          callback: (status: {
            visible: boolean;
            url: string;
            title: string;
            isLoading: boolean;
            canGoBack: boolean;
            canGoForward: boolean;
          }) => void,
        ) => () => void;
      };
    };
  }
}
