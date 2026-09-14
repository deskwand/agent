import type { VaultSnapshotItem } from "../../../shared/vault";

/**
 * 选择器里的一行。
 * `id` 同时是「已添加」判定与附件去重用的稳定身份：密库用文件名，工作区用相对路径。
 */
export interface AttachPickerItem {
  id: string;
  label: string;
  size: number;
}

export function mapVaultSnapshotItems(
  items: VaultSnapshotItem[],
): AttachPickerItem[] {
  return items.map((item) => ({
    id: item.name,
    label: item.name,
    size: item.size,
  }));
}

export function mapWorkspaceScan(
  files: Array<{ relPath: string; size: number }>,
): AttachPickerItem[] {
  return files.map((file) => ({
    id: file.relPath,
    label: file.relPath,
    size: file.size,
  }));
}

/** 大小写不敏感的子串匹配；空查询返回全量（保持入参引用，避免无谓重渲染）。 */
export function filterPickerItems(
  items: AttachPickerItem[],
  query: string,
): AttachPickerItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.label.toLowerCase().includes(needle));
}

/** 只有视觉模型确实接受的四种图片类型才标注 image/*，其余一律二进制。 */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function pickerItemMimeType(label: string): string {
  const dot = label.lastIndexOf(".");
  if (dot < 0 || dot === label.length - 1) return "application/octet-stream";
  const ext = label.slice(dot + 1).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] ?? "application/octet-stream";
}
