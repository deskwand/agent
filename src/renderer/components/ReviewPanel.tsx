import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../store";
import { ResizeHandle } from "./ResizeHandle";
import {
  Maximize2,
  Minimize2,
  X,
  RefreshCw,
  Plus,
  Minus,
  GitBranch,
  Loader2,
  Columns2,
} from "lucide-react";

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    A: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    D: "bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30",
    M: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30",
    R: "bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/30",
  };
  const labels: Record<string, string> = {
    A: "新增",
    D: "删除",
    M: "修改",
    R: "重命名",
  };
  return (
    <span
      className={`text-xs px-1 py-px rounded border shrink-0 ${colors[status] || colors.M}`}
    >
      {labels[status] || status}
    </span>
  );
}

function renderDiffLines(diff: string): {
  lines: { type: "add" | "del" | "hunk" | "meta" | "ctx"; content: string }[];
} {
  const lines = diff.split("\n");
  const result: {
    type: "add" | "del" | "hunk" | "meta" | "ctx";
    content: string;
  }[] = [];
  for (const line of lines) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("deleted file") ||
      line.startsWith("new file") ||
      line.startsWith("rename ")
    ) {
      result.push({ type: "meta", content: line });
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      result.push({ type: "meta", content: line });
    } else if (line.startsWith("@@")) {
      result.push({ type: "hunk", content: line });
    } else if (line.startsWith("+")) {
      result.push({ type: "add", content: line });
    } else if (line.startsWith("-")) {
      result.push({ type: "del", content: line });
    } else {
      result.push({ type: "ctx", content: line });
    }
  }
  return { lines: result };
}

// ── Side-by-side diff ──

interface SideBySideRow {
  left: { type: "del" | "ctx"; content: string; oldLine: number } | null;
  right: { type: "add" | "ctx"; content: string; newLine: number } | null;
  hunk?: string;
  meta?: string;
}

function toSideBySide(
  lines: { type: "add" | "del" | "hunk" | "meta" | "ctx"; content: string }[],
): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const l of lines) {
    if (l.type === "hunk") {
      const m = l.content.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        oldLine = Number(m[1]);
        newLine = Number(m[3]);
      }
      rows.push({ left: null, right: null, hunk: l.content });
      continue;
    }
    if (l.type === "meta") {
      rows.push({ left: null, right: null, meta: l.content });
      continue;
    }
    if (l.type === "ctx") {
      rows.push({
        left: { type: "ctx", content: l.content.slice(1), oldLine: oldLine++ },
        right: { type: "ctx", content: l.content.slice(1), newLine: newLine++ },
      });
    } else if (l.type === "del") {
      rows.push({
        left: { type: "del", content: l.content.slice(1), oldLine: oldLine++ },
        right: null,
      });
    } else {
      rows.push({
        left: null,
        right: { type: "add", content: l.content.slice(1), newLine: newLine++ },
      });
    }
  }

  // merge adjacent del+add → same row
  const merged: SideBySideRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const cur = rows[i];
    if (cur.left?.type === "del" && !cur.right && i + 1 < rows.length) {
      const nxt = rows[i + 1];
      if (!nxt.left && nxt.right?.type === "add") {
        merged.push({ left: cur.left, right: nxt.right });
        i += 2;
        continue;
      }
    }
    merged.push(cur);
    i++;
  }
  return merged;
}

// ── Component ──

