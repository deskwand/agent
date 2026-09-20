import { useMemo, useState } from "react";
import { useAppStore } from "../../store";
import { useTranslation } from "react-i18next";
import type { CurrencyCode, UsageDayRow } from "../../../shared/usage";
import {
  compactNumber,
  formatCost,
  formatHitRate,
  resolveCellLevel,
} from "../../utils/usage-format";

type ColorMode = "usage" | "hit" | "cost";

interface Props {
  rows: UsageDayRow[];
  /** Weeks to display; always 53 (the grid stretches to fill the card width). */
  weeks: number;
  /** Reference instant (epoch ms) that anchors the last column. */
  now: number;
}

const GAP_PX = 2;
/** 周几标签槽宽度：对齐「时段分布」那张图的标签列（2 个汉字 @9px + pr-2）。 */
const GUTTER_PX = 26;

/** Calendar-day arithmetic via the Date constructor, never ms addition: adding
 *  86_400_000ms across a DST transition repeats or skips a local date. */
function addDays(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
}

/** 5 steps: 0 has no inline background (the CSS class paints "no record"). */
const VOLUME_ALPHA = ["0", "0.22", "0.42", "0.66", "1"];
// Index 0 is unused: level 0 means "no record" and is painted by the CSS class.
const HIT_ALPHA = ["0", "1", "0.5", "0.42", "0.72", "1"];
const HIT_TOKEN = [
  "--color-warning",
  "--color-warning",
  "--color-warning",
  "--color-success",
  "--color-success",
  "--color-success",
];

