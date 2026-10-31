/**
 * 视觉模型可以引用一条已配置供应商（providerProfileKey），凭证以那条为准。
 *
 * 三条规则（都有用例）：
 *  1. 引用命中 → 用 profile 的 provider / customProtocol / baseUrl / apiKey 覆盖；
 *     model 仍由视觉模型自己决定（正是「复用凭证、不复用模型」的语义）。
 *  2. 引用失效（profile 被删）→ 清掉引用，保留自包含字段。绝不静默清空用户填的 key。
 *  3. 没有引用 → 原样返回，老配置零迁移。
 */
import type {
  SharedCustomProtocolType,
  VisionModelConfig,
} from "../../shared/api-model-presets";
import type { ApiProviderConfig } from "../../renderer/types";

export function normalizeVisionModelConfig<T extends VisionModelConfig>(
  config: T,
  providers: Partial<Record<string, ApiProviderConfig>>,
): T {
  const key = config.providerProfileKey;
  if (!key) return config;
  const profile = providers[key];
  if (!profile) {
    // 引用失效：只清引用，别的字段一个不动
    const rest = { ...config };
    delete rest.providerProfileKey;
    return rest as T;
  }
  return {
    ...config,
    provider: profile.provider as T["provider"],
    customProtocol: (profile.customProtocol ?? config.customProtocol) as
      | SharedCustomProtocolType
      | undefined,
    baseUrl: profile.baseUrl ?? config.baseUrl,
    apiKey: profile.apiKey,
  };
}
