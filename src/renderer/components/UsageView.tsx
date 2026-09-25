import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_USAGE_RANGE,
  type ExchangeRates,
  type UsageModelRow,
  type UsageSnapshot,
} from "../../shared/usage";
import { CurrencySelect } from "./usage/CurrencySelect";
import { useAppStore } from "../store";
import { UsageCalendarHeatmap } from "./usage/UsageCalendarHeatmap";
import { UsageHourHeatmap } from "./usage/UsageHourHeatmap";
import {
  compactNumber,
  formatCost,
  formatHitRate,
  modelBarValue,
  sortModelRows,
  sumUnpricedCalls,
  type UsageSortKey,
} from "../utils/usage-format";

const RANGES = ["1d", "7d", "30d", "90d", "all"] as const;
type Range = (typeof RANGES)[number];

/** 热力图固定显示 53 周：格子宽度随卡片自适应，不再按窗口宽度切换周数。 */
const WEEKS = 53;

export function UsageView() {
  const { t, i18n } = useTranslation();
  const setActiveView = useAppStore((s) => s.setActiveView);
  const currency = useAppStore((s) => s.currency);
  const currencyRate = useAppStore((s) => s.currencyRate);
  const setCurrency = useAppStore((s) => s.setCurrency);
  const setCurrencyRate = useAppStore((s) => s.setCurrencyRate);
  const lang = i18n.resolvedLanguage ?? "en";
  const [range, setRange] = useState<Range>(DEFAULT_USAGE_RANGE);
  const [sortKey, setSortKey] = useState<UsageSortKey>("output");
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .invoke<UsageSnapshot>({ type: "usage.query", payload: { range } })
      .then((next) => {
        if (!cancelled) {
          setSnapshot(next);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    if (currency === "USD") return;
    let cancelled = false;
    window.electronAPI
      .invoke<{ rates: ExchangeRates | null }>({
        type: "usage.exchange-rate",
        payload: {},
      })
      .then(({ rates }) => {
        if (!cancelled) setCurrencyRate(rates?.[currency] ?? null);
      })
      .catch(() => {
        if (!cancelled) setCurrencyRate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currency, setCurrencyRate]);

  const now = useMemo(() => Date.now(), []);
  const callCount = snapshot?.totals.calls ?? 0;
  const cacheWrite = snapshot?.totals.cacheWrite ?? 0;
  const unpricedCalls = sumUnpricedCalls(snapshot?.byModel ?? []);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background px-6 py-5">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveView("chat")}
            aria-label={t("common.back")}
            className="-ml-1.5 rounded-lg p-1.5 transition-colors hover:bg-surface-hover"
          >
            <ArrowLeft className="h-5 w-5 text-text-secondary" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">
              {t("usage.title")}
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              {t("usage.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-0.5 rounded-lg border border-border bg-background-secondary p-0.5">
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setRange(value)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                range === value
                  ? "bg-surface text-text-primary"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {t(`usage.range.${value}`)}
            </button>
          ))}
        </div>
        <CurrencySelect value={currency} onChange={setCurrency} />
      </header>

      <div className="mt-5 flex-1 space-y-4 overflow-y-auto pb-4">
        {error ? (
          <p className="text-sm text-error">{error}</p>
        ) : !snapshot ? (
          <p className="text-sm text-text-muted">{t("usage.loading")}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-7">
              <Card
                label={t("usage.cards.input")}
                value={compactNumber(snapshot.totals.input)}
                hint={snapshot.totals.input.toLocaleString()}
              />
              <Card
                label={t("usage.cards.output")}
                value={compactNumber(snapshot.totals.output)}
                hint={snapshot.totals.output.toLocaleString()}
              />
              <Card
                label={t("usage.cards.cacheRead")}
                value={compactNumber(snapshot.totals.cacheRead)}
                hint={snapshot.totals.cacheRead.toLocaleString()}
              />
              <Card
                label={t("usage.cards.cacheHitRate")}
                value={formatHitRate(snapshot.totals.hitRate)}
                hint={t("usage.cards.hitRateHint")}
              />
              <Card
                label={t("usage.cards.cacheWrite")}
                value={cacheWrite === 0 ? "0" : compactNumber(cacheWrite)}
                hint={
                  cacheWrite === 0
                    ? t("usage.cards.cacheNotReported")
                    : cacheWrite.toLocaleString()
                }
              />
              <Card
                label={t("usage.cards.calls")}
                value={callCount.toLocaleString()}
                hint={
                  callCount > 0
                    ? t("usage.cards.avgOutput", {
                        value: Math.round(
                          snapshot.totals.output / callCount,
                        ).toLocaleString(),
                      })
                    : ""
                }
              />
              <Card
                label={t("usage.cards.cost")}
                value={formatCost(
                  snapshot.totals.cost,
                  currency,
                  currencyRate,
                  lang,
                )}
                hint={
                  unpricedCalls > 0
                    ? t("usage.cards.costUnpriced", {
                        count: unpricedCalls.toLocaleString(),
                      })
                    : t("usage.cards.costHint")
                }
              />
            </div>

            <Box title={t("usage.daily")} hint={t("usage.dailyHint")}>
              <UsageCalendarHeatmap
                rows={snapshot.byDay}
                weeks={WEEKS}
                now={now}
              />
            </Box>

            <Box title={t("usage.hourly")} hint={t("usage.hourlyHint")}>
              <UsageHourHeatmap records={snapshot.byHour} />
            </Box>

            <Box
              title={t("usage.byModel")}
              hint={t("usage.byModelHint")}
              action={
                <div className="flex gap-0.5 rounded-lg border border-border bg-background-secondary p-0.5">
                  {(["output", "cost"] as UsageSortKey[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSortKey(value)}
                      className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                        sortKey === value
                          ? "bg-surface text-text-primary"
                          : "text-text-muted hover:text-text-primary"
                      }`}
                    >
                      {t(`usage.sort.${value}`)}
                    </button>
                  ))}
                </div>
              }
            >
              <ModelTable
                rows={snapshot.byModel}
                sortKey={sortKey}
                totalRow={t("usage.totalRow")}
                totalCost={snapshot.totals.cost}
              />
            </Box>
          </>
        )}
      </div>
    </section>
  );
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background-secondary px-3 py-2.5">
      <p className="text-[11px] text-text-muted">{label}</p>
      <p className="mt-0.5 font-mono text-base text-text-primary">{value}</p>
      <p className="mt-0.5 text-[10px] text-text-muted">{hint}</p>
    </div>
  );
}

function Box({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background-secondary px-3.5 py-3">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 className="text-sm font-medium text-text-primary">{title}</h2>
        <span className="ml-auto font-mono text-[10px] text-text-muted">
          {hint}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

function ModelTable({
  rows,
  sortKey,
  totalRow,
  totalCost,
}: {
  rows: UsageModelRow[];
  sortKey: UsageSortKey;
  totalRow: string;
  totalCost: number;
}) {
  const { t, i18n } = useTranslation();
  const currency = useAppStore((s) => s.currency);
  const currencyRate = useAppStore((s) => s.currencyRate);
  const lang = i18n.resolvedLanguage ?? "en";
  if (rows.length === 0) {
    return <p className="text-sm text-text-muted">{t("usage.empty")}</p>;
  }
  const total = rows.reduce(
    (acc, row) => ({
      output: acc.output + row.output,
      input: acc.input + row.input,
      cacheRead: acc.cacheRead + row.cacheRead,
      calls: acc.calls + row.calls,
    }),
    { output: 0, input: 0, cacheRead: 0, calls: 0 },
  );
  const sorted = sortModelRows(rows, sortKey);
  // 条形与排序同一口径（key 决定看输出还是成本），逐行取值统一走 modelBarValue
  // （它会把负数/非有限值夹到 0，否则 width 声明失效、条形反而满格）
  const max = Math.max(...rows.map((row) => modelBarValue(row, sortKey)), 1);
  const headClass =
    "border-b border-border-muted px-2 py-1.5 text-right text-[11px] font-normal text-text-muted";
  const cellClass =
    "border-b border-border-muted px-2 py-1.5 text-right font-mono text-[11px] text-text-secondary";

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={`${headClass} text-left`}>
            {t("usage.columns.model")}
          </th>
          <th className={headClass}>{t("usage.columns.output")}</th>
          <th className={headClass}>{t("usage.columns.input")}</th>
          <th className={headClass}>{t("usage.columns.cacheRead")}</th>
          <th className={headClass}>{t("usage.columns.cost")}</th>
          <th className={headClass}>{t("usage.columns.hitRate")}</th>
          <th className={headClass}>{t("usage.columns.calls")}</th>
          <th className={headClass} />
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={`${row.model ?? "subagent"}-${row.provider ?? ""}`}>
            <td className="border-b border-border-muted px-2 py-1.5 text-xs text-text-primary">
              {row.model ?? t("usage.subagentRow")}
              {row.provider ? (
                <span className="ml-1.5 font-mono text-[10px] text-text-muted">
                  {row.provider}
                </span>
              ) : null}
            </td>
            <td className={cellClass}>{compactNumber(row.output)}</td>
            <td className={cellClass}>{compactNumber(row.input)}</td>
            <td className={cellClass}>{compactNumber(row.cacheRead)}</td>
            <td
              className={`${cellClass} ${row.cost === null ? "text-text-muted" : ""}`}
            >
              {formatCost(row.cost, currency, currencyRate, lang)}
            </td>
            <td
              className={`${cellClass} ${
                row.hitRate !== null && row.hitRate < 90 ? "text-warning" : ""
              }`}
            >
              {formatHitRate(row.hitRate)}
            </td>
            <td className={cellClass}>{row.calls.toLocaleString()}</td>
            <td className="border-b border-border-muted px-2 py-1.5">
              <span className="block h-2 w-14 overflow-hidden rounded-sm bg-surface">
                <span
                  className="block h-full bg-success opacity-70"
                  style={{
                    width: `${(modelBarValue(row, sortKey) / max) * 100}%`,
                  }}
                />
              </span>
            </td>
          </tr>
        ))}
        <tr>
          <td className="px-2 py-1.5 text-xs text-text-secondary">
            {totalRow}
          </td>
          <td className="px-2 py-1.5 text-right font-mono text-[11px] text-text-primary">
            {compactNumber(total.output)}
          </td>
          <td className="px-2 py-1.5 text-right font-mono text-[11px] text-text-primary">
            {compactNumber(total.input)}
          </td>
          <td className="px-2 py-1.5 text-right font-mono text-[11px] text-text-primary">
            {compactNumber(total.cacheRead)}
          </td>
          <td className="px-2 py-1.5 text-right font-mono text-[11px] text-text-primary">
            {formatCost(totalCost, currency, currencyRate, lang)}
          </td>
          <td className="px-2 py-1.5" />
          <td className="px-2 py-1.5 text-right font-mono text-[11px] text-text-primary">
            {total.calls.toLocaleString()}
          </td>
          <td className="px-2 py-1.5" />
        </tr>
      </tbody>
    </table>
  );
}
