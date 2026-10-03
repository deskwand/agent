/**
 * 已下架的内置预设的**签名表**，用来清掉它们留在 `mcp.json` 里的条目。
 *
 * 背景：预设下架时只从 `BUILTIN_PRESETS` 摘掉条目、**不动用户文件**（方向是对的 ——
 * 不能因为下架一个预设就删掉同名的手写配置）。但写过的条目会留在 `<agentDir>/mcp.json`，
 * 而归属判定只看名字表（`sources/mcp-custom-source.ts` 只认还在的预设名 + 目录 key），
 * 于是它被当成**用户自建 server** 渲染成一张连接页卡片：既删不掉（stdio 卡片只画开关），
 * 打开也连不上。
 *
 * 判定只比 `{command, args}`，**不比整个条目对象**：我们自己的不同版本写出的形状不同
 * —— 10-01 那版 upsert 强制写 `exposure:"direct"`，开关还会补 `enabled` —— 整对象比较
 * 会静默漏掉我们自己写的那条。
 *
 * 表里存判定函数而不是字面配置：`Software_Development` 的 args 里嵌着随安装位置变的
 * 绝对路径，字面比较在 app 挪过位置、或开发模式跑过时会漏。
 *
 * ⚠️ 往这张表里加名字的唯一前提：这个名字**确实**已经从 `builtin-presets.ts` 的
 * `BUILTIN_PRESETS` 里消失了。反过来 —— 如果哪天某个名字被重新加回预设（用户又能正经
 * 添加它），这张表会在每次启动时删掉用户刚写的配置，那时必须把对应条目从这里删掉。
 */
import * as path from "node:path";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import { readMcpConfig, removeServer } from "./mcp-config-file";
import { logWarn } from "../utils/logger";

export interface RetiredPreset {
  /** `mcp.json` 里的服务名。 */
  name: string;
  /** 命中判据。**不要加 `enabled` / `exposure` 之类的比对** —— 见文件头。 */
  matches: (config: McpServerConfig) => boolean;
}

/** 「有 command 没有 url」= stdio。`type` 在类型里是可选的，所以只能这样判 transport。 */
type StdioConfig = Extract<McpServerConfig, { command: string }>;

function isStdio(config: McpServerConfig): config is StdioConfig {
  return !("url" in config);
}

function sameArgs(args: string[] | undefined, expected: string[]): boolean {
  return (
    Array.isArray(args) &&
    args.length === expected.length &&
    args.every((value, i) => value === expected[i])
  );
}

/**
 * `resolveMcpServerPath` 有三条出口：打包后、开发时的 `dist-mcp` 各给一个 `.js`，
 * 最后的源码回退给 `.ts`；三条全部失败时 `config()` 写入的是空串。四种都算我们写的 ——
 * 只认 `.js` 会让一部分残留永远清不掉，而清不掉的失败形态是静默的（卡一直留在那儿）。
 */
const SOFTWARE_DEV_BASENAMES = [
  "software-dev-server-example.js",
  "software-dev-server-example.ts",
  "",
];

/** 下架那一刻的定义，逐字冻结（`builtin-presets.ts` 里已经没有它了）。 */
const CHROME_ARGS = [
  "-y",
  "chrome-devtools-mcp@latest",
  "--browser-url",
  "http://localhost:9222",
];

export const RETIRED_PRESETS: readonly RetiredPreset[] = [
  {
    name: "Chrome",
    matches: (config) =>
      isStdio(config) &&
      config.command === "npx" &&
      sameArgs(config.args, CHROME_ARGS),
  },
  {
    // args[0] 是 `resolveMcpServerPath` 解出来的绝对路径，随安装位置/开发模式变 ——
    // 只认文件名，否则这些用户会漏掉。
    name: "Software_Development",
    matches: (config) =>
      isStdio(config) &&
      config.command === "node" &&
      Array.isArray(config.args) &&
      config.args.length === 1 &&
      SOFTWARE_DEV_BASENAMES.includes(path.basename(config.args[0])),
  },
];

/**
 * 删掉 `mcp.json` 里的下架预设残留，返回被删的服务名。
 *
 * 幂等：没命中就不写盘（`removeServer` 只在名字存在时才写）。文件读不出来
 * （坏 JSON / 权限）时直接返回空数组 —— 清理失败不该影响启动。
 *
 * 每删一条写一行 `logWarn`，带上完整签名：这是全仓唯一会删用户文件内容的路径，
 * 判据又是签名，删掉的东西必须能事后重建。
 */
export function cleanupRetiredPresets(agentDir: string): string[] {
  const loaded = readMcpConfig(agentDir);
  if (loaded.errors.length > 0) return [];

  const removed: string[] = [];
  for (const entry of loaded.servers) {
    const preset = RETIRED_PRESETS.find((p) => p.name === entry.name);
    if (!preset) continue;
    // `readMcpConfig` 不校验形状：手写坏的 mcp.json 里可能是 `null`，而 `"url" in null` 会抛。
    // 逐条守住 —— 一条坏数据不该中断整次清理，把别的残留一起漏掉。
    if (typeof entry.config !== "object" || entry.config === null) continue;
    if (!preset.matches(entry.config)) continue;
    if (!removeServer(agentDir, entry.name)) continue;
    removed.push(entry.name);
    logWarn(
      `[connectors] removed retired preset: ${entry.name} ${JSON.stringify(entry.config)}`,
    );
  }
  return removed;
}
