import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** 与 preload `listDirectory` 的返回结构一致；仅本模块内部使用。 */
interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  ext: string;
}

export interface TreeRow {
  /** 绝对路径：既是 React key，也是展开状态的身份 */
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  /** 缩进层级，根目录下的条目为 0 */
  depth: number;
  /** 目录是否已展开（文件恒为 false） */
  expanded: boolean;
}

type EntryMap = Map<string, FileEntry[]>;

/**
 * 文件树状态。树根固定为工作目录，展开状态与已加载内容都在这里。
 *
 * 刻意**不做目录内容缓存**：每次展开都重新读盘，于是「收起再展开」本身就是
 * 刷新，不需要额外的手动刷新入口（也不需要 `refresh()` API）。
 * 成本可接受：主进程只对文件做 statSync，目录直接给 size 0。
 */
export function useFileTree(rootPath: string) {
  const [entries, setEntries] = useState<EntryMap>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  // 并发去重必须用 ref：`loading` 是 state，同一 tick 内读到的还是旧值
  const inFlight = useRef<Set<string>>(new Set());

  const load = useCallback(async (dirPath: string) => {
    if (inFlight.current.has(dirPath)) return;
    inFlight.current.add(dirPath);
    setLoading((prev) => new Set(prev).add(dirPath));
    try {
      const result = window.electronAPI
        ? await window.electronAPI.listDirectory(dirPath)
        : [];
      setEntries((prev) => new Map(prev).set(dirPath, result));
    } catch {
      setEntries((prev) => new Map(prev).set(dirPath, []));
    } finally {
      inFlight.current.delete(dirPath);
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  }, []);

  // 换根（切会话 / 换工作目录）→ 整棵树重建
  useEffect(() => {
    setEntries(new Map());
    setExpanded(new Set());
    setLoading(new Set());
    inFlight.current = new Set();
    if (rootPath) void load(rootPath);
  }, [rootPath, load]);

  const toggle = useCallback(
    (dirPath: string) => {
      if (expanded.has(dirPath)) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
        return;
      }
      setExpanded((prev) => new Set(prev).add(dirPath));
      void load(dirPath);
    },
    [expanded, load],
  );

  const rows = useMemo(() => {
    if (!rootPath) return [];
    const out: TreeRow[] = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of entries.get(dir) ?? []) {
        const path = `${dir}/${entry.name}`;
        const isOpen = entry.isDir && expanded.has(path);
        out.push({
          path,
          name: entry.name,
          isDir: entry.isDir,
          size: entry.size,
          depth,
          expanded: isOpen,
        });
        if (isOpen) walk(path, depth + 1);
      }
    };
    walk(rootPath, 0);
    return out;
  }, [entries, expanded, rootPath]);

  const isLoading = useCallback((path: string) => loading.has(path), [loading]);

  // 已展开且已加载、但一个子项都没有 → 渲染层要给「空目录」提示。
  // 未加载（entries 里没有这个键）不算空，否则加载中会闪一下提示。
  const isEmpty = useCallback(
    (path: string) => expanded.has(path) && entries.get(path)?.length === 0,
    [expanded, entries],
  );

  return {
    rows,
    rootLoading: loading.has(rootPath),
    isLoading,
    isEmpty,
    toggle,
  };
}
