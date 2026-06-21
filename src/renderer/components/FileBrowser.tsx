import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "../store";
import {
  Folder,
  FolderOpen,
  File,
  FileCode,
  Image,
  ChevronRight,
  ChevronDown,
  Home,
  Loader2,
} from "lucide-react";
import { FilePreviewModal } from "./FilePreviewModal";
import { IMAGE_EXTS, CODE_LIKE_EXTS } from "../utils/file-types";
import { isPreviewableExt } from "../utils/file-preview";

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  ext: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({
  entry,
  isExpanded,
}: {
  entry: FileEntry;
  isExpanded?: boolean;
}) {
  if (entry.isDir) {
    return isExpanded ? (
      <FolderOpen className="w-4 h-4 shrink-0 text-amber-400" />
    ) : (
      <Folder className="w-4 h-4 shrink-0 text-amber-400" />
    );
  }
  if (IMAGE_EXTS.has(entry.ext)) {
    return <Image className="w-4 h-4 shrink-0 text-sky-400" />;
  }
  if (CODE_LIKE_EXTS.has(entry.ext)) {
    return <FileCode className="w-4 h-4 shrink-0 text-accent" />;
  }
  return <File className="w-4 h-4 shrink-0 text-text-muted" />;
}

function FileTreeItem({
  entry,
  depth,
  basePath,
  onSelect,
  onFileOpen,
  selectedPath,
}: {
  entry: FileEntry;
  depth: number;
  basePath: string;
  onSelect: (fullPath: string, isDir: boolean) => void;
  onFileOpen: (fullPath: string, fileName: string) => void;
  selectedPath: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const fullPath = `${basePath}/${entry.name}`;
  const isSelected = selectedPath === fullPath;

  const handleToggle = useCallback(async () => {
    if (!entry.isDir) {
      onSelect(fullPath, false);
      return;
    }
    if (!expanded && children === null) {
      setLoading(true);
      try {
        if (window.electronAPI) {
          const entries = await window.electronAPI.listDirectory(fullPath);
          setChildren(entries);
        }
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    const next = !expanded;
    setExpanded(next);
    onSelect(fullPath, true);
  }, [entry.isDir, expanded, children, fullPath, onSelect]);

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-0.5 px-2 hover:bg-surface-hover rounded cursor-pointer text-xs select-none ${
          isSelected ? "bg-accent/10 ring-1 ring-accent/20" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleToggle}
        onDoubleClick={() => {
          if (!entry.isDir) {
            onFileOpen(fullPath, entry.name);
          }
        }}
      >
        {entry.isDir ? (
          loading ? (
            <Loader2 className="w-3 h-3 shrink-0 animate-spin text-text-muted" />
          ) : expanded ? (
            <ChevronDown className="w-3 h-3 shrink-0 text-text-muted" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0 text-text-muted" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <FileIcon entry={entry} isExpanded={entry.isDir && expanded} />
        <span className="truncate text-text-primary">{entry.name}</span>
        {!entry.isDir && entry.size > 0 && (
          <span className="ml-auto text-xs text-text-muted shrink-0">
            {formatSize(entry.size)}
          </span>
        )}
      </div>
      {entry.isDir && expanded && children && (
        <div>
          {children.map((child) => (
            <FileTreeItem
              key={child.name}
              entry={child}
              depth={depth + 1}
              basePath={fullPath}
              onSelect={onSelect}
              onFileOpen={onFileOpen}
              selectedPath={selectedPath}
            />
          ))}
          {children.length === 0 && (
            <div
              className="text-xs text-text-muted py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 12}px` }}
            >
              空目录
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FileBrowser({ width }: { width: number }) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const workingDir = useAppStore((s) => s.workingDir);
  const fileBrowserRoot = useAppStore((s) => s.fileBrowserRoot);
  // Follow active session's cwd first, then global workingDir
  const activeSession = useAppStore((s) =>
    activeSessionId
      ? (s.sessions as { id: string; cwd?: string | null }[]).find(
          (ses) => ses.id === activeSessionId,
        )
      : undefined,
  );
  const effectiveDir = fileBrowserRoot || activeSession?.cwd || workingDir;

  const [rootPath, setRootPath] = useState<string>("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{
    path: string;
    name: string;
  } | null>(null);

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.listDirectory(dirPath);
        setEntries(result);
      }
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (effectiveDir && effectiveDir !== rootPath) {
      setRootPath(effectiveDir);
      loadDirectory(effectiveDir);
    }
  }, [effectiveDir]);

  const handleItemSelect = useCallback(
    (fullPath: string, isDir: boolean) => {
      if (isDir) {
        setSelectedPath(null);
        setRootPath(fullPath);
        loadDirectory(fullPath);
      } else {
        setSelectedPath(fullPath);
      }
    },
    [loadDirectory],
  );

  const handleFileOpen = useCallback((fullPath: string, fileName: string) => {
    const iDot = fileName.lastIndexOf(".");
    const ext = iDot > 0 ? fileName.slice(iDot).toLowerCase() : "";
    if (isPreviewableExt(ext)) {
      setPreviewFile({ path: fullPath, name: fileName });
    } else {
      window.electronAPI?.openPath?.(fullPath);
    }
  }, []);

  const goToWorkspace = useCallback(() => {
    const ws = effectiveDir;
    if (ws && ws !== rootPath) {
      setRootPath(ws);
      loadDirectory(ws);
    }
  }, [rootPath, loadDirectory, effectiveDir]);

  const pathSegments = rootPath ? rootPath.split("/").filter(Boolean) : [];

  const navigateToSegment = useCallback(
    (index: number) => {
      const newPath = "/" + pathSegments.slice(0, index + 1).join("/");
      setRootPath(newPath);
      loadDirectory(newPath);
    },
    [pathSegments, loadDirectory],
  );

  if (!rootPath) {
    return (
      <div
        className="shrink-0 border-l border-border-subtle bg-background/60 flex items-center justify-center"
        style={{ width }}
      >
        <div className="text-text-muted text-xs">未设置工作目录</div>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 border-l border-border-subtle bg-background/60 flex flex-col min-h-0 overflow-hidden"
      style={{ width }}
    >
      {/* Header */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-subtle shrink-0">
        <button
          onClick={goToWorkspace}
          className="w-6 h-6 rounded flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
          title="回到工作区"
        >
          <Home className="w-3.5 h-3.5" />
        </button>
        {/* Breadcrumb */}
        <div className="flex items-center text-xs min-w-0 overflow-x-auto ml-1">
          <button
            onClick={() => {
              setRootPath("/");
              loadDirectory("/");
            }}
            className="text-text-muted hover:text-text-primary shrink-0 transition-colors"
          >
            /
          </button>
          {pathSegments.map((seg, i) => (
            <button
              key={i}
              onClick={() => navigateToSegment(i)}
              className={`shrink-0 hover:text-text-primary transition-colors ${
                i === pathSegments.length - 1
                  ? "text-text-primary font-medium"
                  : "text-text-muted"
              }`}
            >
              <span className="text-text-muted">/</span>
              {seg}
            </button>
          ))}
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-xs">加载中...</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-xs">空目录</div>
        ) : (
          entries.map((entry) => (
            <FileTreeItem
              key={entry.name}
              entry={entry}
              depth={0}
              basePath={rootPath}
              onSelect={handleItemSelect}
              onFileOpen={handleFileOpen}
              selectedPath={selectedPath}
            />
          ))
        )}
      </div>

      {previewFile && (
        <FilePreviewModal
          isOpen={true}
          filePath={previewFile.path}
          fileName={previewFile.name}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}
