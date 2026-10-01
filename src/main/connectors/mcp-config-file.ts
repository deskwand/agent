/**
 * `<agentDir>/mcp.json` 的读写。
 *
 * **为什么这活是我们干**：SDK 只导出**类型**（`McpServerConfig` / `McpServerEntry` /
 * `LoadedMcpConfig`），不导出 `loadMcpConfig` / `addMcpServerConfig` 这些函数，
 * 而 `package.json` 的 `exports` 也没开对应子路径。**类型是公开契约，实现是私有的** ——
 * 这正是 SDK 的意图：配置的形状由它定义，从哪里读、怎么写由宿主决定。
 *
 * 证据是我们本来就接在 `createMcpExtension` 的 `loadConfig` / `updateConfig` 注入点上。
 *
 * 格式与 Claude Desktop / Cursor 的 `mcpServers` 一致，用户可以直接把配置块拷进来。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  LoadedMcpConfig,
  McpServerConfig,
  McpServerEntry,
} from "@earendil-works/pi-coding-agent";

interface McpFileShape {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

export function mcpConfigPath(agentDir: string): string {
  return path.join(agentDir, "mcp.json");
}

/**
 * server 名的合法字符集，与 SDK 的 `validateMcpServerConfig` 一致。
 *
 * 必须在这里拦：名字不合规时 SDK 在 `registerMcpServer` 会抛异常、
 * 在 `loadConfig` 会把该条目丢进 errors —— 两边都是静默的，条目会永久
 * 留在 mcp.json 里却永远连不上，用户看不出原因。
 */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidServerName(name: string): boolean {
  return SERVER_NAME_PATTERN.test(name);
}

function readRaw(agentDir: string): { shape: McpFileShape; errors: string[] } {
  const file = mcpConfigPath(agentDir);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { shape: {}, errors: [] };
    return {
      shape: {},
      errors: [`cannot read ${file}: ${(e as Error).message}`],
    };
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { shape: {}, errors: [`${file}: top level must be an object`] };
    }
    return { shape: parsed as McpFileShape, errors: [] };
  } catch (e) {
    return {
      shape: {},
      errors: [`invalid JSON in ${file}: ${(e as Error).message}`],
    };
  }
}

function writeRaw(agentDir: string, shape: McpFileShape): void {
  const file = mcpConfigPath(agentDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 先写同目录临时文件再 rename：直接 writeFileSync 遇到磁盘满/进程中断会
  // 留下半截 JSON，用户整份 mcp.json 就废了。rename 是原子的，失败时原文件
  // 保持原样，临时文件清掉。临时文件沿用目标文件的所有者可读写权限。
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(shape, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw e;
  }
}

export function readMcpConfig(agentDir: string): LoadedMcpConfig {
  const { shape, errors } = readRaw(agentDir);
  const file = mcpConfigPath(agentDir);
  const servers: McpServerEntry[] = Object.entries(shape.mcpServers ?? {}).map(
    ([name, config]) => ({
      name,
      config,
      source: file,
      scope: "global" as const,
    }),
  );
  return { servers, errors };
}

/** stdio 与 http 靠 `url` 区分，与 SDK 联合类型的判定方式一致。 */
function sameTransport(a: McpServerConfig, b: McpServerConfig): boolean {
  return "url" in a === "url" in b;
}

/**
 * 写入前**强制** `exposure: "direct"`。
 *
 * SDK 默认是 `"codemode"`，那会让 MCP 工具对模型完全不可见，而且**不报错** ——
 * 本仓历史上踩过这个坑（已删的 `mcp-config-projection.ts` 注释里记着）。
 * 所以这里覆盖调用方给的值，不给"忘了传"留余地。
 *
 * `previousName` 是条目的原名（设置页表单的 `id`）。给了它且与 `name` 不同时按
 * 重命名处理：删旧键、写新键，一次落盘。改成已存在的名字时**报错**而不是覆盖 ——
 * 那多半是用户笔误，静默覆盖会连带丢掉另一个 server 的配置。
 */
export function upsertServer(
  agentDir: string,
  name: string,
  config: McpServerConfig,
  previousName?: string,
): void {
  if (!isValidServerName(name)) {
    // 名字不合规时 SDK 会静默拒绝（激活抛异常、加载丢弃），
    // 条目会永久留在文件里却永远连不上。宁可在写入前报错。
    throw new Error(
      `invalid server name "${name}": use letters, digits, "_" and "-"`,
    );
  }

  const { shape, errors } = readRaw(agentDir);
  // 解析失败时拒绝写入：readRaw 会退回空对象，照写下去会把用户手改坏的
  // （但可修复的）配置整份覆盖掉。
  if (errors.length > 0) {
    throw new Error(
      `refusing to overwrite ${mcpConfigPath(agentDir)}: ${errors[0]}`,
    );
  }
  const servers = { ...(shape.mcpServers ?? {}) };
  const sourceName =
    previousName && servers[previousName] ? previousName : undefined;

  if (sourceName && sourceName !== name && servers[name]) {
    throw new Error(
      `cannot rename "${sourceName}" to "${name}": a server named "${name}" already exists`,
    );
  }

  // 同一 transport 的部分保存（例如设置页只切 enabled）要保留 mcp.json 里
  // 表单表达不了的字段（exposure、oauth、timeout、未来的 SDK 选项）。
  // transport 变了则只写新配置，避免旧的 command/args/env 或 url/headers 残留。
  // 重命名时以上一条为准；普通更新则看当前同名条目。
  const existing = servers[sourceName ?? name];
  const merged =
    existing && sameTransport(existing, config)
      ? { ...existing, ...config }
      : { ...config };

  if (sourceName && sourceName !== name) delete servers[sourceName];
  servers[name] = { ...merged, exposure: "direct" };
  writeRaw(agentDir, { ...shape, mcpServers: servers });
}

export function removeServer(agentDir: string, name: string): boolean {
  const { shape, errors } = readRaw(agentDir);
  if (errors.length > 0) return false;
  const servers = { ...(shape.mcpServers ?? {}) };
  if (!(name in servers)) return false;
  delete servers[name];
  writeRaw(agentDir, { ...shape, mcpServers: servers });
  return true;
}

export function setServerEnabled(
  agentDir: string,
  name: string,
  enabled: boolean,
): boolean {
  const { shape, errors } = readRaw(agentDir);
  if (errors.length > 0) return false;
  const servers = { ...(shape.mcpServers ?? {}) };
  const existing = servers[name];
  if (!existing) return false;
  servers[name] = { ...existing, enabled };
  writeRaw(agentDir, { ...shape, mcpServers: servers });
  return true;
}
