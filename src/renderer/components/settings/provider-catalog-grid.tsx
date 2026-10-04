import { useTranslation } from "react-i18next";
import { CODING_SUBSCRIPTIONS } from "../../../shared/coding-subscriptions";
import type { ProviderPresets, ProviderType } from "../../types";
import { Tooltip } from "../Tooltip";
import { SubscriptionPlanIcon } from "./coding-subscription-cards";
import { ProviderBrandIcon } from "./provider-icons";
import type { ProviderBrand } from "./provider-icons";
import {
  CATEGORY_I18N,
  OAUTH_PROVIDERS,
  PROVIDER_CATALOG,
  type ProviderCatalogEntry,
} from "./provider-catalog";
import { SettingsSection, SettingsStatusBadge } from "./shared";

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
}

/** 条目 → 网格显示名。provider 类取预设名，custom 走「其他供应商」。 */
export function entryLabel(
  entry: ProviderCatalogEntry,
  presets: ProviderPresets,
  t: (key: string) => string,
): string {
  if (entry.labelKey) return t(entry.labelKey);
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
                // 卡片没了以后，描述与注意事项改挂到瓦片的 tooltip 上，不让文案丢。
                const tooltip = oauthInfo
                  ? [
                      t(oauthInfo.descriptionKey),
                      oauthInfo.noteKey ? t(oauthInfo.noteKey) : "",
                    ]
                      .filter(Boolean)
                      .join(" — ")
                  : undefined;
                const loggedIn = isOauth
                  ? Boolean(oauthStatuses[entry.id]?.loggedIn)
                  : false;
                const busy = isOauth ? Boolean(oauthLoading[entry.id]) : false;
                const configured =
                  !isOauth &&
                  entry.id !== "custom" &&
                  configuredProfileKeys.has(entry.id);
                // 已登录的瓦片仍可点击 → 走断开确认。它是登出的唯一出口：
                // 已配置行可能已被删除，而 token 还在。
                const disabled = isOauth && busy;
                const badge = busy
                  ? t("api.oauthLoggingIn")
                  : loggedIn
                    ? t("api.catalogConnectedBadge")
                    : configured
                      ? t("api.catalogConfiguredBadge")
                      : undefined;

                const tile = (
                  <button
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
                      if (entry.kind === "plan") {
                        onCreatePlan();
                        return;
                      }
                      onCreateProvider(entry.id as ProviderType);
                    }}
                    className={`flex h-10 w-full min-w-0 items-center gap-2.5 rounded-control px-2.5 text-left text-sm text-text-primary ${
                      disabled
                        ? "cursor-default opacity-60"
                        : "hover:bg-surface-hover"
                    }`}
                  >
                    {entry.kind === "plan" ? (
                      <SubscriptionPlanIcon
                        profileKey={entry.id}
                        className="h-4 w-4 shrink-0 fill-none stroke-current text-text-secondary"
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
                          tone={busy ? "busy" : "ok"}
                          label={badge}
                        />
                      </span>
                    )}
                  </button>
                );

                // 仓库禁止 <button title>（title-attrs-migration 不变量）：
                // 操作提示走 Tooltip，且只在真的有文案时才包一层。
                return tooltip ? (
                  <Tooltip key={`${entry.kind}:${entry.id}`} label={tooltip}>
                    {tile}
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
                className="text-xs text-error"
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
