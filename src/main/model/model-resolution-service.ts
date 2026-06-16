import type { Api, Model } from "@earendil-works/pi-ai";
import { normalizeOpenAICompatibleBaseUrl } from "../config/auth-utils";
import type {
  AppConfig,
  ApiProviderConfig,
  ApiProviderModel,
  CustomProtocolType,
  ProviderProfileKey,
  ProviderType,
} from "../config/config-store";
import { fetchOllamaModelInfo } from "../config/ollama-api";
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
  resolvePiModelString,
  resolvePiRegistryModel,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from "../agent/pi-model-resolution";

export interface ResolveModelInput {
  sessionProviderProfileKey?: ProviderProfileKey;
  sessionModel?: string;
  appConfig: AppConfig;
}

export interface ModelResolutionTrace {
  providerSource: "session" | "activeProvider";
  modelSource:
    | "session"
    | "provider.defaultModel"
    | "global.model"
    | "fallback";
  piModelSource: "registry" | "synthetic";
  notes: string[];
}

export interface ResolvedModelRuntime {
  providerProfileKey: ProviderProfileKey;
  providerType: ProviderType;
  customProtocol: CustomProtocolType;
  protocol: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  contextWindow: number;
  maxTokens: number;
  piModel: Model<Api>;
  trace: ModelResolutionTrace;
}

function getProviderConfig(
  appConfig: AppConfig,
  sessionProviderProfileKey?: ProviderProfileKey,
): {
  providerProfileKey: ProviderProfileKey;
  providerConfig: ApiProviderConfig;
  providerSource: ModelResolutionTrace["providerSource"];
  notes: string[];
} {
  const notes: string[] = [];
  const requestedProvider = sessionProviderProfileKey?.trim() as
    | ProviderProfileKey
    | undefined;
  if (requestedProvider && appConfig.providers[requestedProvider]) {
    return {
      providerProfileKey: requestedProvider,
      providerConfig: appConfig.providers[
        requestedProvider
      ] as ApiProviderConfig,
      providerSource: "session",
      notes,
    };
  }

  if (requestedProvider) {
    notes.push("session_provider_missing_fell_back_to_active");
  }

  const fallbackProviderKey = appConfig.activeProviderKey;
  const fallbackProvider = appConfig.providers[fallbackProviderKey];
  if (!fallbackProvider) {
    throw new Error(`Provider config not found: ${fallbackProviderKey}`);
  }

  return {
    providerProfileKey: fallbackProviderKey,
    providerConfig: fallbackProvider,
    providerSource: "activeProvider",
    notes,
  };
}

function getRequestedModel(
  appConfig: AppConfig,
  providerConfig: ApiProviderConfig,
  sessionModel?: string,
): {
  modelId: string;
  matchedModel: ApiProviderModel;
  modelSource: ModelResolutionTrace["modelSource"];
  notes: string[];
} {
  const notes: string[] = [];
  const requestedModel = sessionModel?.trim();
  const providerDefaultModel = providerConfig.defaultModel?.trim();
  const globalModel = appConfig.model?.trim();
  const fallbackModel = "anthropic/claude-sonnet-4-6";

  const modelSource: ModelResolutionTrace["modelSource"] = requestedModel
    ? "session"
    : providerDefaultModel
      ? "provider.defaultModel"
      : globalModel
        ? "global.model"
        : "fallback";

  const modelId =
    requestedModel || providerDefaultModel || globalModel || fallbackModel;
  const matchedModel = providerConfig.models.find(
    (item) => item.id === modelId,
  );
  if (matchedModel) {
    return { modelId, matchedModel, modelSource, notes };
  }

  notes.push("model_missing_from_provider_catalog");
  return {
    modelId,
    matchedModel: { id: modelId, label: modelId, source: "custom" },
    modelSource,
    notes,
  };
}

