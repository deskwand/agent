import Store, { type Options as StoreOptions } from "electron-store";
import { app } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import path from "path";
import { log, logError } from "../utils/logger";

/**
 * Preset MCP Server Configurations
 * These are common MCP servers that users can quickly add
 */
/**
 * MCP Server Configuration（原先定义在 mcp-manager.ts；搬到 store 是因为
 * store 自己就是它的消费者，而 manager 将被删除）。
 */
export interface MCPServerConfig {
  id: string;
  name: string;
  type: "stdio" | "sse" | "streamable-http";
  command?: string; // For stdio: command to run
  args?: string[]; // For stdio: command arguments
  env?: Record<string, string>; // Environment variables
  cwd?: string; // Working directory for stdio command
  url?: string; // For SSE / Streamable HTTP: server URL
  headers?: Record<string, string>; // For SSE / Streamable HTTP: HTTP headers
  enabled: boolean;
}

export const MCP_SERVER_PRESETS: Record<
  string,
  Omit<MCPServerConfig, "id" | "enabled"> & {
    requiresEnv?: string[];
    envDescription?: Record<string, string>;
  }
> = {
  chrome: {
    name: "Chrome",
    type: "stdio",
    command: "npx",
    args: [
      "-y",
      "chrome-devtools-mcp@latest",
      "--browser-url",
      "http://localhost:9222",
    ],
  },
  "software-development": {
    name: "Software_Development",
    type: "stdio",
    command: "node",
    args: ["{SOFTWARE_DEV_SERVER_PATH}"], // Path will be resolved at runtime (compiled JS in production)
    env: {
      WORKSPACE_DIR: "",
      TEST_ENV: "development",
    },
    requiresEnv: [],
    envDescription: {
      WORKSPACE_DIR: "Workspace directory for code development (optional)",
      TEST_ENV:
        "Test environment: development, staging, or production (optional)",
    },
  },
  "gui-operate": {
    name: "GUI_Operate",
    type: "stdio",
    command: "node",
    args: ["{GUI_OPERATE_SERVER_PATH}"], // Path will be resolved at runtime (compiled JS in production)
    env: {},
    requiresEnv: [],
    envDescription: {
      // No environment variables required
    },
  },
};

/**
 * MCP Server Configuration Store
 */
class MCPConfigStore {
  private store: Store<{ servers: MCPServerConfig[] }>;

  constructor() {
    const storeOptions: StoreOptions<{ servers: MCPServerConfig[] }> & {
      projectName?: string;
    } = {
      name: "mcp-config",
      projectName: "deskwand",
      cwd: path.join(os.homedir(), ".deskwand"),
      defaults: {
        servers: [],
      },
    };

    this.store = new Store<{ servers: MCPServerConfig[] }>(storeOptions);
  }

  /**
   * Get all MCP server configurations
   */
  getServers(): MCPServerConfig[] {
    return this.store.get("servers", []);
  }

  /**
   * Get a specific server configuration
   */
  getServer(serverId: string): MCPServerConfig | undefined {
    const servers = this.getServers();
    return servers.find((s) => s.id === serverId);
  }

  /**
   * Add or update a server configuration
   */
  saveServer(config: MCPServerConfig): void {
    const servers = this.getServers();
    const index = servers.findIndex((s) => s.id === config.id);

    if (index >= 0) {
      servers[index] = config;
    } else {
      servers.push(config);
    }

    this.store.set("servers", servers);
  }

  /**
   * Delete a server configuration
   */
  deleteServer(serverId: string): void {
    const servers = this.getServers();
    const filtered = servers.filter((s) => s.id !== serverId);
    this.store.set("servers", filtered);
  }

  /**
   * Update all server configurations
   */
  setServers(servers: MCPServerConfig[]): void {
    this.store.set("servers", servers);
  }

  /**
   * Get enabled servers only
   */
  getEnabledServers(): MCPServerConfig[] {
    return this.getServers().filter((s) => s.enabled);
  }

  /**
   * Get preset configurations
   */
  getPresets(): Record<string, Omit<MCPServerConfig, "id" | "enabled">> {
    return MCP_SERVER_PRESETS;
  }

