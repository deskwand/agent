import type {
  AppConfig,
  CustomProtocolType,
  ProviderProfileKey,
  ProviderType,
} from "../config/config-store";
import { configStore } from "../config/config-store";
import { runPiAiOneShot } from "../agent/agent-sdk-one-shot";
import { logWarn } from "../utils/logger";

export interface MemoryCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface MemoryCompletionResponse {
  text: string;
}

export interface MemoryLLMClientLike {
  complete(request: MemoryCompletionRequest): Promise<MemoryCompletionResponse>;
}

export interface ResolvedUtilityModelConfig {
  provider: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeoutMs: number;
  activeProviderKey: ProviderProfileKey;
}

export function resolveUtilityModelConfig(
  appConfig: AppConfig,
  fallbackModel: string,
): ResolvedUtilityModelConfig {
  const util = appConfig.utilityRuntime ?? {
    inheritFromActive: true,
    providerProfileKey: undefined,
    model: "",
    timeoutMs: 180000,
  };
  const inherit = util.inheritFromActive !== false;
  const timeoutMs = Math.max(5000, util.timeoutMs || 180000);

  if (inherit) {
    return {
      provider: appConfig.provider,
      customProtocol: appConfig.customProtocol,
      apiKey: appConfig.apiKey,
      baseUrl: appConfig.baseUrl,
      model: appConfig.model?.trim() || fallbackModel,
      timeoutMs,
      activeProviderKey: appConfig.activeProviderKey,
    };
  }

  const key = util.providerProfileKey;
  const profile = key ? appConfig.providers[key] : undefined;
  if (profile && key) {
    return {
      provider: profile.provider,
      customProtocol: profile.customProtocol,
      apiKey: profile.apiKey || "",
      baseUrl: profile.baseUrl,
      model: util.model?.trim() || profile.defaultModel || fallbackModel,
      timeoutMs,
      activeProviderKey: key,
    };
  }

  logWarn(
    "[UtilityModel] providerProfileKey not found, falling back to main model:",
    key,
  );
  return {
    provider: appConfig.provider,
    customProtocol: appConfig.customProtocol,
    apiKey: appConfig.apiKey,
    baseUrl: appConfig.baseUrl,
    model: appConfig.model?.trim() || fallbackModel,
    timeoutMs,
    activeProviderKey: appConfig.activeProviderKey,
  };
}

export function buildUtilityAppConfig(
  base: AppConfig,
  resolved: ResolvedUtilityModelConfig,
): AppConfig {
  return {
    ...base,
    provider: resolved.provider,
    customProtocol: resolved.customProtocol,
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    activeProviderKey: resolved.activeProviderKey,
  };
}

export class MemoryLLMClient implements MemoryLLMClientLike {
  constructor(
    private readonly getConfig: () => AppConfig = () => configStore.getAll(),
  ) {}

  async complete(
    request: MemoryCompletionRequest,
  ): Promise<MemoryCompletionResponse> {
    const appConfig = this.getConfig();
    const llmConfig = resolveUtilityModelConfig(appConfig, appConfig.model);
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(
            new Error(
              `Memory LLM request timed out after ${llmConfig.timeoutMs}ms`,
            ),
          );
        }, llmConfig.timeoutMs);
        timeout.unref?.();
      });
      const result = await Promise.race([
        runPiAiOneShot(
          request.userPrompt,
          request.systemPrompt,
          buildUtilityAppConfig(appConfig, llmConfig),
          {
            temperature: request.temperature ?? 0,
            maxTokens: request.maxTokens ?? 16_000,
            signal: controller.signal,
          },
        ),
        timeoutPromise,
      ]);
      return { text: result.text };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