export class ModelResolutionService {
  async resolve(input: ResolveModelInput): Promise<ResolvedModelRuntime> {
    const providerSelection = getProviderConfig(
      input.appConfig,
      input.sessionProviderProfileKey,
    );
    const modelSelection = getRequestedModel(
      input.appConfig,
      providerSelection.providerConfig,
      input.sessionModel,
    );

    const providerConfig = providerSelection.providerConfig;
    const protocol = resolvePiRouteProtocol(
      providerConfig.provider,
      providerConfig.customProtocol,
    );
    const rawBaseUrl = providerConfig.baseUrl?.trim() || undefined;
    const baseUrl =
      protocol === "openai" && providerConfig.provider !== "ollama"
        ? normalizeOpenAICompatibleBaseUrl(rawBaseUrl) || rawBaseUrl
        : rawBaseUrl;

    const notes = [...providerSelection.notes, ...modelSelection.notes];
    if (rawBaseUrl && baseUrl !== rawBaseUrl) {
      notes.push("normalized_openai_compatible_base_url");
    }

    const modelString = resolvePiModelString({
      provider: providerConfig.provider,
      customProtocol: providerConfig.customProtocol,
      model: modelSelection.modelId,
      defaultModel: input.appConfig.model,
    });

    let piModelSource: ModelResolutionTrace["piModelSource"] = "registry";
    let piModel = resolvePiRegistryModel(modelString, {
      configProvider: protocol,
      customBaseUrl: baseUrl,
      rawProvider: providerConfig.provider,
      customProtocol: providerConfig.customProtocol,
    });

    if (!piModel) {
      piModelSource = "synthetic";
      notes.push("registry_model_not_found");
      const synthetic = resolveSyntheticPiModelFallback({
        rawModel: modelSelection.modelId,
        resolvedModelString: modelString,
        rawProvider: providerConfig.provider,
        routeProtocol: protocol,
        baseUrl,
      });
      piModel = buildSyntheticPiModel(
        synthetic.modelId,
        synthetic.provider,
        protocol,
        baseUrl,
        undefined,
        undefined,
        modelSelection.matchedModel.contextWindow,
        modelSelection.matchedModel.maxTokens,
      );
      piModel = applyPiModelRuntimeOverrides(piModel, {
        configProvider: protocol,
        customBaseUrl: baseUrl,
        rawProvider: providerConfig.provider,
        customProtocol: providerConfig.customProtocol,
      });
    }

    if (
      providerConfig.provider === "ollama" &&
      !modelSelection.matchedModel.contextWindow
    ) {
      const ollamaInfo = await fetchOllamaModelInfo({
        baseUrl:
          piModel.baseUrl ||
          providerConfig.baseUrl ||
          "http://localhost:11434/v1",
        model: piModel.id,
        apiKey: providerConfig.apiKey,
      });
      if (ollamaInfo.contextWindow) {
        piModel = {
          ...piModel,
          contextWindow: ollamaInfo.contextWindow,
        } as Model<Api>;
        notes.push("ollama_context_window_from_api_show");
      }
    }

    const contextWindow =
      modelSelection.matchedModel.contextWindow ||
      piModel.contextWindow ||
      128000;
    const maxTokens =
      modelSelection.matchedModel.maxTokens || piModel.maxTokens || 16384;
    if (
      piModel.contextWindow !== contextWindow ||
      piModel.maxTokens !== maxTokens
    ) {
      piModel = { ...piModel, contextWindow, maxTokens } as Model<Api>;
    }

    return {
      providerProfileKey: providerSelection.providerProfileKey,
      providerType: providerConfig.provider,
      customProtocol: providerConfig.customProtocol,
      protocol,
      modelId: modelSelection.modelId,
      apiKey: providerConfig.apiKey?.trim() || undefined,
      baseUrl,
      contextWindow,
      maxTokens,
      piModel,
      trace: {
        providerSource: providerSelection.providerSource,
        modelSource: modelSelection.modelSource,
        piModelSource,
        notes,
      },
    };
  }
}

export const modelResolutionService = new ModelResolutionService();
