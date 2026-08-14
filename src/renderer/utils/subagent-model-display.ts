import { DESKWAND_PROVIDER_PREFIX } from "../../shared/deskwand-provider";

/**
 * 子代理模型 spec 展示 — 剥离 deskwand: 前缀后用 providers 查可读名。
 */
export function modelDisplay(
  raw: string,
  providers: Record<
    string,
    | { name?: string; models?: Array<{ id: string; label?: string }> }
    | undefined
  >,
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
  const providerName = provider?.name || providerKey;
  const modelLabel =
    provider?.models?.find((m) => m.id === modelId)?.label || modelId;
  return `${providerName} / ${modelLabel}`;
}
