import { useTranslation } from "react-i18next";
import type {
  ApiProviderConfig,
  ProviderPresets,
  ProviderType,
} from "../../types";
import {
  ProviderBrandIcon,
  resolveProviderBrand,
  type ProviderBrand,
} from "./provider-icons";
import { OAUTH_PROVIDERS } from "./provider-catalog";
import { SettingsCard, SettingsRow } from "./shared";

export interface ConfiguredProviderRow {
  profileKey: string;
  config: ApiProviderConfig;
}

export interface ConfiguredProviderListProps {
  rows: ConfiguredProviderRow[];
  presets: ProviderPresets;
  oauthStatuses: Record<string, { loggedIn: boolean; providerName: string }>;
  onEdit: (profileKey: string) => void;
  onDelete: (profileKey: string) => void;
  onDisconnect: (providerId: string) => void;
}

/**
 * 只有 OpenRouter 的登录写裸 profile key，其余登录都写 `oauth:<id>`
 * （见 services/connect-provider.ts）。所以白名单只有它：否则一个用 API Key
 * 配的 `anthropic` profile 会被当成 OAuth 行，登出按钮也会与 `oauth:anthropic` 撞。
 */
const BARE_OAUTH_PROFILE_KEYS = new Set(["openrouter"]);

/** 行对应的 OAuth provider id；不是登录写入的 profile 就返回 undefined。 */
export function oauthProviderIdForProfile(
  profileKey: string,
): string | undefined {
  if (profileKey.startsWith("oauth:")) return profileKey.slice("oauth:".length);
  return BARE_OAUTH_PROFILE_KEYS.has(profileKey) ? profileKey : undefined;
}

/**
 * 行的品牌图标。
 *
 * oauth profile 存的 `config.provider` 是合成值 `"oauth"`，它既不在预设表里、
 * 也不在 BRAND_SPECS 里，直接送进 resolveProviderBrand 只会拿到 undefined，
 * 整行就渲染成 Server 占位图。品牌只能从目录的 OAuth 条目取 —— 网格瓦片
 * 走的是同一条路（entryBrand），两处必须一致。
 */
export function rowBrand(
  profileKey: string,
  config: ApiProviderConfig,
): ProviderBrand | ProviderType {
  // 应用自己的云端 profile 不是品牌供应商；它的 customProtocol 是 openai，
  // 不挡住的话会套上 OpenAI 的标。它今天被 configuredProviders 筛掉了，
  // 这里显式挡住，免得哪天被放进来时静默画错。
  if (profileKey === "custom:deskwand") return "custom";
  const oauthId = oauthProviderIdForProfile(profileKey);
  const oauthEntry = oauthId
    ? OAUTH_PROVIDERS.find((p) => p.id === oauthId)
    : undefined;
  if (oauthEntry) return oauthEntry.brand;
  return (
    resolveProviderBrand(config.provider, config.customProtocol) ?? "custom"
  );
}

function hostOf(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).host;
  } catch {
    return undefined;
  }
}

export function ConfiguredProviderList({
  rows,
  presets,
  oauthStatuses,
  onEdit,
  onDelete,
  onDisconnect,
}: ConfiguredProviderListProps) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;

  return (
    <SettingsCard>
      {rows.map(({ profileKey, config }) => {
        const oauthId = oauthProviderIdForProfile(profileKey);
        const status = oauthId ? oauthStatuses[oauthId] : undefined;
        const modelCount = config.models?.length ?? 0;
        const oauthProvider = oauthId
          ? OAUTH_PROVIDERS.find((p) => p.id === oauthId)
          : undefined;
        const displayName =
          config.name ||
          // oauth profile 的 provider 是 "oauth"，预设表里没有它，
          // 名字只能从目录取；否则 config.name 为空时会显示成 "oauth"。
          oauthProvider?.name ||
          (config.provider === "custom"
            ? t("api.otherProvider")
            : (presets as unknown as Record<string, { name?: string }>)[
                config.provider
              ]?.name) ||
          config.provider;
        const source = hostOf(config.baseUrl) || displayName;
        const subtitle = status?.loggedIn
          ? t("api.rowSubtitleOauth", { models: modelCount })
          : t("api.rowSubtitle", { source, models: modelCount });

        return (
          <SettingsRow
            key={profileKey}
            testId={`configured-provider-${profileKey}`}
            icon={
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-surface-muted">
                <ProviderBrandIcon
                  brand={rowBrand(profileKey, config)}
                  className="h-5 w-5"
                />
              </span>
            }
            title={displayName}
            description={subtitle}
            control={
              <>
                {status?.loggedIn && oauthId && (
                  <button
                    type="button"
                    data-testid={`${oauthId}-oauth-disconnect`}
                    onClick={() => onDisconnect(oauthId)}
                    className="rounded-lg border border-border-muted px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  >
                    {t("api.oauthDisconnect")}
                  </button>
                )}
                <button
                  type="button"
                  data-testid={`${profileKey}-edit`}
                  onClick={() => onEdit(profileKey)}
                  className="rounded-lg border border-border-muted px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                >
                  {t("api.editApi")}
                </button>
                <button
                  type="button"
                  data-testid={`${profileKey}-delete`}
                  onClick={() => onDelete(profileKey)}
                  className="rounded-lg border border-border-muted px-2.5 py-1.5 text-xs text-text-secondary hover:bg-error/10 hover:text-error"
                >
                  {t("api.deleteApi")}
                </button>
              </>
            }
          />
        );
      })}
    </SettingsCard>
  );
}
