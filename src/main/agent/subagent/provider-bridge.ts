/**
 * Provider Profile Bridge — 将 DeskWand 设置页 Provider Profile
 * 注册为独立命名空间 `deskwand:<profileKey>`，确保凭证隔离。
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { getSharedAuthStorage } from "../shared-auth";
import { modelResolutionService } from "../../model/model-resolution-service";
import { configStore, type AppConfig } from "../../config/config-store";
import { log, logWarn } from "../../utils/logger";

const DESKWAND_PROVIDER_PREFIX = "deskwand:";

/**
 * 构建设置页 Provider Profile 的独立 Pi Provider ID。
 * 例如 "main-openai" → "deskwand:main-openai"
 */
export function buildDeskWandProviderId(profileKey: string): string {
  return `${DESKWAND_PROVIDER_PREFIX}${profileKey}`;
}

/**
 * 解析 Pi Provider ID 是否为 DeskWand Profile。
 */
export function parseDeskWandProviderId(
  provider: string,
): { isDeskwand: true; profileKey: string } | { isDeskwand: false } {
  if (!provider.startsWith(DESKWAND_PROVIDER_PREFIX)) {
    return { isDeskwand: false };
  }
  const profileKey = provider.slice(DESKWAND_PROVIDER_PREFIX.length);
  if (!profileKey) return { isDeskwand: false };
  return { isDeskwand: true, profileKey };
}

/**
 * 构造完整的 DeskWand 模型标识符。
 * 例如 ("openai-work", "gpt-5") → "deskwand:openai-work/gpt-5"
 */
export function buildDeskWandModelId(
  profileKey: string,
  modelId: string,
): string {
  return `${buildDeskWandProviderId(profileKey)}/${modelId}`;
}

interface ResolvedProviderEntry {
  providerId: string;
  baseUrl?: string;
  apiKey?: string;
  models: Array<{
    id: string;
    name: string;
    api: string;
    baseUrl?: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
    contextWindow: number;
    maxTokens: number;
  }>;
}

/**
 * 为单个 Provider Profile 解析模型列表与凭证。
 * 返回 undefined 表示该 Profile 不可用（跳过，不阻塞其他 Profile 注册）。
 */
async function resolveProfileEntry(
  profileKey: string,
  appConfig: AppConfig,
): Promise<ResolvedProviderEntry | undefined> {
  const profile = appConfig.providers[profileKey];
  if (!profile) return undefined;

  try {
    const resolved = await modelResolutionService.resolve({
      sessionProviderProfileKey: profileKey as Parameters<
        typeof modelResolutionService.resolve
      >[0]["sessionProviderProfileKey"],
      sessionModel: profile.defaultModel,
      appConfig,
    });

    // OAuth providers may not have a baseUrl in the resolved config.
    // Use the piModel's native baseUrl as fallback.
    const effectiveBaseUrl =
      resolved.baseUrl || resolved.piModel.baseUrl || undefined;
    if (!effectiveBaseUrl) {
      logWarn(
        `[SubagentProviderBridge] Skipping ${profileKey}: no baseUrl available`,
      );
      return undefined;
    }

    const providerId = buildDeskWandProviderId(profileKey);

    const models = profile.models.map((m) => ({
      id: m.id,
      name: m.label || m.id,
      api: resolved.piModel.api as string,
      baseUrl: effectiveBaseUrl,
      reasoning: false,
      input: resolved.piModel.input as ("text" | "image")[],
      cost: resolved.piModel.cost,
      contextWindow: m.contextWindow || resolved.contextWindow,
      maxTokens: m.maxTokens || resolved.maxTokens,
    }));

    return {
      providerId,
      baseUrl: effectiveBaseUrl,
      apiKey: resolved.apiKey,
      models,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn(
      `[SubagentProviderBridge] Failed to resolve profile ${profileKey}: ${message}`,
    );
    return undefined;
  }
}

/**
 * 将所有已配置且可用的 Provider Profile 注册到 Model Registry。
 * 每个 Profile 获得独立命名空间，凭证和 Endpoint 互不污染。
 */
export async function registerDeskWandProviders(
  registry: ModelRegistry,
  appConfig: AppConfig = configStore.getAll(),
): Promise<void> {
  const authStorage = getSharedAuthStorage();
  let registered = 0;

  for (const rawKey of Object.keys(appConfig.providers)) {
    const profileKey = rawKey;
    const entry = await resolveProfileEntry(profileKey, appConfig);
    if (!entry) continue;

    const { providerId, baseUrl, apiKey, models } = entry;

    registry.registerProvider(providerId, {
      name: profileKey,
      baseUrl,
      apiKey,
      models,
    });

    if (apiKey) {
      authStorage.setRuntimeApiKey(providerId, apiKey);
    }

    registered++;
    log(
      `[SubagentProviderBridge] Registered ${providerId} with ${models.length} models`,
    );
  }

  log(`[SubagentProviderBridge] Registered ${registered} provider(s)`);
}

/**
 * 根据模型规范（"deskwand:<profileKey>/<modelId>" 或 "provider/model"）
 * 从 registry 精确查找 Model。找不到返回 undefined，不模糊匹配。
 */
export function resolveDeskWandModel(
  modelSpec: string,
  registry: ModelRegistry,
): Model<any> | undefined {
  const trimmed = modelSpec.trim();
  if (!trimmed) return undefined;

  const slashIdx = trimmed.indexOf("/");
  if (slashIdx === -1) return undefined;

  const provider = trimmed.slice(0, slashIdx);
  const modelId = trimmed.slice(slashIdx + 1);

  return registry.find(provider, modelId) as Model<any> | undefined;
}
