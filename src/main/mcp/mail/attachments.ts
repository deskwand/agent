/**
 * Vendored from https://github.com/samihalawa/email-smtp-imap-mcp
 * at v2.2.0 (commit 6b9610d0c74450e938aa0428d08dbdefa02f4b7f), MIT licensed. See ./LICENSE.
 * Local changes are marked with `[DeskWand]`.
 */

/**
 * 附件的元数据与落盘。
 *
 * **设计 §3.4：附件永不内联进模型上下文。** vendor 原来是
 * `attachment.content.toString('base64')` 直接塞进工具结果 —— 一个 10 MB 的 PDF
 * 就是约 13 MB base64 进对话。这里改成写磁盘 + 返回路径。
 *
 * 元数据从 `bodyStructure` 取，**不抓 source**：vendor 只要
 * `includeContent || includeAttachments` 就抓整封 source，一批 20 封就是 20 封全文进内存，
 * 而文件名和大小本来就在结构里。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { simpleParser } from "mailparser";
import { resolveAttachmentPath, sanitizeAttachmentName } from "./attachment-path";

/** 单封 source 的大小上限。超过就不解析 —— 不去赌机器内存。 */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export interface AttachmentMetadata {
  filename: string;
  contentType: string;
  size: number;
}

/**
 * 从 IMAP `bodyStructure` 里挑出附件。递归，因为附件可能嵌在 multipart/alternative 里。
 * **不要拿它当 `emails_save_attachment` 的 `index`。**
 * 这里按 `disposition === 'attachment'` 过滤，而 `mailparser` 的 `attachments` 数组**包含内嵌图片**
 * （`related: true` 那种）—— 两者下标会错位。所以元数据里**不给 index**：
 * 模型从 `emails_find` 拿到文件名，需要用文件名去取；`index` 只作 `emails_save_attachment`
 * 的备用入口，且只由它自己的解析结果解释。
 */
export function attachmentMetadataFromStructure(structure: any): AttachmentMetadata[] {
  const out: AttachmentMetadata[] = [];
  const walk = (node: any): void => {
    if (!node) return;
    if (String(node.disposition || "").toLowerCase() === "attachment") {
      out.push({
        filename: sanitizeAttachmentName(node.dispositionParameters?.filename),
        contentType: String(node.type || "application/octet-stream"),
        size: Number(node.size ?? 0),
      });
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(structure);
  return out;
}

export interface SaveAttachmentInput {
  source: Buffer;
  root: string;
  email: string;
  index: number;
  taken: Set<string>;
  /** [DeskWand] 工具参数 `directory`：可选的**相对**子目录。 */
  subdir?: string;
}

export interface SavedAttachment {
  path: string;
  filename: string;
  size: number;
}

export async function saveAttachmentFromSource(input: SaveAttachmentInput): Promise<SavedAttachment> {
  const { source, root, email, index, taken, subdir } = input;
  if (source.length > MAX_SOURCE_BYTES) {
    throw new Error(`message is too large to parse (${source.length} bytes, limit ${MAX_SOURCE_BYTES})`);
  }
  const parsed = await simpleParser(source);
  const attachments = parsed.attachments ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= attachments.length) {
    throw new Error(`attachment index ${index} is out of range (this message has ${attachments.length})`);
  }
  const attachment = attachments[index];
  const target = resolveAttachmentPath({
    root,
    email,
    // 邮件声明的文件名不可信 —— resolveAttachmentPath 负责净化与去重
    filename: sanitizeAttachmentName(attachment.filename),
    subdir,
    taken,
  });
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, attachment.content);
  return {
    path: target,
    filename: path.basename(target),
    size: attachment.content.length,
  };
}
