import type { VaultSnapshotItem } from "../../../shared/vault";

/**
 * 选择器里的一行。
 * `id` 同时是「已添加」判定与附件去重用的稳定身份：密库与工作区都用相对路径。
 */
export interface AttachPickerItem {
  id: string;
  /** 文件名：列表第一列，也是 FileTypeIcon 的判据 */
  name: string;
  /** 目录前缀：列表第二列，密库嵌套路径与工作区都有 */
  dir?: string;
  size: number;
  /** 搜索匹配用的完整展示串（相对路径） */
  label: string;
}

/** 把工作区相对路径切成目录 + 文件名。渲染层不引 path 模块。 */
export function splitRelPath(relPath: string): {
  dir?: string;
  name: string;
} {
  const normalized = relPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return { dir: undefined, name: normalized };
  return {
    dir: normalized.slice(0, lastSlash) || undefined,
    name: normalized.slice(lastSlash + 1),
  };
}

export function mapVaultSnapshotItems(
  items: VaultSnapshotItem[],
): AttachPickerItem[] {
  return items.map((item) => {
    const { dir, name } = splitRelPath(item.path);
    return {
      id: item.path,
      name,
      dir,
      size: item.size,
      label: item.path,
    };
  });
}

export function mapWorkspaceScan(
  files: Array<{ relPath: string; size: number }>,
): AttachPickerItem[] {
  return files.map((file) => {
    const { dir, name } = splitRelPath(file.relPath);
    return {
      id: file.relPath,
      name,
      dir,
      size: file.size,
      label: file.relPath,
    };
  });
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