export function ReviewPanel() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setReviewOpen = useAppStore((s) => s.setReviewOpen);
  const reviewTargetFile = useAppStore((s) => s.reviewTargetFile);
  const setReviewTargetFile = useAppStore((s) => s.setReviewTargetFile);

  const activeSessionCwd = useAppStore((s) => {
    if (!activeSessionId) return undefined;
    const session = (s.sessions as { id: string; cwd?: string | null }[]).find(
      (ses) => ses.id === activeSessionId,
    );
    return session?.cwd || undefined;
  });

  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fileListWidth, setFileListWidth] = useState(288);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<"unified" | "side-by-side">(
    "unified",
  );

  // Resizable file list sidebar
  const handleResize = useCallback((deltaX: number) => {
    setFileListWidth((prev) => Math.min(500, Math.max(180, prev + deltaX)));
  }, []);

  const loadDiffFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      if (window.electronAPI?.review) {
        const files =
          await window.electronAPI.review.getDiffFiles(activeSessionCwd);
        setDiffFiles(files);
      }
    } catch {
      setDiffFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, [activeSessionCwd]);

  useEffect(() => {
    loadDiffFiles();
  }, [loadDiffFiles]);

  const cwdRef = useRef(activeSessionCwd);
  cwdRef.current = activeSessionCwd;

  const loadFileDiff = useCallback(
    async (filePath: string) => {
      setSelectedFile(filePath);
      setLoadingDiff(true);
      try {
        if (window.electronAPI?.review) {
          const diff = await window.electronAPI.review.getFileDiff(
            filePath,
            cwdRef.current,
          );
          setFileDiff(diff);
        }
      } catch {
        setFileDiff("");
      } finally {
        setLoadingDiff(false);
      }
    },
    [], // stable, reads cwd via ref
  );

  // Auto-select first file (or target file) when diff files are loaded
  useEffect(() => {
    if (diffFiles.length > 0 && !selectedFile) {
      // If a target file was set (e.g., from ArtifactCard), select it
      if (reviewTargetFile) {
        // reviewTargetFile may be absolute while diffFiles use relative paths
        const match = diffFiles.find(
          (f) => f.path === reviewTargetFile || reviewTargetFile.endsWith("/" + f.path),
        );
        if (match) {
          loadFileDiff(match.path);
          return;
        }
        setReviewTargetFile(null);
      }
      loadFileDiff(diffFiles[0].path);
    }
  }, [diffFiles, selectedFile, loadFileDiff, reviewTargetFile, setReviewTargetFile]);

  // Clear reviewTargetFile once the file has been selected
  useEffect(() => {
    if (selectedFile && reviewTargetFile) {
      setReviewTargetFile(null);
    }
  }, [selectedFile, reviewTargetFile, setReviewTargetFile]);

  // When reviewTargetFile is set while panel is already open, reset selection
  useEffect(() => {
    if (reviewTargetFile) {
      setSelectedFile(null);
    }
  }, [reviewTargetFile]);

  const handleClose = useCallback(() => {
    setReviewOpen(false);
    setSelectedFile(null);
    setFileDiff("");
    setDiffFiles([]);
  }, [setReviewOpen]);

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const fileName = selectedFile
    ? selectedFile.split("/").pop() || selectedFile
    : null;
  const diffData = fileDiff ? renderDiffLines(fileDiff) : { lines: [] };

  const toolbar = (
    <div className="flex items-center gap-2 shrink-0 px-4 py-2 border-b border-border/20">
      <GitBranch className="w-4 h-4 text-accent" />
      <span className="text-sm font-medium text-text-primary">代码审查</span>
      <span className="text-xs text-text-muted ml-2">
        {diffFiles.length} 个文件
      </span>
      <button
        onClick={loadDiffFiles}
        className="w-6 h-6 rounded flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors ml-2"
        title="刷新"
      >
        <RefreshCw
          className={`w-3.5 h-3.5 ${loadingFiles ? "animate-spin" : ""}`}
        />
      </button>
      <button
        onClick={() =>
          setDiffViewMode((m) => (m === "unified" ? "side-by-side" : "unified"))
        }
        className="w-6 h-6 rounded flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
        title={diffViewMode === "unified" ? "切换到双栏" : "切换到统一"}
      >
        <Columns2 className="w-3.5 h-3.5" />
      </button>
      <div className="flex-1" />
      <button
        onClick={() => setIsFullscreen((f) => !f)}
        className="w-7 h-7 rounded flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
        title={isFullscreen ? "退出全屏" : "全屏"}
      >
        {isFullscreen ? (
          <Minimize2 className="w-4 h-4" />
        ) : (
          <Maximize2 className="w-4 h-4" />
        )}
      </button>
      <button
        onClick={handleClose}
        className="w-7 h-7 rounded flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
        title="关闭"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  const body = (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* File list */}
      <div
        className="shrink-0 border-r border-border/20 overflow-y-auto"
        style={{ width: fileListWidth }}
      >
        {renderFileList(diffFiles, loadingFiles, selectedFile, loadFileDiff)}
      </div>

      {/* Resizable divider */}
      <ResizeHandle
        onResize={handleResize}
        onDoubleClick={() => setFileListWidth(288)}
      />

      {/* Diff view */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {renderDiffView(
          selectedFile,
          fileName,
          loadingDiff,
          diffData,
          activeSessionCwd,
          fileDiff?.length,
          diffViewMode,
        )}
      </div>
    </div>
  );

  // ── Fullscreen mode ──
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {toolbar}
        {body}
      </div>
    );
  }

  // ── Normal (centered card) mode ──
  // Backdrop is a sibling (not parent) so card layout changes don't re-composite the backdrop.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div aria-hidden className="absolute inset-0 bg-black/40" />
      <div className="relative mx-4 flex flex-col overflow-hidden rounded-6xl border border-border-subtle bg-background shadow-2xl w-[1200px] max-w-[95vw] h-[85vh] max-h-[90vh]">
        {toolbar}
        {body}
      </div>
    </div>
  );
}

