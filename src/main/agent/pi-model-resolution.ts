// TODO: migrate from compat to createModels() when compat is removed
// (v0.80.0 changelog: "will be removed in a future release with a migration guide")
import {
  getModel,
  getModels,
  getProviders,
} from "@earendil-works/pi-ai/compat";
import type { Api, Model } from "@earendil-works/pi-ai";
import { isOfficialOpenAIBaseUrl } from "../config/auth-utils";
import { DESKWAND_API_URL } from "../../shared/oauth-config";

const COMMON_FALLBACK_PROVIDERS = ["openai", "anthropic", "google"] as const;
const INVALID_REGISTRY_PROVIDERS = new Set(["", "custom"]);
const REASONING_MODEL_PATTERN =
  /\bthinking\b|\breasoner\b|deepseek-r1|deepseek-v4|deepseek-flash|kimi-k2|qwen3(?:\.5)?(?=[:/-]|$)/i;
type PiRegistryProvider = Parameters<typeof getModel>[0];

export interface PiModelStringInput {
  provider?: string;
  customProtocol?: string;
  model?: string;
  defaultModel?: string;
}

export interface PiModelLookupOptions {
  configProvider?: string;
  rawProvider?: string;
  customBaseUrl?: string;
  customProtocol?: string;
}

export interface PiModelLookupCandidate {
  provider: string;
  model: string;
}

export interface SyntheticPiModelFallbackInput {
  rawModel?: string;
  resolvedModelString: string;
  rawProvider?: string;
  routeProtocol: string;
  baseUrl?: string;
}

export interface SyntheticPiModelFallback {
  provider: string;
  modelId: string;
}

export function resolvePiRouteProtocol(
  provider?: string,
  customProtocol?: string,
): string {
  if (provider === "oauth") return "openai";
  if (provider === "custom") {
    if (customProtocol === "openai" || customProtocol === "gemini") {
      return customProtocol;
    }
    return "anthropic";
  }
  if (provider === "ollama") return "openai";
  if (provider === "deepseek") return "openai";
  if (provider === "opencode") return "opencode";
  if (provider === "opencode-go") return "opencode-go";
  if (provider === "openai") return "openai";
  if (provider === "openrouter") return "openai";
  if (provider === "gemini") return "gemini";
  return provider || "anthropic";
}

function shouldDisableDeveloperRoleForEndpoint(
  model: Model<Api>,
  options: PiModelLookupOptions,
): boolean {
  if (model.api !== "openai-completions" && model.api !== "openai-responses") {
    return false;
  }

  const endpoint = options.customBaseUrl?.trim() || model.baseUrl?.trim();
  if (!endpoint || isOfficialOpenAIBaseUrl(endpoint)) {
    return false;
  }

  return true;
}

export function inferPiApi(protocol: string): string {
  switch (protocol) {
    case "anthropic":
      return "anthropic-messages";
    case "gemini":
    case "google":
      return "google-generative-ai";
    case "openai":
    default:
      return "openai-completions";
  }
}

/**
 * Known context window / max output specs for common Ollama model families.
 * Used as a middle layer between user config overrides and the hardcoded default.
 */
const KNOWN_MODEL_SPECS: Record<
  string,
  { contextWindow: number; maxTokens: number }
> = {
  "qwen3.5": { contextWindow: 258048, maxTokens: 32768 },
  qwen3: { contextWindow: 40960, maxTokens: 8192 },
  "qwen2.5": { contextWindow: 131072, maxTokens: 8192 },
  llama3: { contextWindow: 131072, maxTokens: 4096 },
  "llama3.1": { contextWindow: 131072, maxTokens: 4096 },
  "llama3.2": { contextWindow: 131072, maxTokens: 4096 },
  "llama3.3": { contextWindow: 131072, maxTokens: 4096 },
  "deepseek-r1": { contextWindow: 65536, maxTokens: 8192 },
  "deepseek-v3": { contextWindow: 65536, maxTokens: 8192 },
  "deepseek-v4": { contextWindow: 1_000_000, maxTokens: 16384 },
  "deepseek-flash": { contextWindow: 1_000_000, maxTokens: 384_000 },
  gemma2: { contextWindow: 8192, maxTokens: 4096 },
  gemma3: { contextWindow: 131072, maxTokens: 8192 },
  phi3: { contextWindow: 131072, maxTokens: 4096 },
  phi4: { contextWindow: 16384, maxTokens: 4096 },
  mistral: { contextWindow: 32768, maxTokens: 4096 },
  mixtral: { contextWindow: 32768, maxTokens: 4096 },
  codellama: { contextWindow: 16384, maxTokens: 4096 },
  "command-r": { contextWindow: 131072, maxTokens: 4096 },
};

