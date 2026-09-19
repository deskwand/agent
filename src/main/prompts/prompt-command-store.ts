/**
 * @module main/prompts/prompt-command-store
 *
 * 自定义命令 = pi 的提示词模板 `~/.pi/agent/prompts/<name>.md` 的读写。
 *
 * 写入有两条硬约束，错一条就是线上事故：
 * 1. 值一律用 JSON.stringify 产出带引号的标量。JSON 双引号字符串是合法的 YAML
 *    双引号标量（YAML 1.2 是 JSON 的超集），`:` `#` `"` `\` 全都安全；手拼
 *    `key: 值` 或复用仓库里的 upsertFrontmatterField（字符串替换、不加引号）
 *    会写出非法 YAML —— pi 的 parseFrontmatter 直接 parse，抛异常后
 *    loadTemplateFromFile 的 catch 会 return null，**该命令从菜单里整个消失**。
 * 2. 只重写 display_name 一个字段，其余行逐字保留 —— `description`、
 *    `argument-hint`、任何第三方字段都是别人的，用户手写的不该被我们吞掉。
 *    （表单里没有「描述」这一格：它只在斜杠菜单那行灰字里用，pi 会自动用正文首行兜底，
 *    所以它已经不属于「我们管的字段」。）
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
  validatePromptCommandName,
  type PromptCommandNameError,
} from "../../shared/prompt-command-name";
import type { PiCommandEntry } from "../extensions/pi-command-registry";

export interface PromptCommand {
  name: string;
  displayName?: string;
  content: string;
}

export interface PromptCommandInput {
  name: string;
  displayName?: string;
  content: string;
}

export function getPromptsDir(agentDir: string): string {
  return join(agentDir, "prompts");
}

export function promptCommandFilePath(agentDir: string, name: string): string {
  return join(getPromptsDir(agentDir), `${name}.md`);
}

/** 取 frontmatter 块的原始行；没有 frontmatter 时返回空数组。 */
function frontmatterLines(content: string): string[] {
  // pi 的 parseFrontmatter 会先 stripBom；不跟着做的话，带 BOM 的文件会在保存时
  // 匹配不到 `---` 而丢掉所有保留字段。
  const normalized = content.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  return match[1].split("\n");
}

/**
 * 一行 frontmatter 的键名。**缩进的行一律视为别人的内容**（返回空串）：
 * 多行标量（`description: |`）与嵌套映射的续行不能被我们当成顶层字段处理。
 */
function fieldKey(line: string): string {
  if (/^\s/.test(line)) return "";
  const idx = line.indexOf(":");
  return idx < 0 ? "" : line.slice(0, idx).trim();
}

const MANAGED_FIELDS = new Set(["display_name"]);

/**
 * 生成文件全文。previousContent 为 null 表示新建。
 * 只碰 display_name：值一律 JSON.stringify 加引号，其余 frontmatter 行逐字保留。
 */
export function serializePromptCommandFile(
  input: { displayName?: string; content: string },
  previousContent: string | null,
): string {
  const kept = (previousContent ? frontmatterLines(previousContent) : []).filter(
    (line) => !MANAGED_FIELDS.has(fieldKey(line)),
  );
  const displayName = input.displayName?.trim() ?? "";
  if (displayName) kept.push(`display_name: ${JSON.stringify(displayName)}`);

  // 只去掉首尾空行，**不能**滤掉中间的空行 —— `description: |` 这类多行标量里的
  // 空行是内容，滤掉等于改写了用户手写的 frontmatter。
  while (kept.length > 0 && kept[0].trim() === "") kept.shift();
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();

  const block = kept.join("\n");
  const body = input.content.trim();
  return block ? `---\n${block}\n---\n\n${body}\n` : `${body}\n`;
}

/**
 * 读一个模板文件。文件不存在、读失败或 frontmatter 非法都返回 null
 * —— 与 pi 的 loadTemplateFromFile 同一种降级（那份文件本来也不会出现在菜单里）。
 */
export function readPromptCommand(filePath: string): PromptCommand | null {
  if (!existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  const name = filePath.split(/[/\\]/).pop()?.replace(/\.md$/, "") ?? "";
  try {
    const { frontmatter, body } = parseFrontmatter(raw);
    return {
      name,
      displayName:
        typeof frontmatter.display_name === "string"
          ? frontmatter.display_name
          : undefined,
      // parseFrontmatter 在有 frontmatter 时已 trim，没有时原样返回 —— 统一 trim 一次
      content: body.trim(),
    };
  } catch {
    return null;
  }
}

export type SavePromptCommandResult =
  | { ok: true }
  | { ok: false; error: PromptCommandNameError | "exists" };

export function savePromptCommand(
  agentDir: string,
  input: PromptCommandInput,
  options: { isCreate: boolean },
): SavePromptCommandResult {
  const nameError = validatePromptCommandName(input.name);
  if (nameError) return { ok: false, error: nameError };

  const target = promptCommandFilePath(agentDir, input.name);
  if (options.isCreate && existsSync(target)) return { ok: false, error: "exists" };

  // 文件存在但读不出来（EACCES/EMFILE）时让 readFileSync 抛出去，由调用方处理
  // —— 不得在拿不到旧内容的情况下静默覆盖（同 agent/subagent/model-spec.ts 的约定）。
  const previous = existsSync(target) ? readFileSync(target, "utf-8") : null;
  mkdirSync(getPromptsDir(agentDir), { recursive: true });
  writeFileSync(target, serializePromptCommandFile(input, previous), "utf-8");
  return { ok: true };
}

export function deletePromptCommand(agentDir: string, name: string): boolean {
  if (validatePromptCommandName(name)) return false;
  const target = promptCommandFilePath(agentDir, name);
  if (!existsSync(target)) return false;
  rmSync(target);
  return true;
}

/**
 * pi 的提示词模板（DefaultResourceLoader.getPrompts()）→ 命令注册表条目。
 *
 * `display_name` 不在 pi 的 PromptTemplate 里（它只带 name/description/argumentHint/
 * content/sourceInfo/filePath），所以要自己读文件 —— 但只读全局目录那一批
 * （scope === "user"）：项目级/包内的模板不由我们管，吃了 label 也只能用命令名。
 */
export function toPromptCommandEntries(
  templates: ReadonlyArray<{
    name: string;
    description: string;
    filePath: string;
    scope?: string;
  }>,
): PiCommandEntry[] {
  return templates.map((tpl) => {
    const editable = tpl.scope === "user";
    return {
      name: tpl.name,
      description: tpl.description,
      source: "prompt" as const,
      displayName: editable ? readPromptCommand(tpl.filePath)?.displayName : undefined,
      editable,
    };
  });
}
