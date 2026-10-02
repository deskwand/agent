/**
 * 应用自带 MCP server 的定义（现已只剩 GUI_Operate）（从已删的 `mcp-config-store.ts` 搬来）。
 *
 * ⚠️ **名字不可改**：工具名是 `mcp__<server>__<tool>`，改名字会变更工具声明，
 * 破坏提示词缓存并让老会话的工具调用记录对不上（本仓 AGENTS.md 明令）。
 *
 * 这份定义只在用户**开关某个能力**时用来写 `mcp.json` 条目，不是常驻配置。
 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";

export interface BuiltinPreset {
  /** 稳定的内部 key（也用作 i18n 后缀） */
  key: string;
  /** ⚠️ 不可改 */
  name: string;
  config: () => McpServerConfig;
  /** 需要在「高级配置」里填的环境变量 */
  envDescription: Record<string, string>;
}

/**
 * 解析随应用打包的 MCP server 脚本路径。
 *
 * 打包后脚本在 `resources/mcp/*.js`；开发时优先用 `dist-mcp/*.js`（免去跑 TypeScript），
 * 最后回退到源码路径。找不到返回 null —— 调用方保持占位符原样，让连接时显式报错，
 * 而不是静默写一个坏路径。
 */
export function resolveMcpServerPath(filename: string): string | null {
  const jsFilename = filename.replace(/\.ts$/, ".js");

  // 打包后脚本在 resources/mcp/*.js（electron-builder 的 extraResources）
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath || "", "mcp", jsFilename);
    if (fs.existsSync(packaged)) return packaged;
  }

  // 开发时用 app.getAppPath() 定位项目根，而不是 __dirname ——
  // 后者随打包方式（vite 输出目录深度）变化，在非打包运行时会指错地方。
  const projectRoot = app.getAppPath();
  const candidates = [
    path.join(projectRoot, "dist-mcp", jsFilename),
    path.join(projectRoot, "src", "main", "mcp", filename),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  {
    key: "gui-operate",
    name: "GUI_Operate",
    config: () => ({
      type: "stdio",
      command: "node",
      args: [resolveMcpServerPath("gui-operate-server.ts") ?? ""],
      env: {},
    }),
    envDescription: {},
  },
] as const;

export function findBuiltinPreset(key: string): BuiltinPreset | undefined {
  return BUILTIN_PRESETS.find((p) => p.key === key);
}

export function findBuiltinPresetByName(
  name: string,
): BuiltinPreset | undefined {
  return BUILTIN_PRESETS.find((p) => p.name === name);
}
