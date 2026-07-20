import { useTranslation } from "react-i18next";
import {
  Download,
  Loader2,
  Check,
  RefreshCw,
  Package,
  Users,
} from "lucide-react";
import type { MarketplaceSkill } from "../../types";

export type MarketplaceInstallState =
  | "available"
  | "installing"
  | "installed"
  | "has_update";

export interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill;
  installState: MarketplaceInstallState;
  onInstall: () => void;
  onViewDetail: () => void;
  viewMode: "cards" | "list";
}

function MarketplaceCardView({
  skill,
  installState,
  onInstall,
  onViewDetail,
}: MarketplaceSkillCardProps) {
  const { t, i18n } = useTranslation();
  const desc =
    i18n.language === "zh" && skill.description_zh
      ? skill.description_zh
      : skill.description;

  return (
    <div className="rounded-lg border border-border-primary p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg flex items-center justify-center shrink-0 bg-accent/10 text-accent w-12 h-12">
          <Package className="w-6 h-6" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-base font-semibold text-text-primary truncate">
              {skill.name}
            </h3>
            {skill.verified ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success shrink-0">
                {t("skillMarket.verified")}
              </span>
            ) : null}
            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-muted text-text-muted shrink-0">
              {i18n.language === "en" && skill.category_name_en
                ? skill.category_name_en
                : skill.category_name}
            </span>
          </div>
          {skill.sub_categories.length > 0 ? (
            <div className="flex gap-1.5 mb-1.5 flex-wrap">
              {skill.sub_categories.map((sc) => (
                <span
                  key={sc.key}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface-muted text-text-muted"
                >
                  {i18n.language === "en" && sc.name_en ? sc.name_en : sc.name}
                </span>
              ))}
            </div>
          ) : null}
          <p className="text-sm text-text-secondary line-clamp-2 mb-2">
            {desc}
          </p>
          <div className="flex gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {skill.installs.toLocaleString("en-US")}
            </span>
            <span>v{skill.version}</span>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={onViewDetail}
          className="px-2.5 py-1 rounded-md text-xs font-medium bg-surface-muted text-text-secondary hover:bg-surface-hover transition-colors"
        >
          {t("skillMarket.viewDetail")}
        </button>
        {installState === "installing" ? (
          <button
            disabled
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent/50"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
          </button>
        ) : installState === "installed" ? (
          <button
            disabled
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-success/10 text-success"
          >
            <Check className="w-3 h-3" />
            {t("skillMarket.installedTip")}
          </button>
        ) : installState === "has_update" ? (
          <button
            onClick={onInstall}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {t("skillMarket.updateAvailable")}
          </button>
        ) : (
          <button
            onClick={onInstall}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            <Download className="w-3 h-3" />
            {t("skillMarket.install")}
          </button>
        )}
      </div>
    </div>
  );
}

function MarketplaceListView({
  skill,
  installState,
  onInstall,
  onViewDetail,
}: MarketplaceSkillCardProps) {
  const { t, i18n } = useTranslation();
  const desc =
    i18n.language === "zh" && skill.description_zh
      ? skill.description_zh
      : skill.description;

  return (
    <div className="rounded-lg border border-border-primary p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="rounded-lg flex items-center justify-center shrink-0 bg-accent/10 text-accent w-9 h-9">
            <Package className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-text-primary truncate">
                {skill.name}
              </span>
              {skill.verified ? (
                <span className="text-[9px] px-1 py-0.5 rounded bg-success/10 text-success shrink-0">
                  {t("skillMarket.verified")}
                </span>
              ) : null}
              <span className="text-[10px] px-1 py-0.5 rounded bg-surface-muted text-text-muted shrink-0 whitespace-nowrap">
                v{skill.version}
              </span>
            </div>
            <p className="text-xs text-text-muted line-clamp-1">{desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onViewDetail}
            className="px-2 py-1 rounded-md text-[11px] text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            {t("skillMarket.viewDetail")}
          </button>
          {installState === "installing" ? (
            <span className="p-1 text-accent/50">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            </span>
          ) : installState === "installed" ? (
            <span className="flex items-center gap-1 text-[11px] text-success">
              <Check className="w-3 h-3" />
              {t("skillMarket.installedTip")}
            </span>
          ) : installState === "has_update" ? (
            <button
              onClick={onInstall}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              {t("skillMarket.updateAvailable")}
            </button>
          ) : (
            <button
              onClick={onInstall}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              <Download className="w-3 h-3" />
              {t("skillMarket.install")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MarketplaceSkillCard(props: MarketplaceSkillCardProps) {
  if (props.viewMode === "cards") return <MarketplaceCardView {...props} />;
  return <MarketplaceListView {...props} />;
}