export function UsageCalendarHeatmap({ rows, weeks, now }: Props) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<ColorMode>("usage");
  const currency = useAppStore((s) => s.currency);
  const currencyRate = useAppStore((s) => s.currencyRate);
  const lang = i18n.resolvedLanguage ?? "en";
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: "short" }),
    [i18n.language],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, UsageDayRow>();
    for (const row of rows) map.set(row.date, row);
    return map;
  }, [rows]);

  const allValues = useMemo(
    () =>
      mode === "cost"
        ? rows.map((r) => r.cost)
        : rows.map((r) => r.input + r.output + r.cacheRead),
    [rows, mode],
  );

  const columns = useMemo(() => {
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    // Each column is Sunday → Saturday.
    const endOfWeek = addDays(end, 6 - end.getDay());
    const start = addDays(endOfWeek, -(weeks * 7 - 1));
    const cols: Array<Array<{ key: string; day: Date }>> = [];
    for (let w = 0; w < weeks; w += 1) {
      const col: Array<{ key: string; day: Date }> = [];
      for (let d = 0; d < 7; d += 1) {
        const day = addDays(start, w * 7 + d);
        col.push({ key: localDateKey(day), day });
      }
      cols.push(col);
    }
    return cols;
  }, [now, weeks]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <div className="flex gap-0.5 rounded-lg border border-border bg-background-secondary p-0.5">
          {(["usage", "hit", "cost"] as ColorMode[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                mode === value
                  ? "bg-surface text-text-primary"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {t(`usage.colorMode.${value}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-0.5 overflow-x-auto pb-1">
        <div
          className="sticky left-0 z-10 grid shrink-0 items-center bg-background-secondary pt-4 text-[9px] text-text-muted"
          style={{
            width: GUTTER_PX,
            gridTemplateRows: "repeat(7, 1fr)",
            rowGap: GAP_PX,
          }}
        >
          {[
            "",
            t("usage.weekday.mon"),
            "",
            t("usage.weekday.wed"),
            "",
            t("usage.weekday.fri"),
            "",
          ].map((label, index) => (
            <span key={index} className="leading-none">
              {label}
            </span>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className="grid"
            style={{
              gridAutoFlow: "column",
              gridAutoColumns: "minmax(9px, 1fr)",
              columnGap: GAP_PX,
            }}
          >
            {columns.map((col, index) => (
              <span
                key={index}
                className="whitespace-nowrap text-[9px] text-text-muted"
              >
                {monthLabel(col[0].day, columns, index, monthFormat)}
              </span>
            ))}
          </div>

          <div
            className="grid"
            style={{
              gridAutoFlow: "column",
              gridAutoColumns: "minmax(9px, 1fr)",
              columnGap: GAP_PX,
            }}
          >
            {columns.map((col, index) => (
              <div
                key={index}
                className="grid"
                style={{ gridTemplateRows: "repeat(7, auto)", rowGap: GAP_PX }}
              >
                {col.map(({ key, day }) => (
                  <Cell
                    key={key}
                    dateKey={key}
                    future={day.getTime() > now}
                    row={byDate.get(key)}
                    mode={mode}
                    allValues={allValues}
                    currency={currency}
                    currencyRate={currencyRate}
                    lang={lang}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
        <span>{t("usage.legend.less")}</span>
        {[1, 2, 3, 4, 5].map((level) => (
          <span
            key={level}
            className="block h-2.5 w-2.5 rounded-sm"
            style={swatchStyle(level, mode)}
          />
        ))}
        <span>{t("usage.legend.more")}</span>
        <span className="ml-auto font-mono">
          {weeks} · {t("usage.allTime")} ·{" "}
          {mode === "cost"
            ? formatCost(totalCostOf(rows), currency, currencyRate, lang)
            : formatHitRate(hitRateOf(rows))}
        </span>
      </div>
    </div>
  );
}

function Cell({
  dateKey,
  future,
  row,
  mode,
  allValues,
  currency,
  currencyRate,
  lang,
}: {
  dateKey: string;
  future: boolean;
  row: UsageDayRow | undefined;
  mode: ColorMode;
  allValues: number[];
  currency: CurrencyCode;
  currencyRate: number | null;
  lang: string;
}) {
  if (future) {
    return <span style={{ aspectRatio: "1", alignSelf: "start" }} />;
  }
  const level = resolveCellLevel(row, mode, allValues);
  const empty = !row;
  return (
    <span
      className={`block rounded-sm ${empty ? "usage-heatmap-empty" : ""}`}
      style={{
        aspectRatio: "1",
        alignSelf: "start",
        ...swatchStyle(level, mode),
      }}
      title={cellTitle(dateKey, row, mode, currency, currencyRate, lang)}
    />
  );
}

function swatchStyle(level: number, mode: ColorMode): React.CSSProperties {
  // Level 0 means "no record": the usage-heatmap-empty class paints the cell,
  // keeping it visually distinct from a recorded-but-tiny day (level 1).
  if (level === 0) return {};
  if (mode === "usage" || mode === "cost") {
    return {
      background: `color-mix(in srgb, var(--color-success) ${
        Number(VOLUME_ALPHA[level]) * 100
      }%, transparent)`,
    };
  }
  return {
    background: `color-mix(in srgb, var(${HIT_TOKEN[level]}) ${
      Number(HIT_ALPHA[level]) * 100
    }%, transparent)`,
  };
}

function cellTitle(
  dateKey: string,
  row: UsageDayRow | undefined,
  mode: ColorMode,
  currency: CurrencyCode,
  currencyRate: number | null,
  lang: string,
): string {
  if (!row) return dateKey;
  if (mode === "cost") {
    return `${dateKey} · ${formatCost(row.cost, currency, currencyRate, lang)} · ${row.calls} calls`;
  }
  if (mode === "hit") {
    return `${dateKey} · ${formatHitRate(row.hitRate)} · in ${compactNumber(row.input)} / cache ${compactNumber(row.cacheRead)}`;
  }
  return `${dateKey} · ${compactNumber(row.input + row.output + row.cacheRead)} tokens · ${row.calls} calls`;
}

function hitRateOf(rows: UsageDayRow[]): number | null {
  const input = rows.reduce((sum, r) => sum + r.input, 0);
  const cacheRead = rows.reduce((sum, r) => sum + r.cacheRead, 0);
  if (cacheRead === 0) return null;
  const total = input + cacheRead;
  return total > 0 ? (cacheRead / total) * 100 : null;
}

function totalCostOf(rows: UsageDayRow[]): number {
  return rows.reduce((sum, row) => sum + row.cost, 0);
}

function localDateKey(day: Date): string {
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthLabel(
  day: Date,
  columns: Array<Array<{ day: Date }>>,
  index: number,
  format: Intl.DateTimeFormat,
): string {
  if (day.getDate() > 7) return "";
  const previous = index > 0 ? columns[index - 1][0].day : null;
  if (previous && previous.getMonth() === day.getMonth()) return "";
  return format.format(day);
}
