import { DESKWAND_PROVIDER_PREFIX } from "../../shared/deskwand-provider";
import { resolveProviderDisplayName } from "./model-label";

/**
 * 子代理模型 spec 展示 — 剥离 deskwand: 前缀后用 providers 查可读名。
 * provider 名字走 resolveProviderDisplayName（云 provider 实时取 i18n），因此需要传 t。
 */
export function modelDisplay(
  raw: string,
  providers: Record<
    string,
    | { name?: string; models?: Array<{ id: string; label?: string }> }
    | undefined
  >,
  t: (key: string, opts?: { defaultValue: string }) => string,
): string {
  const slashIdx = raw.indexOf("/");
  if (slashIdx === -1) return raw;
  const rawProviderKey = raw.slice(0, slashIdx);
  const modelId = raw.slice(slashIdx + 1);
  let providerKey = rawProviderKey;
  if (providerKey.startsWith(DESKWAND_PROVIDER_PREFIX)) {
    providerKey = providerKey.slice(DESKWAND_PROVIDER_PREFIX.length);
  }
  const provider = providers[providerKey];
  const providerName =
    resolveProviderDisplayName(providerKey, provider?.name, t) || providerKey;
  const modelLabel =
    provider?.models?.find((m) => m.id === modelId)?.label || modelId;
  return `${providerName} / ${modelLabel}`;
}
