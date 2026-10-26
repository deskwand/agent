/**
 * 概览「环境 / 更改」的 git 事实探针。
 *
 * 与 use-is-git-repo 同策略：cwd 维度的模块级缓存 + 在飞请求共享。
 * 另外两条只属于这里：可见性门控（面板不可见时不刷新）与序号丢弃
 * （切会话时旧响应不许覆盖新会话）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RepoSummary } from "../../shared/repo-summary";

const SUMMARY_TTL_MS = 60_000;

interface CachedSummary {
  summary: RepoSummary;
  at: number;
}

const cache = new Map<string, CachedSummary>();
const inFlight = new Map<string, Promise<RepoSummary>>();

async function fetchSummary(cwd: string, force: boolean): Promise<RepoSummary> {
  const cached = cache.get(cwd);
  if (!force && cached && Date.now() - cached.at < SUMMARY_TTL_MS) {
    return cached.summary;
  }
  const pending = inFlight.get(cwd);
  if (pending) return pending;

  const run = (async () => {
    const api = window.electronAPI?.git;
    if (!api?.getRepoSummary) {
      throw new Error("git bridge unavailable");
    }
    const summary = await api.getRepoSummary(cwd);
    cache.set(cwd, { summary, at: Date.now() });
    return summary;
  })();
  inFlight.set(cwd, run);
  // 只删自己这一条：先 set 再挂 finally，否则同步抛错的 promise 会永久留在
  // inFlight 里，让该 cwd 的后续每次刷新都拿到同一个拒绝。
  return run.finally(() => {
    if (inFlight.get(cwd) === run) inFlight.delete(cwd);
  });
}

/** 测试用：清空缓存与在飞请求。 */
export function resetRepoSummaryCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}

export interface RepoSummaryResult {
  summary: RepoSummary | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

interface RepoSummaryData {
  summary: RepoSummary | null;
  isLoading: boolean;
  error: string | null;
}

const EMPTY_DATA: RepoSummaryData = {
  summary: null,
  isLoading: false,
  error: null,
};

export function useRepoSummary(
  cwd: string | null | undefined,
  options: { visible: boolean; refetchKey?: string | number },
): RepoSummaryResult {
  const { visible } = options;
  const refetchKey = options.refetchKey ?? "";
  const [data, setData] = useState<RepoSummaryData>(EMPTY_DATA);
  const [manualNonce, setManualNonce] = useState(0);
  const seqRef = useRef(0);
  const lastCwdRef = useRef(cwd);
  const lastRefetchKey = useRef(refetchKey);

  // cwd 变了：立刻作废在飞响应并清空旧会话的数字
  useEffect(() => {
    if (lastCwdRef.current === cwd) return;
    lastCwdRef.current = cwd;
    seqRef.current += 1;
    setData(EMPTY_DATA);
  }, [cwd]);

  const load = useCallback(
    async (force: boolean) => {
      if (!cwd) {
        setData(EMPTY_DATA);
        return;
      }
      const seq = seqRef.current + 1;
      seqRef.current = seq;
      setData((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const summary = await fetchSummary(cwd, force);
        if (seqRef.current !== seq) return;
        setData({ summary, isLoading: false, error: null });
      } catch (error) {
        if (seqRef.current !== seq) return;
        setData({
          summary: null,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [cwd],
  );

  useEffect(() => {
    if (!visible) return;
    const forced = manualNonce > 0 || lastRefetchKey.current !== refetchKey;
    lastRefetchKey.current = refetchKey;
    void load(forced);
  }, [visible, cwd, refetchKey, manualNonce, load]);

  // 窗口重新聚焦时补一次（TTL 内不重复 spawn）
  useEffect(() => {
    if (!visible || !cwd) return;
    const onFocus = () => {
      void load(false);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [visible, cwd, load]);

  const refresh = useCallback(() => setManualNonce((n) => n + 1), []);

  return { ...data, refresh };
}
