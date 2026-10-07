/**
 * 内联产物的展示辅助。
 *
 * 模型写在正文里的 ```artifact 围栏由渲染层拆成内容块（按它在原文中的位置渲染），
 * 文件卡过滤与渲染共用同一份解析。
 */
import type { ArtifactContentBlock, ContentBlock } from "../types";

export interface InlineArtifactInfo {
  path: string;
  name?: string;
  type?: string;
}

/** 路径比较键：统一分隔符、去掉开头的 "./"。产物路径与文件卡路径都过这里，避免重复呈现。 */
export function normalizeArtifactKey(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

const ARTIFACT_FENCE_RE = /```artifact[ \t]*\r?\n([\s\S]*?)```/g;

interface ArtifactPayload {
  path?: unknown;
  name?: unknown;
  render?: unknown;
}

function parseFencePayload(raw: string): ArtifactPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as ArtifactPayload;
  } catch {
    return null;
  }
}

function toArtifactBlock(
  payload: ArtifactPayload,
): ArtifactContentBlock | null {
  if (payload.render !== "inline") return null;
  if (typeof payload.path !== "string" || !payload.path.trim()) return null;
  return {
    type: "artifact",
    path: payload.path,
    name: typeof payload.name === "string" ? payload.name : undefined,
    render: "inline",
  };
}

function splitTextBlock(
  block: Extract<ContentBlock, { type: "text" }>,
  streaming: boolean,
): ContentBlock[] {
  const text = block.text;
  const pieces: ContentBlock[] = [];
  // 累积尚未产出的文字：只有遇到产物块才 flush，
  // 因此被丢掉的围栏（没有 render 标记）两侧的文字会合并成一个块，
  // 而不是碎成相邻的两个 text 块（那样 markdown 会被切成两段）。
  let buffer = "";
  const flush = (): void => {
    if (!buffer) return;
    pieces.push({ ...block, text: buffer });
    buffer = "";
  };

  ARTIFACT_FENCE_RE.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = ARTIFACT_FENCE_RE.exec(text)) !== null) {
    const payload = parseFencePayload(match[1]);
    if (!payload) continue; // JSON 坏掉：不碰它，留给末尾的 buffer 原样带出
    buffer += text.slice(cursor, match.index);
    const artifact = toArtifactBlock(payload);
    if (artifact) {
      flush();
      pieces.push(artifact);
    }
    cursor = match.index + match[0].length;
  }

  let tail = text.slice(cursor);
  if (streaming) {
    // 围栏还没闭合时先不显示，否则会“冒出半截 JSON 再变成产物”
    const openIndex = tail.lastIndexOf("```artifact");
    if (openIndex >= 0) tail = tail.slice(0, openIndex);
  }
  buffer += tail;
  flush();

  // 什么都没变：把原对象原样返回（保引用，调用方的 memo 靠它稳定）
  if (pieces.length === 1) {
    const only = pieces[0];
    if (only.type === "text" && (only as { text: string }).text === text) {
      return [block];
    }
  }
  return pieces;
}

/**
 * 把文本块里的 ```artifact 围栏拆成独立内容块，**位置与顺序保持原样**。
 * - 带 `"render":"inline"` → 产物块
 * - 不带 / 值不对 → 整段围栏从正文里去掉（与今天流式路径的表现一致）
 * - JSON 坏掉、或围栏未闭合且不在流式中 → 原样留在正文
 */
export function splitArtifactBlocks(
  blocks: ContentBlock[],
  options: { streaming?: boolean } = {},
): ContentBlock[] {
  const streaming = Boolean(options.streaming);
  const out: ContentBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "text") {
      out.push(block);
      continue;
    }
    out.push(...splitTextBlock(block, streaming));
  }
  return out;
}

/**
 * 把已经以内联形式渲染的路径从该轮文件卡里剔除。产物是模型 `write_file` 写出来的，
 * `collectResultFiles()` 本来就会把它列进 ArtifactCard——不剔除就是同一路径两种呈现。
 */
export function filterInlineArtifactFiles<T extends { path: string }>(
  files: T[],
  inlineArtifacts: InlineArtifactInfo[],
): T[] {
  if (inlineArtifacts.length === 0) return files;
  const keys = new Set(
    inlineArtifacts.map((artifact) => normalizeArtifactKey(artifact.path)),
  );
  return files.filter((file) => !keys.has(normalizeArtifactKey(file.path)));
}
