import type { ChatInputAttachedFile } from "../components/ChatInput";

/**
 * 附件身份 key：同一来源下的同一文件。
 *
 * 选择器会带 `dedupeId`（密库=文件名、工作区=相对路径），因为这两类附件到达
 * 主进程时的 `path` 形态与选择器里的 id 不同；系统文件框与拖拽没有 dedupeId，
 * 退回用绝对路径——同一路径即同一文件，同名不同目录不会互相顶掉。
 */
export function attachmentKey(file: ChatInputAttachedFile): string {
  const source = file.source ?? "local";
  return `${source}:${file.dedupeId ?? file.path}`;
}

/**
 * 合并新附加的文件。返回值与 `prev` 同引用表示没有新增——调用方可据此跳过
 * 一次无谓的状态更新。
 */
export function mergeAttachedFiles(
  prev: ChatInputAttachedFile[],
  next: ChatInputAttachedFile[],
): ChatInputAttachedFile[] {
  const seen = new Set(prev.map(attachmentKey));
  const fresh = next.filter((file) => !seen.has(attachmentKey(file)));
  if (fresh.length === 0) return prev;
  return [...prev, ...fresh];
}

/**
 * 附件身份 key 集合，用于 `setState((prev) => …)`。内容与 `prev` 一致时
 * 返回 `prev`，让 React 直接 bail out——上游上报回调每次都会构造新 Set，
 * 不比较就会变成「effect → setState → 重渲染 → 新回调」的死循环。
 */
export function attachmentKeySet(
  files: ChatInputAttachedFile[],
  prev: ReadonlySet<string>,
): ReadonlySet<string> {
  const next = new Set(files.map(attachmentKey));
  if (next.size !== prev.size) return next;
  for (const key of next) {
    if (!prev.has(key)) return next;
  }
  return prev;
}