  /**
   * Get the path to a MCP server file in the mcp directory
   */
  /**
   * 解析 `{..._SERVER_PATH}` 占位符（供配置投影使用）。
   *
   * store 本来就在 `createFromPreset` 里解析这两个 token；这里把同一逻辑公开出来，
   * 避免第三份拷贝（\`mcp-manager.ts\` 里已有一份重复的）。
   */
  resolveServerPathToken(token: string): string | null {
    if (token === "SOFTWARE_DEV_SERVER_PATH")
      return this.getSoftwareDevServerPath();
    if (token === "GUI_OPERATE_SERVER_PATH")
      return this.getGuiOperateServerPath();
    return null;
  }

  private getMcpServerPath(filename: string): string | null {
    // In development: __dirname points to dist-electron/main
    // In production: appPath points to the app.asar or unpacked app
    if (app.isPackaged) {
      // Production: use compiled JavaScript files from extraResources/mcp
      // Convert .ts extension to .js
      const jsFilename = filename.replace(/\.ts$/, ".js");
      const mcpPath = path.join(process.resourcesPath || "", "mcp", jsFilename);

      // Check if compiled JS file exists in resources
      try {
        if (fs.existsSync(mcpPath)) {
          return mcpPath;
        }
      } catch {
        // Fall through to development path
      }
    }

    // Development: __dirname is dist-electron/main
    // Need to go up 2 levels to get to project root (dist-electron/main -> dist-electron -> project root)
    const projectRoot = path.join(__dirname, "..", "..");

    // Prefer bundled JS from dist-mcp in development.
    // This avoids attempting to run TypeScript directly with `node`.
    const jsFilename = filename.replace(/\.ts$/, ".js");
    const devBundledPath = path.join(projectRoot, "dist-mcp", jsFilename);
    try {
      if (fs.existsSync(devBundledPath)) {
        return devBundledPath;
      }
    } catch {
      // Fall through to source path
    }

    // Fallback: navigate to src/main/mcp/[filename]
    const sourcePath = path.join(projectRoot, "src", "main", "mcp", filename);

    // Verify file exists and log for debugging
    try {
      if (fs.existsSync(sourcePath)) {
        log(
          `[MCPConfigStore] MCP Server path resolved (${filename}):`,
          sourcePath,
        );
        return sourcePath;
      } else {
        logError(`[MCPConfigStore] File not found at:`, sourcePath);
        logError("[MCPConfigStore] __dirname:", __dirname);
        logError("[MCPConfigStore] projectRoot:", projectRoot);
      }
    } catch (error) {
      logError("[MCPConfigStore] Error checking file:", error);
    }

    return null;
  }

  /**
   * Get the path to the Software Development MCP server file
   */
  private getSoftwareDevServerPath(): string | null {
    return this.getMcpServerPath("software-dev-server-example.ts");
  }

  /**
   * Get the path to the GUI Operate MCP server file
   */
  private getGuiOperateServerPath(): string | null {
    return this.getMcpServerPath("gui-operate-server.ts");
  }

  /**
   * Create a server config from a preset
   */
  createFromPreset(
    presetKey: string,
    enabled: boolean = false,
  ): MCPServerConfig | null {
    const preset = MCP_SERVER_PRESETS[presetKey];
    if (!preset) {
      return null;
    }

    // Resolve path placeholders for presets
    let resolvedPreset = { ...preset };

    if (preset.args) {
      resolvedPreset = {
        ...preset,
        args: preset.args.map((arg) => {
          // Software Development server path
          if (arg === "{SOFTWARE_DEV_SERVER_PATH}") {
            return this.getSoftwareDevServerPath() || arg;
          }
          // GUI Operate server path
          if (arg === "{GUI_OPERATE_SERVER_PATH}") {
            return this.getGuiOperateServerPath() || arg;
          }
          return arg;
        }),
      };
    }

    return {
      ...resolvedPreset,
      id: `mcp-${presetKey}-${crypto.randomUUID()}`,
      enabled,
    };
  }
}

// Singleton instance
export const mcpConfigStore = new MCPConfigStore();
