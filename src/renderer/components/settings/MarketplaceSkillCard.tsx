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
import { Button } from "../app-button";

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
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg flex items-center justify-center shrink-0 bg-primary/10 text-primary-text w-12 h-12">
          <Package className="w-6 h-6" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-base font-semibold text-foreground truncate">
              {skill.name}
            </h3>
            {skill.verified ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success shrink-0">
                {t("skillMarket.verified")}
              </span>
            ) : null}
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
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
                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                >
                  {i18n.language === "en" && sc.name_en ? sc.name_en : sc.name}
                </span>
              ))}
            </div>
          ) : null}
          <p className="selectable text-sm text-muted-foreground line-clamp-2 mb-2">
            {desc}
          </p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {skill.installs.toLocaleString("en-US")}
            </span>
            <span>v{skill.version}</span>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <Button variant="ghost"
          onClick={onViewDetail}
          className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:bg-accent transition-colors h-auto"
        >
          {t("skillMarket.viewDetail")}
        </Button>
        {installState === "installing" ? (
          <Button variant="ghost"
            disabled
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary-text/50 h-auto hover:bg-transparent hover:text-current"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
          </Button>
        ) : installState === "installed" ? (
          <Button variant="ghost"
            disabled
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-success/10 text-success h-auto hover:bg-transparent hover:text-current"
          >
            <Check className="w-3 h-3" />
            {t("skillMarket.installedTip")}
          </Button>
        ) : installState === "has_update" ? (
          <Button variant="ghost"
            onClick={onInstall}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary-text hover:bg-primary/20 transition-colors h-auto"
          >
            <RefreshCw className="w-3 h-3" />
            {t("skillMarket.updateAvailable")}
          </Button>
        ) : (
          <Button variant="ghost"
            onClick={onInstall}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary-text hover:bg-primary/20 transition-colors h-auto"
          >
            <Download className="w-3 h-3" />
            {t("skillMarket.install")}
          </Button>
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
    <div className="rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="rounded-lg flex items-center justify-center shrink-0 bg-primary/10 text-primary-text w-9 h-9">
            <Package className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground truncate">
                {skill.name}
              </span>
              {skill.verified ? (
                <span className="text-[9px] px-1 py-0.5 rounded bg-success/10 text-success shrink-0">
                  {t("skillMarket.verified")}
                </span>
              ) : null}
              <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0 whitespace-nowrap">
                v{skill.version}
              </span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-1">{desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="ghost"
            onClick={onViewDetail}
            className="px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors h-auto"
          >
            {t("skillMarket.viewDetail")}
          </Button>
          {installState === "installing" ? (
            <span className="p-1 text-primary-text/50">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            </span>
          ) : installState === "installed" ? (
            <span className="flex items-center gap-1 text-[11px] text-success">
              <Check className="w-3 h-3" />
              {t("skillMarket.installedTip")}
            </span>
          ) : installState === "has_update" ? (
            <Button variant="ghost"
              onClick={onInstall}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-primary/10 text-primary-text hover:bg-primary/20 transition-colors h-auto"
            >
              <RefreshCw className="w-3 h-3" />
              {t("skillMarket.updateAvailable")}
            </Button>
          ) : (
            <Button variant="ghost"
              onClick={onInstall}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-primary/10 text-primary-text hover:bg-primary/20 transition-colors h-auto"
            >
              <Download className="w-3 h-3" />
              {t("skillMarket.install")}
            </Button>
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
