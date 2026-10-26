import { useTranslation } from "react-i18next";
import { CODING_SUBSCRIPTIONS } from "../../../shared/coding-subscriptions";
import {
  getLocalGatewayPreset,
  type LocalGatewayId,
  type LocalGatewayProbeState,
} from "../../../shared/local-gateways";
import type { ProviderPresets, ProviderType } from "../../types";
import { Tooltip, TooltipContent, TooltipTrigger } from "../app-tooltip";
import { SubscriptionPlanIcon } from "./coding-subscription-cards";
import { ProviderBrandIcon } from "./provider-icons";
import type { ProviderBrand } from "./provider-icons";
import {
  CATEGORY_I18N,
  OAUTH_PROVIDERS,
  PROVIDER_CATALOG,
  type ProviderCatalogEntry,
} from "./provider-catalog";
import {
  SettingsSection,
  SettingsStatusBadge,
  type StatusBadgeTone,
} from "./shared";
import { Button } from "../app-button";

export interface ProviderCatalogGridProps {
  presets: ProviderPresets;
  /** 已配置列表里出现的 profile key 集合 */
  configuredProfileKeys: ReadonlySet<string>;
  oauthStatuses: Record<string, { loggedIn: boolean }>;
  oauthLoading: Record<string, boolean>;
  oauthErrors: Record<string, string>;
  onCreateProvider: (provider: ProviderType) => void;
  onCreatePlan: () => void;
  onOAuthLogin: (providerId: string) => void;
  onOAuthDisconnect: (providerId: string) => void;
  /** 已配置且可用的本机网关 */
  configuredLocalGateways?: ReadonlySet<LocalGatewayId>;
  localGatewayStatus?: Partial<Record<LocalGatewayId, LocalGatewayProbeState>>;
  onOpenLocalGateway?: (id: LocalGatewayId) => void;
}

/** 条目 → 网格显示名。provider 类取预设名，custom 走「其他供应商」。 */
export function entryLabel(
  entry: ProviderCatalogEntry,
  presets: ProviderPresets,
  t: (key: string) => string,
): string {
  if (entry.labelKey) return t(entry.labelKey);
  if (entry.kind === "local") {
    return getLocalGatewayPreset(entry.id)?.name ?? entry.id;
  }
  if (entry.kind === "oauth") {
    return OAUTH_PROVIDERS.find((p) => p.id === entry.id)?.name ?? entry.id;
  }
  if (entry.kind === "plan") {
    return (
      CODING_SUBSCRIPTIONS.find((p) => p.profileKey === entry.id)?.name ??
      entry.id
    );
  }
  if (entry.id === "custom") return t("api.otherProvider");
  const preset = (presets as unknown as Record<string, { name?: string }>)[
    entry.id
  ];
  return preset?.name ?? entry.id;
}

function entryBrand(entry: ProviderCatalogEntry): ProviderBrand | ProviderType {
  if (entry.kind === "local") return "magpie";
  if (entry.kind === "oauth") {
    return OAUTH_PROVIDERS.find((p) => p.id === entry.id)?.brand ?? "custom";
  }
  if (entry.kind === "provider") return entry.id as ProviderType;
  return "custom";
}

