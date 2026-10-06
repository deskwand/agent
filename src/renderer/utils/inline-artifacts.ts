/**
 * 把 `artifact` trace step 归属到轮次。
 *
 * `TraceStep` 没有 `turnId`，只有 `timestamp`，所以轮次边界只能用 user 消息的
 * 时间戳来推：一个 step 属于"它之前最近的那条 user 消息"开启的轮次。
 * 产物 step 在助手回复过程中产生，必然早于下一条 user 消息，因此这个归属是稳的。
 */
import type { Message, TraceStep } from "../types";

export interface InlineArtifactInfo {
  path: string;
  name?: string;
  type?: string;
}

/** 路径比较键：统一分隔符、去掉开头的 "./"。产物路径与文件卡路径都过这里，避免重复呈现。 */
export function normalizeArtifactKey(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

interface InlineArtifactPayload {
  path?: unknown;
  name?: unknown;
  type?: unknown;
  render?: unknown;
}

function parseInlineArtifact(step: TraceStep): InlineArtifactInfo | null {
  if (step.type !== "tool_result" || step.toolName !== "artifact") return null;
  if (!step.toolOutput) return null;

  let parsed: InlineArtifactPayload;
  try {
    parsed = JSON.parse(step.toolOutput) as InlineArtifactPayload;
  } catch {
    return null;
  }
  if (parsed.render !== "inline") return null;
  if (typeof parsed.path !== "string" || !parsed.path.trim()) return null;

  return {
    path: parsed.path,
    name: typeof parsed.name === "string" ? parsed.name : undefined,
    type: typeof parsed.type === "string" ? parsed.type : undefined,
  };
}

export function collectInlineArtifactsByTurn(
  messages: Message[],
  steps: TraceStep[],
): Map<string, InlineArtifactInfo[]> {
  const turnStarts = messages
    .filter((message) => message.role === "user")
    .map((message) => message.timestamp);
  if (turnStarts.length === 0) return new Map();

  const turnStartFor = (timestamp: number): number | undefined => {
    for (let index = turnStarts.length - 1; index >= 0; index -= 1) {
      if (turnStarts[index] <= timestamp) return turnStarts[index];
    }
    return undefined;
  };

  const result = new Map<string, InlineArtifactInfo[]>();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const next = messages[index + 1];
    if (next && next.role !== "user") continue; // 只看轮次末尾那条助手消息

    const start = turnStartFor(message.timestamp);
    if (start === undefined) continue;
    const end = next ? next.timestamp : Number.POSITIVE_INFINITY;

    const artifacts: InlineArtifactInfo[] = [];
    for (const step of steps) {
      if (step.timestamp < start || step.timestamp >= end) continue;
      const artifact = parseInlineArtifact(step);
      if (artifact) artifacts.push(artifact);
    }
    if (artifacts.length > 0) result.set(String(message.id), artifacts);
  }

  return result;
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
