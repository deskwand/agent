/**
 * 子代理模型 spec 归一化 — 保证 agent 文件中的 model 字段带
 * `deskwand:<profileKey>/<modelId>` 完整前缀，使 pi-subagents 的
 * resolveModel 走 exact match 分支，避免裸模型名 fuzzy 匹配
 * 撞到被污染凭据的原生 provider（见 design-docs/2026-08-10-provider-identity-redesign-design.md）。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DESKWAND_PROVIDER_PREFIX } from "../../../shared/deskwand-provider";
import { basename } from "node:path";

/**
 * 归一化模型 spec：
 * - "inherit" → 原样
 * - "deskwand:xxx/model" → 原样（已带前缀）
 * - "xxx/model" → "deskwand:xxx/model"（补前缀）
 * - 裸模型名（无 "/"）→ 原样（无法推断 provider，由调用方告警）
 */
export function normalizeSubagentModelSpec(model: string): string {
  const trimmed = model.trim();
  if (!trimmed || trimmed === "inherit") return trimmed;
  const slashIdx = trimmed.indexOf("/");
  if (slashIdx === -1) return trimmed;
  const provider = trimmed.slice(0, slashIdx);
  const modelId = trimmed.slice(slashIdx + 1);
  if (!provider || !modelId) return trimmed;
  if (provider.startsWith(DESKWAND_PROVIDER_PREFIX)) return trimmed;
  return `${DESKWAND_PROVIDER_PREFIX}${provider}/${modelId}`;
}

/**
 * 在 frontmatter 块内更新或插入 `field: value`。
 * 限定在首个 `---\n...\n---` 块内，避免误改正文中的同名行。
 */
export function upsertFrontmatterField(
  content: string,
  field: string,
  value: string,
): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return content;
  const body = match[1];
  const lineRe = new RegExp(`^${field}:\\s*.+$`, "m");
  let nextBody: string;
  if (lineRe.test(body)) {
    nextBody = body.replace(lineRe, `${field}: ${value}`);
  } else {
    nextBody = body + `\n${field}: ${value}`;
  }
  return content.replace(match[0], `---\n${nextBody}\n---`);
}

/**
 * 读取 agent 文件，将 model 字段归一化为 deskwand 前缀 spec 后写回。
 * 同时维护 thinking 字段（与 IPC handler 既有行为一致）。
 *
 * 文件不存在时创建新文件；文件存在但读取失败（EACCES/EMFILE 等）
 * 时抛错，由调用方处理 —— 不得静默覆盖已有文件。
 */
export function applySubagentModelSpec(
  target: string,
  model: string,
  thinking?: string,
): void {
  const normalizedModel = normalizeSubagentModelSpec(model);
  if (!existsSync(target)) {
    const thinkingLine =
      thinking && thinking !== "inherit" ? `\nthinking: ${thinking}` : "";
    writeFileSync(
      target,
      `---\nname: ${basename(target, ".md")}\nmodel: ${normalizedModel}${thinkingLine}\nprompt_mode: append\n---\n`,
      "utf-8",
    );
    return;
  }

  let content = readFileSync(target, "utf-8");
  content = upsertFrontmatterField(content, "model", normalizedModel);
  if (thinking && thinking !== "inherit") {
    content = upsertFrontmatterField(content, "thinking", thinking);
  } else {
    content = content.replace(/^thinking:\s*.+\n/m, "");
  }
  writeFileSync(target, content, "utf-8");
}
