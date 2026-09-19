import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { ChevronDown, ChevronRight, Loader2, Search, X } from "lucide-react";
import { getFileKind } from "../utils/file-types";
import { FileTypeIcon } from "./file-type-icon";
import { isBrowserOpenableExt, isPreviewableExt } from "../utils/file-preview";
import { openFilePathInBrowser } from "../utils/open-in-browser";
import { splitRelPath } from "./attach/picker-items";
import {
  FILTER_RESULT_CAP,
  filterWorkspaceFiles,
} from "../utils/workspace-filter";
import { useFileTree, type TreeRow } from "../hooks/use-file-tree";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTreeRow({
  row,
  loading,
  selected,
  onToggle,
  onSelect,
  onOpen,
}: {
  row: TreeRow;
  loading: boolean;
  selected: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onOpen: (row: TreeRow) => void;
}) {
  return (
    <div
      className={`flex items-center gap-1 py-0.5 px-2 hover:bg-surface-hover rounded cursor-pointer text-xs select-none ${
        selected ? "bg-accent/10 ring-1 ring-accent/20" : ""
      }`}
      style={{ paddingLeft: `${row.depth * 16 + 8}px` }}
      title={row.path}
      onClick={() => (row.isDir ? onToggle(row.path) : onSelect(row.path))}
      onDoubleClick={() => {
        if (!row.isDir) onOpen(row);
      }}
    >
      {row.isDir ? (
        loading ? (
          <Loader2 className="w-3 h-3 shrink-0 animate-spin text-text-muted" />
        ) : row.expanded ? (
          <ChevronDown className="w-3 h-3 shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0 text-text-muted" />
        )
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <FileTypeIcon
        kind={row.isDir ? "folder" : getFileKind(row.name)}
        expanded={row.expanded}
        size={16}
      />
      <span className="truncate text-text-primary">{row.name}</span>
      {!row.isDir && row.size > 0 && (
        <span className="ml-auto text-xs text-text-muted shrink-0">
          {formatSize(row.size)}
        </span>
      )}
    </div>
  );
}

export function FileBrowser({ width }: { width: number }) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const workingDir = useAppStore((s) => s.workingDir);
  // Follow active session's cwd first, then global workingDir
  const activeSession = useAppStore((s) =>
    activeSessionId
      ? (s.sessions as { id: string; cwd?: string | null }[]).find(
          (ses) => ses.id === activeSessionId,
        )
      : undefined,
  );
  const effectiveDir = activeSession?.cwd || workingDir;
  const openPreview = useAppStore((s) => s.openPreview);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // 扫描结果必须带上它属于哪个工作区：换工作区后迟到的结果只能靠 dir 识别并丢弃
  const [scan, setScan] = useState<{
    dir: string;
    files: Array<{ relPath: string; size: number }>;
    truncated: boolean;
  } | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  // 只认属于当前工作区的那份扫描结果，迟到的旧结果直接当没有
  const activeScan = scan && scan.dir === effectiveDir ? scan : null;
  const tree = useFileTree(effectiveDir ?? "");

  const handleFileOpen = useCallback(
    (fullPath: string, fileName: string) => {
      const iDot = fileName.lastIndexOf(".");
      const ext = iDot > 0 ? fileName.slice(iDot).toLowerCase() : "";
      if (isBrowserOpenableExt(ext)) {
        openFilePathInBrowser(fullPath);
        return;
      }
      if (isPreviewableExt(ext)) {
        openPreview({ path: fullPath, name: fileName });
      } else {
        window.electronAPI?.openPath?.(fullPath);
      }
    },
    [openPreview],
  );

  const handleToggle = useCallback(
    (path: string) => {
      tree.toggle(path);
      setSelectedPath(null);
    },
    [tree],
  );

  const handleOpen = useCallback(
    (row: TreeRow) => {
      handleFileOpen(row.path, row.name);
    },
    [handleFileOpen],
  );

  const runScan = useCallback(async () => {
    if (!window.electronAPI || !effectiveDir) return;
    const dir = effectiveDir;
    setScanLoading(true);
    try {
      const result = await window.electronAPI.scanWorkspaceFiles(effectiveDir);
      setScan({ dir, files: result.files, truncated: result.truncated });
    } catch {
      setScan({ dir, files: [], truncated: false });
    } finally {
      setScanLoading(false);
    }
  }, [effectiveDir]);

  // 换工作区时丢掉上一个工作区的扫描结果（含仍在途中的那次：靠 scan.dir 判定）
  useEffect(() => {
    setScan(null);
  }, [effectiveDir]);

  // 需要扫描当且仅当：有 query、当前工作区还没有它的结果、且没有扫描在进行。
  // 这一个 effect 同时覆盖「首次输入」与「筛选途中换了工作区」——后者以前没人负责，
  // 结果是明明没搜过却报「没有匹配的文件」。
  useEffect(() => {
    if (!query.trim() || !effectiveDir) return;
    if (activeScan || scanLoading) return;
    void runScan();
  }, [query, effectiveDir, activeScan, scanLoading, runScan]);

  const handleQueryChange = useCallback((next: string) => {
    setQuery(next);
    // 回到空 → 丢掉扫描结果，下次重新开始筛选会重扫
    if (!next.trim()) setScan(null);
  }, []);

  const filterResult = useMemo(
    () => filterWorkspaceFiles(activeScan?.files ?? [], query),
    [activeScan, query],
  );

  const filtering = query.trim().length > 0;

  if (!effectiveDir) {
    return (
      <div
        className="shrink-0 border-l border-border-subtle bg-background/60 flex items-center justify-center"
        style={{ width }}
      >
        <div className="text-text-muted text-xs">
          {t("fileBrowser.noWorkdir")}
        </div>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 border-l border-border-subtle bg-background/60 flex flex-col min-h-0 overflow-hidden"
      style={{ width }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle shrink-0">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 h-7 px-2 rounded bg-surface-hover text-text-muted">
          <Search className="w-3.5 h-3.5 shrink-0" />
          <input
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder={t("fileBrowser.filterPlaceholder")}
            aria-label={t("fileBrowser.filterPlaceholder")}
            className="flex-1 min-w-0 bg-transparent outline-none text-xs text-text-primary placeholder:text-text-muted"
          />
          {filtering && (
            <button
              type="button"
              aria-label={t("fileBrowser.clearFilter")}
              onClick={() => handleQueryChange("")}
              className="shrink-0 w-4 h-4 rounded flex items-center justify-center hover:text-text-primary transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 两块都挂载，只切可见性：清空筛选后树的滚动位置不会丢 */}
      <div
        className={filtering ? "hidden" : "flex-1 min-h-0 overflow-y-auto py-1"}
      >
        {tree.rootLoading && tree.rows.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-xs">{t("common.loading")}</span>
          </div>
        ) : tree.rows.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-xs">
            {t("fileBrowser.emptyDir")}
          </div>
        ) : (
          tree.rows.map((row) => (
            <Fragment key={row.path}>
              <FileTreeRow
                row={row}
                loading={tree.isLoading(row.path)}
                selected={selectedPath === row.path}
                onToggle={handleToggle}
                onSelect={setSelectedPath}
                onOpen={handleOpen}
              />
              {row.isDir && row.expanded && tree.isEmpty(row.path) && (
                <div
                  className="text-xs text-text-muted py-1"
                  style={{ paddingLeft: `${(row.depth + 1) * 16 + 12}px` }}
                >
                  {t("fileBrowser.emptyDir")}
                </div>
              )}
            </Fragment>
          ))
        )}
      </div>

      <div
        className={filtering ? "flex-1 min-h-0 overflow-y-auto py-1" : "hidden"}
      >
        {!activeScan ? (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-xs">{t("common.loading")}</span>
          </div>
        ) : (
          <>
            {/* 扫描被截断时必须说，哪怕这一轮一条都没命中（否则就是静默截断） */}
            {activeScan.truncated && (
              <div className="px-3 py-1 text-xs text-text-muted">
                {t("fileBrowser.filterIncomplete")}
              </div>
            )}
            {filterResult.total === 0 ? (
              <div className="text-center py-8 text-text-muted text-xs">
                {t("fileBrowser.filterNoMatch")}
              </div>
            ) : (
              <>
                {filterResult.matches.map((match) => {
                  const { dir, name } = splitRelPath(match.relPath);
                  const fullPath = dir
                    ? `${effectiveDir}/${dir}/${name}`
                    : `${effectiveDir}/${name}`;
                  return (
                    <button
                      key={match.relPath}
                      type="button"
                      onClick={() => handleFileOpen(fullPath, name)}
                      className="w-full flex items-center gap-2 px-2 py-0.5 hover:bg-surface-hover rounded text-xs text-left"
                    >
                      <FileTypeIcon kind={getFileKind(name)} size={16} />
                      <span className="truncate text-text-primary">{name}</span>
                      {dir && (
                        <span className="truncate text-text-muted">{dir}</span>
                      )}
                      <span className="ml-auto text-xs text-text-muted shrink-0">
                        {formatSize(match.size)}
                      </span>
                    </button>
                  );
                })}
                {filterResult.total > filterResult.matches.length && (
                  <div className="px-3 py-1 text-xs text-text-muted">
                    {t("fileBrowser.filterCapped", {
                      count: FILTER_RESULT_CAP,
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