function lookupModelSpecs(
  modelId: string,
): { contextWindow: number; maxTokens: number } | undefined {
  const lower = modelId.toLowerCase();
  // Match by prefix: "qwen3.5:0.8b" → "qwen3.5", "deepseek-r1-distill" → "deepseek-r1"
  for (const [key, specs] of Object.entries(KNOWN_MODEL_SPECS)) {
    if (
      lower === key ||
      lower.startsWith(key + ":") ||
      lower.startsWith(key + "-")
    ) {
      return specs;
    }
  }
  return undefined;
}

/**
 * Look up the model by name across ALL providers in the pi-ai registry.
 * The same model across different providers generally has the same capabilities,
 * so provider is not a reliable differentiator for model capabilities.
 */
function resolveInputFromRegistry(
  modelId: string,
): ("text" | "image")[] | undefined {
  for (const provider of getProviders()) {
    const match = getModels(provider).find((m) => m.id === modelId);
    if (match) return match.input;
  }
  return undefined;
}

export function buildSyntheticPiModel(
  modelId: string,
  provider: string,
  protocol: string,
  baseUrl?: string,
  apiOverride?: string,
  reasoning?: boolean,
  contextWindow?: number,
  maxTokens?: number,
): Model<Api> {
  const api = apiOverride || inferPiApi(protocol);
  const autoReasoning = reasoning ?? REASONING_MODEL_PATTERN.test(modelId);
  const knownSpecs = lookupModelSpecs(modelId);
  return {
    id: modelId,
    name: modelId,
    api,
    provider,
    baseUrl: baseUrl || "",
    reasoning: autoReasoning,
    input: resolveModelInput(modelId),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow ?? knownSpecs?.contextWindow ?? 128000,
    maxTokens: maxTokens ?? knownSpecs?.maxTokens ?? 16384,
  } as Model<Api>;
}

export function resolveSyntheticPiModelFallback(
  input: SyntheticPiModelFallbackInput,
): SyntheticPiModelFallback {
  const rawModel = input.rawModel?.trim() || "";
  const modelString = input.resolvedModelString.trim();
  const parts = modelString.split("/");
  const parsedProvider = parts.length >= 2 ? parts[0] : "";
  const strippedModelId =
    parts.length >= 2 ? parts.slice(1).join("/") : modelString;
  const baseUrl = input.baseUrl?.trim() || "";
  const preservesExplicitPrefixedId =
    rawModel.includes("/") &&
    (input.rawProvider === "openrouter" ||
      input.rawProvider === "custom" ||
      (input.rawProvider === "openai" &&
        !!baseUrl &&
        !isOfficialOpenAIBaseUrl(baseUrl))) &&
    input.routeProtocol === "openai";

  if (input.rawProvider === "openrouter") {
    return {
      provider: "openrouter",
      modelId: preservesExplicitPrefixedId ? modelString : strippedModelId,
    };
  }

  const fallbackProvider =
    input.rawProvider === "custom" || input.rawProvider === "ollama"
      ? input.routeProtocol || "anthropic"
      : parsedProvider ||
        input.rawProvider ||
        input.routeProtocol ||
        "anthropic";

  return {
    provider: preservesExplicitPrefixedId
      ? parsedProvider || fallbackProvider
      : fallbackProvider,
    modelId: preservesExplicitPrefixedId ? modelString : strippedModelId,
  };
}

export function resolvePiModelString(input: PiModelStringInput): string {
  const model = input.model?.trim();
  if (!model) {
    return input.defaultModel || "anthropic/claude-sonnet-4-6";
  }
  if (model.includes("/")) {
    return model;
  }
  const provider = input.provider || "anthropic";
  return `${provider}/${model}`;
}

