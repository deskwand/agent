/**
 * 目录条目 → 界面文案/图标/副标题。
 *
 * 从 provider-catalog-grid.tsx 抽出来的纯函数：目录页和引导页精简集
 * 都从这里取，避免两份文案漂移。
 */
import {
  CODING_SUBSCRIPTIONS,
  isCodingSubscriptionProfileKey,
} from "../../../../shared/coding-subscriptions";
import { getLocalGatewayPreset } from "../../../../shared/local-gateways";
import type {
  ApiProviderConfig,
  ProviderPresets,
  ProviderProfileKey,
  ProviderType,
} from "../../../types";
import type { ProviderBrand } from "../provider-icons";
import {
  OAUTH_PROVIDERS,
  type ProviderCatalogEntry,
} from "../provider-catalog";

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
  if (entry.kind === "cloud") return t("connect.rowDeskwand");
  if (entry.id === "custom") return t("api.otherProvider");
  const preset = (presets as unknown as Record<string, { name?: string }>)[
    entry.id
  ];
  return preset?.name ?? entry.id;
}

export function entryBrand(
  entry: ProviderCatalogEntry,
): ProviderBrand | ProviderType {
  if (entry.kind === "local") return "magpie";
  if (entry.kind === "cloud") return "custom";
  if (entry.kind === "oauth") {
    return OAUTH_PROVIDERS.find((p) => p.id === entry.id)?.brand ?? "custom";
  }
  if (entry.kind === "provider") return entry.id as ProviderType;
  return "custom";
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

export function entrySubtitle(
  entry: ProviderCatalogEntry,
  presets: ProviderPresets,
  t: (key: string) => string,
): string {
  if (entry.kind === "cloud") return t("api.catalogCloudSubtitle");
  if (entry.kind === "oauth") {
    const info = OAUTH_PROVIDERS.find((p) => p.id === entry.id);
    return info ? t(info.descriptionKey) : "";
  }
  if (entry.kind === "plan") return t("api.catalogPlanSubtitle");
  if (entry.kind === "local") {
    return getLocalGatewayPreset(entry.id)?.baseUrl ?? entry.id;
  }
  if (entry.id === "custom") return t("api.catalogCustomSubtitle");
  const preset = (presets as unknown as Record<string, { baseUrl?: string }>)[
    entry.id
  ];
  return hostOf(preset?.baseUrl) ?? entry.id;
}

export function entryKeyUrl(entry: ProviderCatalogEntry): string | undefined {
  return entry.keyUrl;
}

export function entryProfileKey(
  entry: ProviderCatalogEntry,
): ProviderProfileKey | undefined {
  if (entry.kind === "cloud") return "custom:deskwand";
  if (entry.kind === "provider" || entry.kind === "plan") {
    return entry.id as ProviderProfileKey;
  }
  return undefined;
}

/**
 * 已存配置 → 目录条目。详情页拿它去喂同一个凭证表单，
 * 避免为「编辑态」再造一套 props。
 */
export function entryForProfile(
  profileKey: ProviderProfileKey,
  config: ApiProviderConfig,
): ProviderCatalogEntry {
  if (config.localGateway) return { kind: "local", id: config.localGateway };
  if (config.provider === "oauth") {
    const providerId = profileKey.startsWith("oauth:")
      ? profileKey.slice("oauth:".length)
      : profileKey;
    return { kind: "oauth", id: providerId };
  }
  if (profileKey === "custom:deskwand") {
    return { kind: "cloud", id: "deskwand" };
  }
  if (isCodingSubscriptionProfileKey(profileKey)) {
    return { kind: "plan", id: profileKey };
  }
  return { kind: "provider", id: config.provider };
}
