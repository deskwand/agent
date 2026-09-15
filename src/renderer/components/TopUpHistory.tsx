import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import type { CloudApiClient, TopUpOrderListItem } from "../services/cloud-api";
import { explorerTxUrl, formatMicroUsd, formatTopUpTime } from "../utils/topup";

const PAGE_SIZE = 20;

export function TopUpHistory({ cloudApi }: { cloudApi: CloudApiClient }) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<TopUpOrderListItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

  const loadFirstPage = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await cloudApi.getTopUpOrders({
        limit: PAGE_SIZE,
        offset: 0,
      });
      setOrders(res.orders);
      setOffset(res.orders.length);
      setHasMore(res.has_more);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = async () => {
    if (!hasMore) return;
    setLoadMoreLoading(true);
    setLoadMoreError(false);
    try {
      const res = await cloudApi.getTopUpOrders({
        limit: PAGE_SIZE,
        offset,
      });
      setOrders((prev) => [...prev, ...res.orders]);
      setOffset((prev) => prev + res.orders.length);
      setHasMore(res.has_more);
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadMoreLoading(false);
    }
  };

  const chainLabel = (chain: TopUpOrderListItem["chain"]) =>
    chain === "bsc"
      ? t("topUp.chainBsc")
      : chain === "arb"
        ? t("topUp.chainArb")
        : t("topUp.chainBase");

  const statusBadge = (status: TopUpOrderListItem["status"]) => {
    if (status === "confirmed")
      return <span className="text-success">{t("topUp.statusConfirmed")}</span>;
    if (status === "expired")
      return <span className="text-error">{t("topUp.statusExpired")}</span>;
    return <span className="text-text-muted">{t("topUp.statusPending")}</span>;
  };

  if (loading) {
    return (
      <p className="py-6 text-center text-sm text-text-muted">
        {t("topUp.historyLoading")}
      </p>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <p className="text-sm text-text-muted">
          {t("topUp.historyLoadFailed")}
        </p>
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary"
          onClick={() => void loadFirstPage()}
        >
          {t("topUp.historyRetry")}
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-text-muted">
        {t("topUp.historyEmpty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {orders.map((o) => (
          <li key={o.id} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-text-primary">
                ${(o.amount_cents / 100).toFixed(2)}
                {o.credited_micro_usd > 0 && (
                  <span className="ml-1 text-xs text-text-muted">
                    ·{" "}
                    {t("topUp.creditedAmount", {
                      usd: formatMicroUsd(o.credited_micro_usd),
                    })}
                  </span>
                )}
              </span>
              {statusBadge(o.status)}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>{formatTopUpTime(o.created_at)}</span>
              <span>{chainLabel(o.chain)}</span>
            </div>
            {o.status === "confirmed" && o.tx_hash && (
              <a
                className="mt-1 inline-flex items-center gap-1 text-xs text-accent"
                href={explorerTxUrl(o.chain, o.tx_hash)}
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  void window.electronAPI?.openExternal?.(
                    explorerTxUrl(o.chain, o.tx_hash),
                  );
                }}
              >
                {t("topUp.viewTx")}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          className="w-full rounded-lg border border-border py-2 text-sm text-text-primary disabled:opacity-40"
          disabled={loadMoreLoading}
          onClick={() => void loadMore()}
        >
          {loadMoreError ? t("topUp.historyRetry") : t("topUp.historyLoadMore")}
        </button>
      )}
    </div>
  );
}
