import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import {
  CloudApiClient,
  type PricingModel,
  type PricingResponse,
} from "../../services/cloud-api";

/** 费率是单价而非金额：直接渲染服务端下发的小数，最多 5 位、去掉尾随 0；缺失时不能渲染 $NaN */
function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  return `$${rate.toFixed(5).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/** 服务端下发 peak.days（ISO 周几）时按实际值说明，不能写死“周一至周五” */
function peakDaysLabel(days: number[] | null, t: (key: string) => string): string {
  if (!days || days.length === 0) return t("pricing.everyDay");
  if (days.length === 5 && days.every((d) => d >= 1 && d <= 5)) return t("pricing.weekdays");
  return days.join(", ");
}

function RateRow({
  label,
  official,
  charged,
}: {
  label: string;
  official: number;
  charged: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text-primary">
        {formatRate(official)}
        <span className="mx-1.5 text-text-muted">→</span>
        {formatRate(charged)}
      </span>
    </div>
  );
}

export function SettingsPricing({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const cloudConfig = useAppStore((s) => s.cloudConfig);
  const [data, setData] = useState<PricingResponse | null>(null);
  const [error, setError] = useState(false);

  const cloudApi = useMemo(
    () => (cloudConfig?.token ? new CloudApiClient(cloudConfig.token) : null),
    [cloudConfig?.token],
  );

  // 面板只是被 hidden，不会卸载：每次重新激活都要重取，否则 is_peak_now 永远停在第一次打开的时刻
  useEffect(() => {
    if (!isActive || !cloudApi) return;
    let cancelled = false;
    setError(false);
    cloudApi
      .getPricing()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isActive, cloudApi]);

  if (!cloudConfig?.isLoggedIn) {
    return <p className="text-sm text-text-muted">{t("pricing.loginRequired")}</p>;
  }
  if (error) {
    return <p className="text-sm text-text-muted">{t("pricing.loadFailed")}</p>;
  }
  if (!data) {
    return <p className="text-sm text-text-muted">{t("pricing.loading")}</p>;
  }

  const feePercent = `${Math.round(data.platform_fee_rate * 100)}%`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text-primary">
          {t("pricing.title")}
        </h2>
        <p className="text-sm text-text-muted">
          {t("pricing.subtitle", { fee: feePercent })}
        </p>
        <p className="text-xs text-text-muted">
          {t("pricing.legend", { fee: feePercent })}
        </p>
        <p className="mt-1 text-sm text-text-muted">
          {data.peak.is_peak_now ? t("pricing.peakNow") : t("pricing.offPeakNow")}
        </p>
        {data.peak.windows && data.peak.tz && (
          <p className="text-xs text-text-muted">
            {t("pricing.peakWindows", {
              windows: data.peak.windows.map(([s, e]) => `${s}-${e}`).join(", "),
              tz: data.peak.tz,
              days: peakDaysLabel(data.peak.days, t),
            })}
          </p>
        )}
      </div>

      {data.models.map((m: PricingModel) => (
        <div key={m.model_id} className="rounded-xl border border-border p-4">
          <h3 className="mb-2 text-sm font-medium text-text-primary">
            {m.model_id}
          </h3>
          <p className="mb-1 text-xs text-text-muted">{t("pricing.offPeak")}</p>
          <RateRow
            label={t("pricing.cacheHit")}
            official={m.official.off_peak.input_hit}
            charged={m.charged.off_peak.input_hit}
          />
          <RateRow
            label={t("pricing.cacheMiss")}
            official={m.official.off_peak.input_miss}
            charged={m.charged.off_peak.input_miss}
          />
          <RateRow
            label={t("pricing.output")}
            official={m.official.off_peak.output}
            charged={m.charged.off_peak.output}
          />
          {m.official.peak && m.charged.peak && (
            <>
              <p className="mb-1 mt-3 text-xs text-text-muted">
                {t("pricing.peak")}
              </p>
              <RateRow
                label={t("pricing.cacheHit")}
                official={m.official.peak.input_hit}
                charged={m.charged.peak.input_hit}
              />
              <RateRow
                label={t("pricing.cacheMiss")}
                official={m.official.peak.input_miss}
                charged={m.charged.peak.input_miss}
              />
              <RateRow
                label={t("pricing.output")}
                official={m.official.peak.output}
                charged={m.charged.peak.output}
              />
            </>
          )}
          <p className="mt-2 text-xs text-text-muted">{t("pricing.unit")}</p>
        </div>
      ))}
    </div>
  );
}