export function ProviderCatalogGrid({
  presets,
  configuredProfileKeys,
  oauthStatuses,
  oauthLoading,
  oauthErrors,
  onCreateProvider,
  onCreatePlan,
  onOAuthLogin,
  onOAuthDisconnect,
  configuredLocalGateways = new Set<LocalGatewayId>(),
  localGatewayStatus = {},
  onOpenLocalGateway,
}: ProviderCatalogGridProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {PROVIDER_CATALOG.map((category) => {
        const copy = CATEGORY_I18N[category.id];
        const errors =
          category.id === "subscription"
            ? category.entries
                .map((entry) => oauthErrors[entry.id])
                .filter((message): message is string => Boolean(message))
            : [];

        return (
          <SettingsSection
            key={category.id}
            inlineHint
            title={t(copy.title)}
            description={t(copy.hint)}
          >
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {category.entries.map((entry) => {
                const label = entryLabel(entry, presets, t);
                const isOauth = entry.kind === "oauth";
                const oauthInfo = isOauth
                  ? OAUTH_PROVIDERS.find((p) => p.id === entry.id)
                  : undefined;
                const isLocal = entry.kind === "local";
                const localId = isLocal
                  ? (entry.id as LocalGatewayId)
                  : undefined;
                const localStatus = localId
                  ? localGatewayStatus[localId]
                  : undefined;
                const localStatusLabel = isLocal
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
                  : undefined;
                const configured = localId
                  ? configuredLocalGateways.has(localId)
                  : !isOauth &&
                    entry.id !== "custom" &&
                    configuredProfileKeys.has(entry.id);
                const localBadge = localId
                  ? [
                      localStatusLabel,
                      configured ? t("api.catalogConfiguredBadge") : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  : undefined;
                // 卡片没了以后，描述与注意事项改挂到瓦片的 tooltip 上，不让文案丢。
                const tooltip = oauthInfo
                  ? [
                      t(oauthInfo.descriptionKey),
                      oauthInfo.noteKey ? t(oauthInfo.noteKey) : "",
                    ]
                      .filter(Boolean)
                      .join(" — ")
                  : isLocal
                    ? localBadge
                    : undefined;
                const loggedIn = isOauth
                  ? Boolean(oauthStatuses[entry.id]?.loggedIn)
                  : false;
                const busy = isOauth ? Boolean(oauthLoading[entry.id]) : false;
                // 已登录的瓦片仍可点击 → 走断开确认。它是登出的唯一出口：
                // 已配置行可能已被删除，而 token 还在。
                const disabled = isOauth && busy;
                const badge = isLocal
                  ? localBadge
                  : busy
                    ? t("api.oauthLoggingIn")
                    : loggedIn
                      ? t("api.catalogConnectedBadge")
                      : configured
                        ? t("api.catalogConfiguredBadge")
                        : undefined;
                const badgeTone: StatusBadgeTone = isLocal
                  ? localStatus?.state === "probing"
                    ? "busy"
                    : localStatus?.state === "available"
                      ? "ok"
                      : "muted"
                  : busy
                    ? "busy"
                    : "ok";

                const tile = (
                  <Button
                    variant="ghost"
                    key={`${entry.kind}:${entry.id}`}
                    type="button"
                    data-catalog-entry={`${entry.kind}:${entry.id}`}
                    data-testid={
                      isOauth ? `${entry.id}-oauth-connect` : undefined
                    }
                    aria-label={badge ? `${label} — ${badge}` : label}
                    disabled={disabled}
                    onClick={() => {
                      if (isOauth) {
                        if (busy) return;
                        if (loggedIn) onOAuthDisconnect(entry.id);
                        else onOAuthLogin(entry.id);
                        return;
                      }
                      if (entry.kind === "local") {
                        if (localId) onOpenLocalGateway?.(localId);
                        return;
                      }
                      if (entry.kind === "plan") {
                        onCreatePlan();
                        return;
                      }
                      onCreateProvider(entry.id as ProviderType);
                    }}
                    className={`flex h-10 w-full min-w-0 items-center gap-2.5 rounded-control px-2.5 text-left text-sm text-foreground ${
                      disabled
                        ? "cursor-default opacity-60"
                        : "hover:bg-hover-surface"
                    }`}
                  >
                    {entry.kind === "plan" ? (
                      <SubscriptionPlanIcon
                        profileKey={entry.id}
                        className="h-4 w-4 shrink-0 fill-none stroke-current text-muted-foreground"
                      />
                    ) : (
                      <ProviderBrandIcon
                        brand={entryBrand(entry)}
                        className="h-4 w-4 flex-none"
                      />
                    )}
                    <span className="truncate">{label}</span>
                    {badge && (
                      <span className="ml-auto flex-none">
                        <SettingsStatusBadge
                          dotOnly
                          tone={badgeTone}
                          label={badge}
                          testId={
                            localId
                              ? `local-gateway-status-${localId}`
                              : undefined
                          }
                        />
                      </span>
                    )}
                  </Button>
                );

                // 仓库禁止 <Button variant="ghost" title>（title-attrs-migration 不变量）：
                // 操作提示走 Tooltip，且只在真的有文案时才包一层。
                return tooltip ? (
                  <Tooltip key={`${entry.kind}:${entry.id}`}>
                    <TooltipTrigger asChild>{tile}</TooltipTrigger>
                    {/* side 必须显式给 bottom：vendored TooltipContent 的 Radix 默认是 top，
                        而老 Tooltip 的 placement 默认是下方 —— 不写会把气泡挪到按钮上方。 */}
                    <TooltipContent side="bottom">{tooltip}</TooltipContent>
                  </Tooltip>
                ) : (
                  tile
                );
              })}
            </div>
            {errors.map((message, index) => (
              <p
                key={`${category.id}-error-${index}`}
                role="alert"
                className="text-xs text-destructive"
              >
                {message}
              </p>
            ))}
          </SettingsSection>
        );
      })}
    </div>
  );
}
