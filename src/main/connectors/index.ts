/**
 * 连接页的 IPC 入口。
 *
 * 把 registry 的四个操作接到 ipcMain 上，并把依赖换成真实实现：
 *  - 配置读写 → Task 5 的 `mcp-config-file`
 *  - 授权     → Task 6 的 `mcp-signin`
 *  - 立刻生效 → Task 10 的 `activateDeskwandMcpServer`
 *
 * 这里**不 import 任何 SDK 的配置/授权函数** —— 它们没从 SDK 导出（见 spec §7.6），
 * 全部走我们自己的模块。
 */
import type { IpcMain } from "electron";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import { MCP_CATALOG } from "../../shared/mcp-catalog";
import type { AddCustomServerInput } from "../../shared/connectors";
import { buildRegistry } from "./registry";
import { getConnectorStatus, subscribeStatus } from "./status-store";
import {
  readMcpConfig,
  upsertServer,
  removeServer,
  setServerEnabled,
  isValidServerName,
} from "./mcp-config-file";
import { cancelSignIn, removeCredentials, startSignIn } from "./mcp-signin";
import { findBuiltinPresetByName } from "./builtin-presets";
import { log, logError } from "../utils/logger";

export interface RegisterConnectorsIpcArgs {
  ipcMain: IpcMain;
  /** 配置与凭据的落地目录（与 pi 的 agent 目录一致）。 */
  agentDir: string;
  /** 打开授权页（与 MCP 扩展的 `openUrl` 同一行为）。 */
  openUrl: (url: string) => void;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  /**
   * 让 SDK 立刻连上一个新 server（spec §7.7）。
   * 会话没开着时返回 false —— 调用方据此提示「下次对话生效」。
   */
  activateMcpServer: (name: string, config: McpServerConfig) => boolean;
}

export function registerConnectorsIpc({
  ipcMain,
  agentDir,
  openUrl,
  sendToRenderer,
  activateMcpServer,
}: RegisterConnectorsIpcArgs): void {
  const registry = buildRegistry({
    loadConfig: () => readMcpConfig(agentDir),
    statusFor: getConnectorStatus,
    catalog: MCP_CATALOG,

    addServer: async (name, config) => {
      try {
        upsertServer(agentDir, name, config);
        log(`[connectors] added ${name}`);
        return { ok: true };
      } catch (e) {
        logError(`[connectors] add ${name} failed`, e);
        return { ok: false, error: (e as Error).message };
      }
    },

    removeServer: async (name) => {
      try {
        removeServer(agentDir, name);
        log(`[connectors] removed ${name}`);
        return { ok: true };
      } catch (e) {
        logError(`[connectors] remove ${name} failed`, e);
        return { ok: false, error: (e as Error).message };
      }
    },

    setServerEnabled: async (name, enabled) => {
      try {
        return setServerEnabled(agentDir, name, enabled)
          ? { ok: true }
          : { ok: false, error: `unknown server: ${name}` };
      } catch (e) {
        logError(`[connectors] setEnabled ${name} failed`, e);
        return { ok: false, error: (e as Error).message };
      }
    },

    signIn: (serverUrl, onAuthorizationUrl) =>
      startSignIn({
        agentDir,
        serverUrl,
        openAuthorizationUrl: onAuthorizationUrl,
      }),

    removeCredentials: (serverUrl) => removeCredentials(agentDir, serverUrl),

    activateNow: (name, config) => activateMcpServer(name, config),
    builtinConfigFor: (serverName) =>
      findBuiltinPresetByName(serverName)?.config(),
    isValidServerName,
    cancelSignIn,
  });

  ipcMain.handle("connectors.list", () => registry.list());
  ipcMain.handle("connectors.addCatalogServer", (_e, key: string) =>
    // openUrl 由主进程注入（与 MCP 扩展同一实现），IPC 边界不传函数
    registry.addCatalogServer(key, openUrl),
  );
  ipcMain.handle("connectors.removeServer", (_e, name: string) =>
    registry.removeServer(name),
  );
  ipcMain.handle(
    "connectors.setEnabled",
    (_e, name: string, enabled: boolean) => registry.setEnabled(name, enabled),
  );
  ipcMain.handle("connectors.authorize", (_e, name: string) =>
    // 授权页走注入的 openUrl（与 MCP 扩展同一行为），
    // 而不是把回调从渲染进程传进来 —— IPC 边界不传函数。
    registry.authorize(name, openUrl),
  );
  ipcMain.handle(
    "connectors.addCustomServer",
    (_e, input: AddCustomServerInput) => registry.addCustomServer(input),
  );
  ipcMain.handle("connectors.cancelSignIn", (_e, name: string) =>
    registry.cancelSignIn(name),
  );

  // 状态变更推给渲染层，取代轮询
  subscribeStatus(() => {
    sendToRenderer("connectors.statusChanged");
  });
}
