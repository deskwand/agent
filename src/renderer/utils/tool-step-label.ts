/**
 * @module renderer/utils/tool-step-label
 *
 * 一行一个工具调用时，行头显示什么。三级回落：
 *
 * 1. `input.description` —— 模型自己写的一句话意图（bash 工具的 schema 参数）
 * 2. 本地命令动词表 —— 已知命令翻成人话（`git status` → 「查看 git 工作区状态」）
 * 3. 既有 `getToolLabel` —— `$ 命令` / `读取 path`，等宽显示
 *
 * 只做「显示成什么」，不猜也不改调用参数。
 */
import type { TFunction } from "i18next";
import { getToolLabel } from "../components/message/toolHelpers";

export interface ToolStepLabel {
  text: string;
  /** true = 代码/路径类文本（等宽字体）；false = 人话（正文字体） */
  mono: boolean;
}

/** 行头只放得下一行；再长也只会被 CSS 截断，先在这里兜住。 */
const MAX_LABEL_CHARS = 160;

/**
 * 只有我们自己控制 schema 的工具，才采信 `description` 是「给人看的一句意图」。
 * 其他工具（MCP、插件、子代理）也可能有叫 `description` 的参数，语义各不相同，
 * 拿来当行标题是瞎猜 —— 那类工具走下面两级回落。
 */
const DESCRIPTION_LABEL_TOOLS = new Set(["bash", "execute_command"]);

/**
 * 命令动词表：只认「命令开头就是它」，命中不了就老实用 `$ 命令`。
 *
 * 只收「原样贴出来读不懂」的命令。`ls -la` / `cat foo.ts` / `curl ...` 本来就一眼
 * 明白，翻成「列出目录内容」反而丢信息，所以它们不在表里。
 */
const COMMAND_LABELS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /^git\s+status\b/, key: "tool.step.cmdGitStatus" },
  { pattern: /^git\s+diff\b/, key: "tool.step.cmdGitDiff" },
  { pattern: /^git\s+log\b/, key: "tool.step.cmdGitLog" },
  {
    pattern: /^(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|^npx\s+vitest\b/,
    key: "tool.step.cmdRunTests",
  },
  {
    pattern: /^(npm|pnpm|yarn|bun)\s+(run\s+)?build\b/,
    key: "tool.step.cmdBuild",
  },
  {
    pattern: /^(npm|pnpm|yarn|bun)\s+(install|i|ci)\b/,
    key: "tool.step.cmdInstall",
  },
  { pattern: /^(rg|grep|ag)\b/, key: "tool.step.cmdSearchCode" },
];

function readDescription(
  input: Record<string, unknown> | undefined,
): string | null {
  const value = input?.description;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.length > MAX_LABEL_CHARS
    ? `${trimmed.slice(0, MAX_LABEL_CHARS)}…`
    : trimmed;
}

function readCommand(input: Record<string, unknown> | undefined): string {
  const value = input?.command ?? input?.cmd;
  return typeof value === "string" ? value.trim() : "";
}

export function getToolStepLabel(
  name: string,
  input: Record<string, unknown> | undefined,
  t: TFunction,
): ToolStepLabel {
  const lower = name.toLowerCase();
  if (DESCRIPTION_LABEL_TOOLS.has(lower)) {
    const description = readDescription(input);
    if (description) {
      return { text: description, mono: false };
    }
  }

  if (lower === "bash" || lower === "execute_command") {
    const command = readCommand(input);
    const matched = command
      ? COMMAND_LABELS.find((rule) => rule.pattern.test(command))
      : undefined;
    if (matched) {
      return { text: t(matched.key), mono: false };
    }
  }

  return { text: getToolLabel(name, input ?? {}, t), mono: true };
}
