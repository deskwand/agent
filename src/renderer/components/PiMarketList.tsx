import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PiMarketPackageDto } from "../../shared/ipc-types";

export interface PiMarketListProps {
  installedNames: string[];
  selectedName: string | null;
  onSelect: (pkg: PiMarketPackageDto) => void;
}

const PAGE_SIZE = 20;
const MAX_RESULTS = 240; // 12 页上限
const SCROLL_THRESHOLD_PX = 80;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * 分页上限判断：`page` 为 0-based 的下一页索引，
 * 最多加载 12 页 / 240 条，且不超过服务端返回的 total。
 */
export function hasMorePages(page: number, total: number): boolean {
  return (page + 1) * PAGE_SIZE < Math.min(total, MAX_RESULTS);
}

/** Pi 扩展市场左栏列表：300ms 防抖搜索 + 滚动懒加载。 */
export function PiMarketList({
  installedNames,
  selectedName,
  onSelect,
}: PiMarketListProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<PiMarketPackageDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [stopped, setStopped] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const requestSeqRef = useRef(0);
  const loadingRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const loadedQueryRef = useRef("");
  const selectedNameRef = useRef(selectedName);
  selectedNameRef.current = selectedName;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /**
   * 加载一页。`append=false` 表示全新搜索（重置列表并自动选中第一项），
   * `append=true` 表示滚动追加。`requestSeqRef` 递增以丢弃过期响应。
   */
  const loadPage = (searchQuery: string, pageIndex: number, append: boolean) => {
    const seq = ++requestSeqRef.current;
    loadingRef.current = true;
    setLoading(true);
    window.electronAPI.piMarket
      .search(searchQuery, pageIndex)
      .then((result) => {
        if (requestSeqRef.current !== seq) return;
        setItems((prev) =>
          append ? [...prev, ...result.objects] : result.objects,
        );
        setTotal(result.total);
        setPage(pageIndex + 1);
        setError(null);
        if (!append) {
          loadedQueryRef.current = searchQuery;
          const current = selectedNameRef.current;
          const stillSelected =
            current !== null &&
            result.objects.some((pkg) => pkg.name === current);
          if (result.objects.length > 0 && !stillSelected) {
            onSelectRef.current(result.objects[0]);
          }
        }
      })
      .catch((reason: unknown) => {
        if (requestSeqRef.current !== seq) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        if (append) setStopped(true); // 后续页失败：终止加载
      })
      .finally(() => {
        if (requestSeqRef.current === seq) {
          loadingRef.current = false;
          setLoading(false);
        }
      });
  };

  const runSearch = (nextQuery: string) => {
    setQuery(nextQuery);
    setStopped(false);
    setError(null);
    setItems([]);
    setPage(0);
    loadPage(nextQuery, 0, false);
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      runSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || loadingRef.current || stopped) return;
    if (!hasMorePages(page, total)) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD_PX) {
      loadPage(loadedQueryRef.current, page, true);
    }
  };

  const retry = () => {
    runSearch(query);
  };

  useEffect(() => {
    runSearch("");
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      requestSeqRef.current += 1; // 使卸载时在途请求失效
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-[480px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background-secondary/60">
      <div className="shrink-0 border-b border-border-subtle p-2">
        <input
          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          placeholder={t("piExtensions.marketSearchPlaceholder")}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
        />
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-text-muted">
            {t("common.loading")}
          </div>
        ) : error !== null && items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10">
            <p className="text-center text-sm text-text-secondary">{error}</p>
            <button
              type="button"
              className="rounded-lg border border-border bg-surface px-3 py-1 text-sm text-text-primary hover:bg-surface-hover"
              onClick={retry}
            >
              {t("piExtensions.marketRetry")}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-sm text-text-muted">
            {t("piExtensions.marketEmpty")}
          </div>
        ) : (
          <>
            <ul>
              {items.map((pkg) => {
                const selected = selectedName === pkg.name;
                const installed = installedNames.includes(pkg.name);
                return (
                  <li key={pkg.name}>
                    <button
                      type="button"
                      onClick={() => onSelect(pkg)}
                      className={`flex w-full flex-col items-start gap-0.5 border-l-2 px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-accent bg-accent-muted"
                          : "border-transparent hover:bg-surface-hover"
                      }`}
                    >
                      <span className="flex w-full min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold text-text-primary">
                          {pkg.name}
                        </span>
                        {installed && (
                          <span className="shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
                            ✓ {t("piExtensions.marketInstalled")}
                          </span>
                        )}
                        <span className="ml-auto shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
                          {pkg.type}
                        </span>
                      </span>
                      <span className="w-full min-w-0 line-clamp-1 text-xs text-text-muted">
                        {pkg.description || "\u00a0"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {loading && (
              <div className="flex items-center justify-center py-3 text-xs text-text-muted">
                {t("common.loading")}
              </div>
            )}
            {stopped && (
              <div className="border-t border-border-subtle px-3 py-2 text-center text-xs text-text-muted">
                {t("piExtensions.marketLoadStopped")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