function renderFileList(
  diffFiles: DiffFile[],
  loadingFiles: boolean,
  selectedFile: string | null,
  loadFileDiff: (path: string) => void,
) {
  if (loadingFiles && diffFiles.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span className="text-xs">加载中...</span>
      </div>
    );
  }

  if (diffFiles.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted text-xs">暂无差异</div>
    );
  }

  return (
    <div className="py-1">
      {diffFiles.map((file) => (
        <button
          key={file.path}
          onClick={() => loadFileDiff(file.path)}
          className={`w-full text-left px-3 py-1.5 hover:bg-surface-hover transition-colors ${
            selectedFile === file.path ? "bg-surface-hover" : ""
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <StatusBadge status={file.status} />
            <span className="text-xs text-text-primary truncate flex-1">
              {file.path}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 ml-0">
            {file.additions > 0 && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                <Plus className="w-2.5 h-2.5" />
                {file.additions}
              </span>
            )}
            {file.deletions > 0 && (
              <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-0.5">
                <Minus className="w-2.5 h-2.5" />
                {file.deletions}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function renderDiffView(
  selectedFile: string | null,
  fileName: string | null,
  loadingDiff: boolean,
  diffData: {
    lines: { type: "add" | "del" | "hunk" | "meta" | "ctx"; content: string }[];
  },
  debugCwd?: string,
  debugDiffLen?: number,
  diffViewMode?: "unified" | "side-by-side",
) {
  if (!selectedFile) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        选择文件查看差异
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-2 text-xs text-text-muted bg-surface-hover/50 border-b border-border/20 shrink-0 flex items-center gap-2">
        <span className="truncate">{fileName}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {renderDiffContent(
          loadingDiff,
          diffData,
          debugCwd,
          selectedFile,
          debugDiffLen,
          diffViewMode,
        )}
      </div>
    </div>
  );
}

function renderDiffContent(
  loadingDiff: boolean,
  diffData: {
    lines: { type: "add" | "del" | "hunk" | "meta" | "ctx"; content: string }[];
  },
  debugCwd?: string,
  debugFile?: string,
  debugDiffLen?: number,
  diffViewMode?: "unified" | "side-by-side",
) {
  if (loadingDiff) {
    return (
      <div className="flex items-center justify-center py-8 text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span className="text-xs">加载差异...</span>
      </div>
    );
  }

  if (diffData.lines.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted text-xs space-y-1">
        <div>无内容</div>
        <div className="text-xs opacity-60 space-y-0.5 font-mono">
          <div>dir: {debugCwd || "—"}</div>
          <div>file: {debugFile || "—"}</div>
          <div>diffLen: {debugDiffLen ?? "—"}</div>
        </div>
      </div>
    );
  }

  // ── Side-by-side ──
  if (diffViewMode === "side-by-side") {
    const rows = toSideBySide(diffData.lines);
    return (
      <div className="text-xs leading-[1.6] font-mono overflow-x-auto">
        {rows.map((row, i) => {
          if (row.hunk) {
            return (
              <div
                key={i}
                className="text-cyan-700 dark:text-cyan-400 bg-cyan-500/5 px-3 py-px"
              >
                {row.hunk}
              </div>
            );
          }
          if (row.meta) {
            return (
              <div
                key={i}
                className="text-text-muted font-bold bg-surface-hover/30 px-3 py-px"
              >
                {row.meta}
              </div>
            );
          }
          return (
            <div key={i} className="flex min-h-[1.45rem]">
              {/* left (old) */}
              <div
                className={`w-1/2 flex ${row.left?.type === "del" ? "bg-red-500/10" : ""}`}
              >
                <span className="w-12 shrink-0 text-right pr-2 text-text-muted select-none pt-px border-r border-border/20">
                  {row.left?.oldLine ?? ""}
                </span>
                <span
                  className={`flex-1 whitespace-pre-wrap ${row.left?.type === "del" ? "text-red-700 dark:text-red-300" : "text-text-primary"}`}
                >
                  {row.left?.content ?? " "}
                </span>
              </div>
              {/* divider */}
              <div className="w-px bg-border/20 shrink-0" />
              {/* right (new) */}
              <div
                className={`w-1/2 flex ${row.right?.type === "add" ? "bg-emerald-500/10" : ""}`}
              >
                <span className="w-12 shrink-0 text-right pr-2 text-text-muted select-none pt-px border-r border-border/20">
                  {row.right?.newLine ?? ""}
                </span>
                <span
                  className={`flex-1 whitespace-pre-wrap ${row.right?.type === "add" ? "text-emerald-700 dark:text-emerald-300" : "text-text-primary"}`}
                >
                  {row.right?.content ?? " "}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Unified (default) ──
  return (
    <pre className="text-xs leading-[1.6] font-mono p-3 overflow-x-auto">
      {diffData.lines.map((line, i) => {
        const bgClass =
          line.type === "add"
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : line.type === "del"
              ? "bg-red-500/10 text-red-700 dark:text-red-300"
              : line.type === "hunk"
                ? "text-cyan-700 dark:text-cyan-400"
                : line.type === "meta"
                  ? "text-text-muted font-bold"
                  : "text-text-primary";
        return (
          <div key={i} className={`${bgClass}`}>
            {line.content || " "}
          </div>
        );
      })}
    </pre>
  );
}
