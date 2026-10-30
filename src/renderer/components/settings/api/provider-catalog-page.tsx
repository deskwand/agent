import { ChevronLeft, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type LocalGatewayId,
  type LocalGatewayProbeState,
} from "../../../../shared/local-gateways";
import type { ProviderPresets, ProviderProfileKey } from "../../../types";
import { Button } from "../../app-button";
import { SettingsStatusBadge } from "../shared";
import { Input } from "../../ui/input";
import { ProviderBrandIcon } from "../provider-icons";
import {
  CATEGORY_I18N,
  PROVIDER_CATALOG,
  type ProviderCatalogEntry,
} from "../provider-catalog";
import {
  entryBrand,
  entryLabel,
  entryProfileKey,
  entrySubtitle,
} from "./provider-entry";

export interface ProviderCatalogPageProps {
  presets: ProviderPresets;
  configuredProfileKeys: ReadonlySet<string>;
  oauthStatuses: Record<string, { loggedIn: boolean }>;
  oauthLoading: Record<string, boolean>;
  oauthErrors: Record<string, string>;
  configuredLocalGateways: ReadonlySet<LocalGatewayId>;
  localGatewayStatus: Partial<Record<LocalGatewayId, LocalGatewayProbeState>>;
  onBack: () => void;
  /** provider / custom / cloud / plan 条目被选中 */
  onPickEntry: (entry: ProviderCatalogEntry) => void;
  onOAuthLogin: (providerId: string) => void;
  onOAuthDisconnect: (providerId: string) => void;
  onOpenLocalGateway: (id: LocalGatewayId) => void;
  /** 已配置的条目被点击：直接进详情，不重复创建 */
  onOpenConfigured: (profileKey: ProviderProfileKey) => void;
  /** 引导页精简集：只渲染 compact 条目并去掉分组标题 */
  compact?: boolean;
}

