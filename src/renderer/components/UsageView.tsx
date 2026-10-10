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
import { Button } from "./app-button";
import { SegmentedToggle } from "./usage/SegmentedToggle";
import { Card, CardContent, CardHeader } from "./ui/card";
import { AppProgress } from "./app-progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const RANGES = ["1d", "7d", "30d", "90d", "all"] as const;
type Range = (typeof RANGES)[number];

const SORT_KEYS: readonly UsageSortKey[] = ["output", "cost"];

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
          <Button variant="ghost"
            type="button"
            onClick={() => setActiveView("chat")}
            aria-label={t("common.back")}
            className="-ml-1.5 rounded-lg p-1.5 transition-colors hover:bg-accent h-auto"
          >
            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {t("usage.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("usage.subtitle")}
            </p>
          </div>
        </div>
        <SegmentedToggle
          value={range}
          onChange={setRange}
          testId="usage-range"
          options={RANGES.map((value) => ({
            value,
            label: t(`usage.range.${value}`),
          }))}
        />
        <CurrencySelect value={currency} onChange={setCurrency} />
      </header>

      <div className="mt-5 flex-1 space-y-4 overflow-y-auto pb-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !snapshot ? (
          <p className="text-sm text-muted-foreground">{t("usage.loading")}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-7">
              <StatCard
                label={t("usage.cards.input")}
                value={compactNumber(snapshot.totals.input)}
                hint={snapshot.totals.input.toLocaleString()}
              />
              <StatCard
                label={t("usage.cards.output")}
                value={compactNumber(snapshot.totals.output)}
                hint={snapshot.totals.output.toLocaleString()}
              />
              <StatCard
                label={t("usage.cards.cacheRead")}
                value={compactNumber(snapshot.totals.cacheRead)}
                hint={snapshot.totals.cacheRead.toLocaleString()}
              />
              <StatCard
                label={t("usage.cards.cacheHitRate")}
                value={formatHitRate(snapshot.totals.hitRate)}
                hint={t("usage.cards.hitRateHint")}
              />
              <StatCard
                label={t("usage.cards.cacheWrite")}
                value={cacheWrite === 0 ? "0" : compactNumber(cacheWrite)}
                hint={
                  cacheWrite === 0
                    ? t("usage.cards.cacheNotReported")
                    : cacheWrite.toLocaleString()
                }
              />
              <StatCard
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
              <StatCard
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
                <SegmentedToggle
                  value={sortKey}
                  onChange={setSortKey}
                  options={SORT_KEYS.map((value) => ({
                    value,
                    label: t(`usage.sort.${value}`),
                  }))}
                />
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

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  // 上游 Card 根节点没有内边距（`p-6` 在 CardHeader/CardContent 上）⇒ 这里只补紧凑档。
  // ⚠️ `border-border` 不能省：tailwind.config.js 没有 borderColor.DEFAULT，上游 Card 的
  //    裸 `border` 会落到 Tailwind 默认的 gray-200 —— 深色主题下是一条亮线。
  return (
    <Card className="border-border px-3 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-base text-foreground">{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
    </Card>
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
  // 名字保留 `Box`（改名是多余的改动，只碰必须碰的）；内部已经是 shadcn Card 三件套。
  return (
    <Card className="border-border">
      {/* 上游 CardHeader 是 `flex flex-col space-y-1.5 p-6` ⇒ 这里改回一行、把 space-y 归零
          （三个子元素各带 6px margin-top 会错位）、内边距收到与旧实现等值的 12/10px。 */}
      <CardHeader className="flex-row items-baseline space-y-0 gap-2 px-3.5 pb-2.5 pt-3">
        {/* ⚠️ 不用 CardTitle：上游的 CardTitle 是 div，会把这里的 <h2> 降级。
            样式逐字对齐 CardTitle 的 font-medium leading-none tracking-tight。 */}
        <h2 className="text-sm font-medium leading-none tracking-tight text-foreground">
          {title}
        </h2>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {hint}
        </span>
        {action}
      </CardHeader>
      <CardContent className="px-3.5 pb-3 pt-0">{children}</CardContent>
    </Card>
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
    return <p className="text-sm text-muted-foreground">{t("usage.empty")}</p>;
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
  // 上游 TableHead 是 `h-10 … font-medium`、TableCell 是 `p-2` ⇒ 这里各收一档；
  // `text-right` / `font-normal` 覆盖上游的 `text-left` / `font-medium`。
  // ⚠️ `headClass` **不带** text-align：模型列表头与它的单元格一样是左对齐的（与表体的
  // cellClass 同构：数值档自带 text-right，模型档自己写）。不能靠「两边都写、让 CSS 顺序
  // 判胜」—— 生成顺序里 `.text-right` 在 `.text-left` 之后，那会让模型表头变成右对齐，
  // 与它左对齐的单元格不一致（2026-10-10 评审发现：main 上就是这个不一致）。
  const headClass =
    "h-8 px-2 py-1.5 text-[11px] font-normal text-muted-foreground";
  const cellClass =
    "px-2 py-1.5 text-right font-mono text-[11px] text-muted-foreground";

  return (
    <Table>
      {/* ⚠️ `[&_tr]:border-border/60` 不能省：上游 TableHeader 的 `[&_tr]:border-b` 只有宽度，
          颜色会落到 Tailwind 默认的 gray-200（深色主题下一条亮线）。
          这也接住了 panel-boundary.test.ts 的「表面内分隔线用弱描边」契约。 */}
      <TableHeader className="[&_tr]:border-border/60">
        <TableRow className="hover:bg-transparent">
          <TableHead className={headClass}>
            {t("usage.columns.model")}
          </TableHead>
          <TableHead className={`${headClass} text-right`}>
            {t("usage.columns.output")}
          </TableHead>
          <TableHead className={`${headClass} text-right`}>
            {t("usage.columns.input")}
          </TableHead>
          <TableHead className={`${headClass} text-right`}>
            {t("usage.columns.cacheRead")}
          </TableHead>
          <TableHead className={`${headClass} text-right`}>
            {t("usage.columns.cost")}
          </TableHead>
          <TableHead className={`${headClass} text-right`}>
            {t("usage.columns.hitRate")}
          </TableHead>
          <TableHead className={`${headClass} text-right`}>
            {t("usage.columns.calls")}
          </TableHead>
          <TableHead className={headClass} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow
            key={`${row.model ?? "subagent"}-${row.provider ?? ""}`}
            className="border-border/60"
          >
            <TableCell className="px-2 py-1.5 text-xs text-foreground">
              {row.model ?? t("usage.subagentRow")}
              {row.provider ? (
                <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                  {row.provider}
                </span>
              ) : null}
            </TableCell>
            <TableCell className={cellClass}>
              {compactNumber(row.output)}
            </TableCell>
            <TableCell className={cellClass}>
              {compactNumber(row.input)}
            </TableCell>
            <TableCell className={cellClass}>
              {compactNumber(row.cacheRead)}
            </TableCell>
            <TableCell
              className={`${cellClass} ${row.cost === null ? "text-muted-foreground" : ""}`}
            >
              {formatCost(row.cost, currency, currencyRate, lang)}
            </TableCell>
            <TableCell
              className={`${cellClass} ${
                row.hitRate !== null && row.hitRate < 90 ? "text-warning" : ""
              }`}
            >
              {formatHitRate(row.hitRate)}
            </TableCell>
            <TableCell className={cellClass}>
              {row.calls.toLocaleString()}
            </TableCell>
            <TableCell className="px-2 py-1.5">
              {/* 条形跟主题色，用 Progress 默认的 bg-primary；同时白拿 role="progressbar"
                  + aria-valuenow（旧的 <span> 对读屏隐形）。`w-14` 覆盖上游 Root 的
                  `w-full`，靠 cn 的冲突合并。 */}
              <AppProgress
                value={modelBarValue(row, sortKey)}
                max={max}
                className="h-2 w-14"
              />
            </TableCell>
          </TableRow>
        ))}
        {/* 合计行：TableBody 的 `[&_tr:last-child]:border-0` 已经去掉下框线，这里只需要
            压掉上游 TableRow 的行悬停高亮（合计行不是数据行）。 */}
        <TableRow className="hover:bg-transparent">
          <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
            {totalRow}
          </TableCell>
          <TableCell className="px-2 py-1.5 text-right font-mono text-[11px] text-foreground">
            {compactNumber(total.output)}
          </TableCell>
          <TableCell className="px-2 py-1.5 text-right font-mono text-[11px] text-foreground">
            {compactNumber(total.input)}
          </TableCell>
          <TableCell className="px-2 py-1.5 text-right font-mono text-[11px] text-foreground">
            {compactNumber(total.cacheRead)}
          </TableCell>
          <TableCell className="px-2 py-1.5 text-right font-mono text-[11px] text-foreground">
            {formatCost(totalCost, currency, currencyRate, lang)}
          </TableCell>
          <TableCell className="px-2 py-1.5" />
          <TableCell className="px-2 py-1.5 text-right font-mono text-[11px] text-foreground">
            {total.calls.toLocaleString()}
          </TableCell>
          <TableCell className="px-2 py-1.5" />
        </TableRow>
      </TableBody>
    </Table>
  );
}
