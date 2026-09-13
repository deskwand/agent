import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { UsageHourRow } from "../../../shared/usage";
import { bucketVolume, compactNumber } from "../../utils/usage-format";

const RAMP = ["0", "0.22", "0.42", "0.66", "1"];

export function UsageHourHeatmap({ records }: { records: UsageHourRow[] }) {
  const { t } = useTranslation();

  const { grid, values } = useMemo(() => {
    const g: UsageHourRow[][] = Array.from({ length: 7 }, (_, weekday) =>
      Array.from({ length: 24 }, (_, hour) => ({ weekday, hour, output: 0 })),
    );
    for (const record of records) {
      if (record.weekday < 0 || record.weekday > 6) continue;
      if (record.hour < 0 || record.hour > 23) continue;
      g[record.weekday][record.hour] = record;
    }
    return { grid: g, values: records.map((r) => r.output) };
  }, [records]);

  const labels = [
    t("usage.weekday.sun"),
    t("usage.weekday.mon"),
    t("usage.weekday.tue"),
    t("usage.weekday.wed"),
    t("usage.weekday.thu"),
    t("usage.weekday.fri"),
    t("usage.weekday.sat"),
  ];

  return (
    <div
      className="grid gap-0.5"
      style={{ gridTemplateColumns: "auto repeat(24, minmax(0, 1fr))" }}
    >
      {grid.map((row, weekday) => (
        <Fragment key={`row-${weekday}`}>
          <span className="pr-2 text-[9px] leading-3 text-text-muted">
            {labels[weekday]}
          </span>
          {row.map((cell) => {
            const level =
              cell.output > 0 ? bucketVolume(cell.output, values) : 0;
            return (
              <span
                key={`${cell.weekday}-${cell.hour}`}
                className={`block h-3 rounded-sm ${
                  level === 0 ? "usage-heatmap-empty" : ""
                }`}
                style={
                  level === 0
                    ? undefined
                    : {
                        background: `color-mix(in srgb, var(--color-success) ${
                          Number(RAMP[level]) * 100
                        }%, transparent)`,
                      }
                }
                title={`${labels[weekday]} ${String(cell.hour).padStart(2, "0")}:00 · ${compactNumber(cell.output)}`}
              />
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