/** 搜索匹配：显示名 / 副标题 / id / 额外搜索词，任一命中即算。 */
export function matchCatalogEntry(
  entry: ProviderCatalogEntry,
  presets: ProviderPresets,
  t: (key: string) => string,
  needle: string,
): boolean {
  if (!needle) return true;
  const haystack = [
    entryLabel(entry, presets, t),
    entrySubtitle(entry, presets, t),
    entry.id,
    ...(entry.searchTerms ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/** 条目的副标题：已配置的 plan / local 额外补上角标。 */
function EntryTile({
  entry,
  presets,
  configuredProfileKeys,
  configuredLocalGateways,
  localGatewayStatus,
  oauthStatuses,
  oauthLoading,
  onPickEntry,
  onOAuthLogin,
  onOAuthDisconnect,
  onOpenLocalGateway,
  onOpenConfigured,
}: { entry: ProviderCatalogEntry } & Omit<
  ProviderCatalogPageProps,
  "presets" | "oauthErrors" | "onBack" | "compact" | "localGatewayStatus"
> & {
    localGatewayStatus: Partial<Record<LocalGatewayId, LocalGatewayProbeState>>;
    presets: ProviderPresets;
  }) {
  const { t } = useTranslation();
  const label = entryLabel(entry, presets, t);
  const subtitle = entrySubtitle(entry, presets, t);
  const localId = entry.kind === "local" ? (entry.id as LocalGatewayId) : null;
  const localStatus = localId ? localGatewayStatus[localId] : undefined;
  const profileKey = entryProfileKey(entry);
  const configured = localId
    ? configuredLocalGateways.has(localId)
    : entry.kind === "oauth"
      ? false
      : Boolean(profileKey && configuredProfileKeys.has(profileKey));
  const loggedIn =
    entry.kind === "oauth" ? Boolean(oauthStatuses[entry.id]?.loggedIn) : false;
  const busy = entry.kind === "oauth" ? Boolean(oauthLoading[entry.id]) : false;

  const badge = localId
    ? localStatus?.state === "probing"
      ? t("api.localGatewayProbing")
      : localStatus?.state === "available"
        ? typeof localStatus.modelCount === "number"
          ? t("api.localGatewayRunningWithCount", {
              count: localStatus.modelCount,
            })
          : t("api.localGatewayRunning")
        : localStatus?.state === "unavailable"
          ? t("api.localGatewayUnavailable")
          : undefined
    : busy
      ? t("api.oauthLoggingIn")
      : loggedIn
        ? t("api.catalogConnectedBadge")
        : configured
          ? t("api.catalogConfiguredBadge")
          : undefined;

  const tone: "ok" | "busy" | "muted" = localId
    ? localStatus?.state === "probing"
      ? "busy"
      : localStatus?.state === "available"
        ? "ok"
        : "muted"
    : busy
      ? "busy"
      : "ok";

  const onClick = () => {
    if (entry.kind === "oauth") {
      if (busy) return;
      if (loggedIn) onOAuthDisconnect(entry.id);
      else onOAuthLogin(entry.id);
      return;
    }
    if (localId) {
      onOpenLocalGateway(localId);
      return;
    }
    if (profileKey && configured) {
      onOpenConfigured(profileKey);
      return;
    }
    onPickEntry(entry);
  };

  return (
    <Button
      variant="ghost"
      type="button"
      data-catalog-entry={`${entry.kind}:${entry.id}`}
      data-testid={
        entry.kind === "oauth"
          ? `${entry.id}-oauth-connect`
          : entry.kind === "cloud"
            ? "connect-tile-cloud"
            : undefined
      }
      aria-label={badge ? `${label} — ${badge}` : label}
      disabled={busy}
      onClick={onClick}
      className={`flex h-auto min-w-0 items-center gap-2.5 rounded-container border border-border/60 bg-card px-2.5 py-2 text-left text-foreground hover:bg-hover-surface disabled:cursor-default disabled:opacity-60 ${
        configured || loggedIn ? "opacity-60" : ""
      }`}
    >
      <ProviderBrandIcon
        brand={entryBrand(entry)}
        className="h-4 w-4 flex-none"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{label}</span>
        {subtitle && (
          <span className="truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      {badge && (
        <span className="flex-none">
          <SettingsStatusBadge
            dotOnly
            tone={tone}
            label={badge}
            testId={localId ? `local-gateway-status-${localId}` : undefined}
          />
        </span>
      )}
    </Button>
  );
}

export function ProviderCatalogPage(props: ProviderCatalogPageProps) {
  const { t } = useTranslation();
  const [needle, setNeedle] = useState("");
  const normalized = needle.trim().toLowerCase();

  const groups = useMemo(() => {
    const source = props.compact
      ? PROVIDER_CATALOG.map((category) => ({
          ...category,
          entries: category.entries.filter((entry) => entry.compact),
        }))
      : PROVIDER_CATALOG;
    return source
      .map((category) => ({
        ...category,
        entries: category.entries.filter((entry) =>
          matchCatalogEntry(entry, props.presets, t, normalized),
        ),
      }))
      .filter((category) => category.entries.length > 0);
  }, [props.compact, props.presets, normalized, t]);

  const customEntry = useMemo(
    () =>
      PROVIDER_CATALOG.flatMap((category) => [...category.entries]).find(
        (entry) => entry.kind === "provider" && entry.id === "custom",
      ),
    [],
  );

  const tileProps = {
    presets: props.presets,
    configuredProfileKeys: props.configuredProfileKeys,
    configuredLocalGateways: props.configuredLocalGateways,
    localGatewayStatus: props.localGatewayStatus,
    oauthStatuses: props.oauthStatuses,
    oauthLoading: props.oauthLoading,
    onPickEntry: props.onPickEntry,
    onOAuthLogin: props.onOAuthLogin,
    onOAuthDisconnect: props.onOAuthDisconnect,
    onOpenLocalGateway: props.onOpenLocalGateway,
    onOpenConfigured: props.onOpenConfigured,
  };

  return (
    <div className="space-y-5">
      {!props.compact && (
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            type="button"
            data-testid="catalog-back"
            onClick={props.onBack}
            className="inline-flex h-auto items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-hover-surface hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t("api.navBack")}
          </Button>
          <div className="relative ml-auto w-full max-w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="catalog-search"
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              placeholder={t("api.catalogSearch")}
              className="h-auto w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>
        </div>
      )}

      {groups.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">
            {t("api.catalogNoResult", { query: needle })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("api.catalogNoResultHint")}
          </p>
          {customEntry && (
            <Button
              variant="ghost"
              type="button"
              data-testid="catalog-no-result-custom"
              onClick={() => props.onPickEntry(customEntry)}
              className="mt-4 h-auto rounded-lg border border-border/60 px-3 py-2 text-xs text-foreground hover:bg-hover-surface"
            >
              {t("api.catalogAddCustom")}
            </Button>
          )}
        </div>
      )}

      {groups.map((category) => (
        <section key={category.id} className="space-y-2">
          {!props.compact && (
            <div className="flex items-baseline gap-2 px-1">
              <h3 className="text-sm font-medium text-foreground">
                {t(CATEGORY_I18N[category.id].title)}
              </h3>
              <span className="text-xs text-muted-foreground">
                {t(CATEGORY_I18N[category.id].hint)}
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {category.entries.map((entry) => (
              <EntryTile
                key={`${entry.kind}:${entry.id}`}
                entry={entry}
                {...tileProps}
              />
            ))}
          </div>
        </section>
      ))}

      {Object.entries(props.oauthErrors).map(([id, message]) =>
        message ? (
          <p key={id} role="alert" className="text-xs text-destructive">
            {message}
          </p>
        ) : null,
      )}
    </div>
  );
}
