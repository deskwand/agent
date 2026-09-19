import {
  Archive,
  Code,
  File,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Music,
  Table,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { FileKind } from "../utils/file-types";

/**
 * kind → lucide 图标。
 *
 * 这套字形是 lucide 现成的，不是自绘：色块版（2026-09-12）之所以自绘，
 * 是因为「字形要顶满色块 + 白填充/白描边两种画法」这个约束，而 lucide 是
 * 固定 fill=none 的单色描边，做不了色块。现在没有色块了，约束消失，
 * 于是文件图标与 app 其余图标（含列表里的 chevron）回到同一个实现。
 */
const KIND_ICON: Record<FileKind, LucideIcon> = {
  folder: Folder,
  image: Image,
  video: Video,
  audio: Music,
  doc: FileText,
  sheet: Table,
  code: Code,
  archive: Archive,
  file: File,
};

/**
 * kind → 颜色 class。
 * 文件夹走主题文字 token（跟着 14 档主题自己变），只有文件带类型色。
 */
const KIND_CLASS: Record<FileKind, string> = {
  folder: "text-text-secondary",
  image: "text-file-media",
  video: "text-file-media",
  doc: "text-file-doc",
  sheet: "text-file-doc",
  code: "text-file-code",
  audio: "text-file-audio",
  archive: "text-file-neutral",
  file: "text-file-neutral",
};

export function FileTypeIcon({
  kind,
  expanded,
  size = 16,
}: {
  kind: FileKind;
  expanded?: boolean;
  size?: number;
}) {
  const Icon = kind === "folder" && expanded ? FolderOpen : KIND_ICON[kind];
  return (
    <Icon
      size={size}
      className={`shrink-0 ${KIND_CLASS[kind]}`}
      role="presentation"
      aria-hidden="true"
    />
  );
}