function addLookupCandidate(
  candidates: PiModelLookupCandidate[],
  seen: Set<string>,
  provider: string | undefined,
  model: string | undefined,
): void {
  const normalizedProvider = provider?.trim() || "";
  const normalizedModel = model?.trim() || "";
  if (
    !normalizedProvider ||
    !normalizedModel ||
    INVALID_REGISTRY_PROVIDERS.has(normalizedProvider)
  ) {
    return;
  }

  const key = `${normalizedProvider}\u0000${normalizedModel}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  candidates.push({ provider: normalizedProvider, model: normalizedModel });
}

export function buildPiModelLookupCandidates(
  modelString: string,
  options: Pick<PiModelLookupOptions, "configProvider" | "rawProvider"> = {},
): PiModelLookupCandidate[] {
  const keyProvider =
    options.configProvider === "custom"
      ? "anthropic"
      : options.configProvider || "anthropic";
  const rawProvider = options.rawProvider?.trim() || "";
  const trimmedModel = modelString.trim();
  const parts = trimmedModel.split("/");
  const seen = new Set<string>();
  const candidates: PiModelLookupCandidate[] = [];

  if (parts.length >= 2) {
    const parsedProvider = parts[0];
    const parsedModelId = parts.slice(1).join("/");

    if (
      rawProvider &&
      rawProvider !== keyProvider &&
      rawProvider !== parsedProvider
    ) {
      addLookupCandidate(candidates, seen, rawProvider, trimmedModel);
    }
    if (keyProvider !== parsedProvider) {
      addLookupCandidate(candidates, seen, keyProvider, trimmedModel);
    }
    addLookupCandidate(candidates, seen, parsedProvider, parsedModelId);
    for (const fallbackProvider of COMMON_FALLBACK_PROVIDERS) {
      addLookupCandidate(candidates, seen, fallbackProvider, parsedModelId);
    }
    return candidates;
  }

  addLookupCandidate(candidates, seen, keyProvider, trimmedModel);
  for (const fallbackProvider of COMMON_FALLBACK_PROVIDERS) {
    addLookupCandidate(candidates, seen, fallbackProvider, trimmedModel);
  }
  return candidates;
}

export function applyPiModelRuntimeOverrides(
  model: Model<Api>,
  options: PiModelLookupOptions = {},
): Model<Api> {
  let nextModel = model;

  // 输入能力按 id 钉住：注册表路径（resolvePiRegistryModel）不经过 resolveModelInput，
  // 而 pi-ai 0.87.1 的 DeepSeek 目录已把 deepseek-flash 标成收图。升级 SDK 不改变
  // 用户可见能力，因此两条链路都在这里收敛（见 KNOWN_TEXT_ONLY_MODEL_IDS 的说明）。
  if (KNOWN_TEXT_ONLY_MODEL_IDS.has(nextModel.id)) {
    nextModel = { ...nextModel, input: ["text"] } as typeof nextModel;
  }
  const isCustomProvider =
    options.rawProvider === "custom" || options.configProvider === "custom";
  const shouldHonorConfiguredBaseUrl =
    options.rawProvider === "openai" || isCustomProvider;
  const modelHasBaseUrl = Boolean(nextModel.baseUrl);

  if (
    options.customBaseUrl &&
    (shouldHonorConfiguredBaseUrl || !modelHasBaseUrl)
  ) {
    nextModel = {
      ...nextModel,
      baseUrl: options.customBaseUrl,
    } as typeof nextModel;
  }

  const effectiveProvider = options.rawProvider || options.configProvider;
  if (
    options.customBaseUrl &&
    isCustomProvider &&
    nextModel.api === "openai-responses"
  ) {
    // Most custom OpenAI-compatible relays only implement chat/completions.
    nextModel = { ...nextModel, api: "openai-completions" } as typeof nextModel;
  }
  if (
    effectiveProvider === "openrouter" &&
    nextModel.api !== "openai-completions"
  ) {
    nextModel = { ...nextModel, api: "openai-completions" } as typeof nextModel;
  }
  if (shouldDisableDeveloperRoleForEndpoint(nextModel, options)) {
    nextModel = {
      ...nextModel,
      compat: {
        ...(nextModel.compat || {}),
        supportsDeveloperRole: false,
        supportsStore: false,
      },
    } as typeof nextModel;
  }

  if (
    options.rawProvider === "ollama" &&
    nextModel.reasoning &&
    nextModel.api === "openai-completions"
  ) {
    const currentCompat = (nextModel.compat || {}) as Record<string, unknown>;
    const currentReasoningEffortMap = (
      currentCompat.reasoningEffortMap &&
      typeof currentCompat.reasoningEffortMap === "object"
        ? currentCompat.reasoningEffortMap
        : {}
    ) as Record<string, string>;
    nextModel = {
      ...nextModel,
      compat: {
        ...currentCompat,
        supportsReasoningEffort: true,
        reasoningEffortMap: {
          ...currentReasoningEffortMap,
          off: "none",
        },
      },
    } as typeof nextModel;
  }

  // 我们的云端点背后是 DeepSeek，而 pi 打包的模型目录还没有官方名 deepseek-flash
  // （目录由 models.dev 生成、deepseek provider 无 refreshModels）。缺 compat 时 pi 会按
  // "custom provider + 非 deepseek 域名" 推断：max tokens 用 max_completion_tokens、
  // 完全不发 thinking（思考档因此关不掉）、assistant 消息不带 reasoning_content
  // （官方文档：带 tools 的多轮缺它会 400）。developer 角色与 store 已由上面的
  // shouldDisableDeveloperRoleForEndpoint 处理，这里只补真正缺失的三个字段，
  // 取值与 pi 注册表的 deepseek 条目一致。pi 之后带上 deepseek-flash 条目后本分支即冗余，可删。
  // 用带斜杠的前缀比较，避免 "api.deskwand.com.evil.com" 这类同前缀域名被误判为我们的端点。
  // 不额外判 api：自定义 provider 的协议由 inferPiApi 收敛，未知协议也一律是 openai-completions。
  const cloudEndpoint = options.customBaseUrl || nextModel.baseUrl || "";
  const cloudCompat = (nextModel.compat || {}) as Record<string, unknown>;
  if (
    isCustomProvider &&
    cloudEndpoint.startsWith(`${DESKWAND_API_URL}/`) &&
    nextModel.id.startsWith("deepseek-")
  ) {
    nextModel = {
      ...nextModel,
      compat: {
        ...cloudCompat,
        // 只在缺失时补齐：pi 注册表将来若已提供取值（官方名进目录后），以注册表为准
        maxTokensField: cloudCompat.maxTokensField ?? "max_tokens",
        requiresReasoningContentOnAssistantMessages:
          cloudCompat.requiresReasoningContentOnAssistantMessages ?? true,
        thinkingFormat: cloudCompat.thinkingFormat ?? "deepseek",
      },
    } as typeof nextModel;
  }

  // Handle custom provider with explicit protocol override
  if (isCustomProvider && options.customProtocol) {
    const targetApi = inferPiApi(options.customProtocol);
    if (nextModel.api !== targetApi) {
      nextModel = { ...nextModel, api: targetApi } as typeof nextModel;
    }
  }

  return nextModel;
}

export function resolvePiRegistryModel(
  modelString: string,
  options: PiModelLookupOptions = {},
): Model<Api> | undefined {
  for (const candidate of expandRenamedCandidates(
    buildPiModelLookupCandidates(modelString, options),
  )) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (getModel as (...args: unknown[]) => Model<Api> | undefined)(
      candidate.provider as PiRegistryProvider,
      candidate.model,
    );
    if (model) {
      return applyPiModelRuntimeOverrides(model, options);
    }
  }

  // Cross-provider fallback: the same model may appear under multiple
  // providers in the registry (e.g. deepseek-v4-pro is registered under
  // "deepseek", but a custom provider won't match that via candidate lookup).
  const modelId = modelString.includes("/")
    ? modelString.split("/").slice(1).join("/")
    : modelString;
  for (const provider of getProviders()) {
    const match = getModels(provider).find((m) => m.id === modelId);
    if (match) {
      return applyPiModelRuntimeOverrides(match, options);
    }
  }

  return undefined;
}

/**
 * Resolve the context window for a model name string.
 * Checks KNOWN_MODEL_SPECS first, then falls back to pi registry.
 */
export function resolveModelContextWindow(modelName: string): number {
  const key = modelName.toLowerCase();
  for (const [specKey, spec] of Object.entries(KNOWN_MODEL_SPECS)) {
    if (key.startsWith(specKey)) return spec.contextWindow;
  }
  const model = resolvePiRegistryModel(modelName);
  return model?.contextWindow ?? 0;
}

/**
 * pi 注册表没有官方名条目、但确认为纯文本的模型 id。
 *
 * 历史：`deepseek-flash` 长期未被注册表收录（同族只有 v4-flash / v4-pro /
 * v4-flash-vision-exp），缺条目时合成回退会乐观地标成 ["text","image"]
 * → 用户贴的图片以原生 image_url 直传 DeepSeek 方言端点，上游 400。
 *
 * 现状（pi-ai 0.87.1）：上游 DeepSeek 目录**已收录** `deepseek-flash`（DeepSeek V4.1
 * Flash）并标为 ["text","image"]，且 resolvePiRegistryModel 的跨 provider 回退会把它当成
 * 云端 `custom/deepseek-flash` 的结果。但同一模型在 radius / opencode / fireworks /
 * openrouter 等同族目录里仍是 ["text"]，而原先记录的上游 400 没有新证据说明已修复。
 *
 * 因此保留本表，并在 applyPiModelRuntimeOverrides 里对云端端点再镇一次
 * （注册表路径不经过 resolveModelInput，只靠本函数守不住）。
 * 回退条件：云端端点实测接受 image_url —— 那时删掉本表，并把 resolveInputFromRegistry
 * 改成按 provider + id 匹配，而不是仅按 id。
 */
const KNOWN_TEXT_ONLY_MODEL_IDS: ReadonlySet<string> = new Set([
  "deepseek-flash",
]);

/**
 * 上游改名的模型 id：profile 里存着旧 id 时，先把候选映射到新 id 再查注册表。
 *
 * pi-ai 0.87.1 起 `deepseek` provider 只留 `deepseek-flash`（DeepSeek 官方已把
 * deepseek-v4-flash 改名为 deepseek-flash，旧名仍被上游接受 —— 见
 * src/main/usage/model-price-overrides.ts 的计价说明）。不做重定向时，原生 deepseek
 * profile 选到旧 id 会落到下面的跨 provider 回退、命中 opencode 的条目，
 * 使 provider 身份从 deepseek 漂成 opencode（API key 随之按错误的命名空间解析）。
 *
 * 键是候选里的 provider，值是旧 id → 新 id。
 */
const PI_MODEL_ID_RENAMES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  deepseek: {
    "deepseek-v4-flash": "deepseek-flash",
    // 同族实验性视觉条目也一并退役（0.85.1 的 deepseek 目录里有，0.87.1 只剩
    // deepseek-flash + deepseek-v4-pro）。不重定向则落到只收录该 id 的 opencode。
    "deepseek-v4-flash-vision-exp": "deepseek-flash",
  },
};

/**
 * 把每个候选原地展开为「原名 + 新名」，让重定向先于跨 provider 回退生效
 * （回退只看 id、不看 provider，因此晚一步就会命中外部的同名条目）。
 */
function expandRenamedCandidates(
  candidates: readonly PiModelLookupCandidate[],
): PiModelLookupCandidate[] {
  const expanded: PiModelLookupCandidate[] = [];
  for (const candidate of candidates) {
    expanded.push(candidate);
    const renamed = PI_MODEL_ID_RENAMES[candidate.provider]?.[candidate.model];
    if (renamed) {
      expanded.push({ provider: candidate.provider, model: renamed });
    }
  }
  return expanded;
}

/**
 * 单模型输入能力：已知纯文本表 > 注册表 > 乐观默认 ["text","image"]。
 *
 * 主会话（buildSyntheticPiModel）与子代理 provider 注册（provider-bridge）必须走同一个函数：
 * 同一个 id 在两处得出不同能力，会出现「主会话能看图、子代理只拿到占位符」这种无从排查的差异。
 *
 * 纯文本表刻意排在注册表之前：pi-ai 0.87.1 的 DeepSeek 目录开始把 `deepseek-flash`
 * 标成收图，但云端与官方两条链路都未验证过真的接受 image_url（见该表的注释）。
 */
export function resolveModelInput(modelId: string): ("text" | "image")[] {
  if (KNOWN_TEXT_ONLY_MODEL_IDS.has(modelId)) return ["text"];
  const registryInput = resolveInputFromRegistry(modelId);
  if (registryInput) return registryInput;
  return ["text", "image"];
}
