// TODO: migrate from compat to createModels() when compat is removed
import { randomUUID } from "node:crypto";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { type UserMessage as PiUserMessage } from "@earendil-works/pi-ai";
import type { ApiTestInput, ApiTestResult } from "../../renderer/types";
import {
  PROVIDER_PRESETS,
  type AppConfig,
  type CustomProtocolType,
} from "../config/config-store";
import {
  normalizeAnthropicBaseUrl,
  normalizeOllamaBaseUrl,
  normalizeOpenAICompatibleBaseUrl,
  resolveOllamaCredentials,
  resolveOpenAICredentials,
  shouldAllowEmptyAnthropicApiKey,
  shouldAllowEmptyGeminiApiKey,
} from "../config/auth-utils";
import { log, logWarn } from "../utils/logger";
import { getDatabase } from "../db/database";
import { normalizeTokenUsage } from "../usage/normalize-usage";
import { buildAuxUsageRecord } from "../usage/usage-records";
import { recordUsage } from "../usage/usage-store";
import type { TokenUsage } from "../../renderer/types";
import type { UsagePurpose } from "../../shared/usage";
import { normalizeGeneratedTitle } from "../session/session-title-utils";
import { resolveProviderApiKey } from "./shared-model-runtime";
import { extractOAuthProviderId } from "../../shared/oauth-utils";
import { shouldPreserveModelId } from "../../shared/local-gateways";
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
  inferPiApi,
  resolvePiRegistryModel,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from "./pi-model-resolution";

const NETWORK_ERROR_RE =
  /enotfound|econnrefused|etimedout|eai_again|enetunreach|timed?\s*out|timeout|abort|network\s*error/i;
const AUTH_ERROR_RE =
  /authentication[_\s-]?failed|\bunauthorized\b|invalid[_\s-]?api[_\s-]?key|api[_\s-]?key[_\s-]?invalid|api[_\s]+key[_\s]+not[_\s]+valid|\bforbidden\b|permission[_\s-]?denied|\b401\b|\b403\b/i;
const RATE_LIMIT_RE = /rate[_\s-]?limit|too\s+many\s+requests|429/i;
const SERVER_ERROR_RE =
  /server[_\s-]?error|internal\s+server\s+error|\b5\d\d\b/i;
const PROBE_ACK = "sdk_probe_ok";
const LOCAL_ANTHROPIC_PLACEHOLDER_KEY = "sk-ant-local-proxy";
const LOCAL_GEMINI_PLACEHOLDER_KEY = "sk-gemini-local-proxy";

function resolveProbeBaseUrl(input: ApiTestInput): string | undefined {
  const configured = input.baseUrl?.trim();
  if (configured) return configured;
  if (input.provider !== "custom") {
    return (
      PROVIDER_PRESETS as unknown as Record<string, { baseUrl?: string }>
    )[input.provider]?.baseUrl;
  }
  return undefined;
}

function resolveProbeApiKey(
  input: ApiTestInput,
  resolvedCustomProtocol: CustomProtocolType,
  effectiveBaseUrl: string | undefined,
  explicitApiKey: string | undefined,
  config: AppConfig,
): string {
  const candidateApiKey = explicitApiKey ?? config.apiKey?.trim() ?? "";
  if (candidateApiKey) {
    return candidateApiKey;
  }

  if (input.provider === "ollama") {
    return (
      resolveOllamaCredentials({
        provider: input.provider,
        customProtocol: resolvedCustomProtocol,
        apiKey: "",
        baseUrl: effectiveBaseUrl,
      })?.apiKey || ""
    );
  }

  if (
    input.provider === "openai" ||
    input.provider === "deepseek" ||
    input.provider === "openrouter" ||
    (input.provider === "custom" && resolvedCustomProtocol === "openai")
  ) {
    return (
      resolveOpenAICredentials({
        provider: input.provider,
        customProtocol: resolvedCustomProtocol,
        apiKey: "",
        baseUrl: effectiveBaseUrl,
      })?.apiKey || ""
    );
  }

  if (
    shouldAllowEmptyAnthropicApiKey({
      provider: input.provider,
      customProtocol: resolvedCustomProtocol,
      baseUrl: effectiveBaseUrl,
    })
  ) {
    return LOCAL_ANTHROPIC_PLACEHOLDER_KEY;
  }

  if (
    shouldAllowEmptyGeminiApiKey({
      provider: input.provider,
      customProtocol: resolvedCustomProtocol,
      baseUrl: effectiveBaseUrl,
    })
  ) {
    return LOCAL_GEMINI_PLACEHOLDER_KEY;
  }

  return "";
}

/**
 * 测试的是某个已保存的本机网关 profile 时，把探针配置的 activeProviderKey 指回它。
 * 否则 runPiAiOneShot 会从「当前激活」的别的 profile 取 localGateway 标记，
 * 把 opencode-go/kimi-k3 剥成 kimi-k3。
 */
function findProbeLocalGatewayProfileKey(
  config: AppConfig,
  input: ApiTestInput,
  effectiveBaseUrl: string | undefined,
  resolvedCustomProtocol: CustomProtocolType,
): string | undefined {
  if (input.provider !== "custom" || resolvedCustomProtocol !== "openai") {
    return undefined;
  }
  if (!effectiveBaseUrl) return undefined;
  return Object.keys(config.providers ?? {})
    .filter((key) => {
      const profile = config.providers[key];
      if (!profile?.localGateway) return false;
      const normalized = normalizeOpenAICompatibleBaseUrl(
        profile.baseUrl?.trim(),
      );
      return normalized === effectiveBaseUrl;
    })
    .sort()[0];
}

function buildProbeConfig(input: ApiTestInput, config: AppConfig): AppConfig {
  const resolvedBaseUrl = resolveProbeBaseUrl(input);
  const normalizedInputApiKey =
    typeof input.apiKey === "string" ? input.apiKey.trim() : undefined;
  const resolvedCustomProtocol = resolvePiRouteProtocol(
    input.provider,
    input.customProtocol,
  ) as CustomProtocolType;
  const effectiveRawBaseUrl = resolvedBaseUrl || "";
  const effectiveBaseUrl =
    input.provider === "ollama"
      ? normalizeOllamaBaseUrl(effectiveRawBaseUrl) || effectiveRawBaseUrl
      : resolvedCustomProtocol === "openai"
        ? normalizeOpenAICompatibleBaseUrl(effectiveRawBaseUrl) ||
          effectiveRawBaseUrl
        : resolvedCustomProtocol === "gemini"
          ? effectiveRawBaseUrl
          : normalizeAnthropicBaseUrl(effectiveRawBaseUrl);
  const effectiveApiKey = resolveProbeApiKey(
    input,
    resolvedCustomProtocol,
    effectiveBaseUrl,
    normalizedInputApiKey,
    config,
  );
  const localGatewayProfileKey = findProbeLocalGatewayProfileKey(
    config,
    input,
    effectiveBaseUrl,
    resolvedCustomProtocol,
  );
  return {
    ...config,
    ...(localGatewayProfileKey
      ? { activeProviderKey: localGatewayProfileKey }
      : {}),
    provider: input.provider,
    customProtocol: resolvedCustomProtocol,
    apiKey: effectiveApiKey,
    baseUrl: effectiveBaseUrl,
    model: typeof input.model === "string" ? input.model.trim() : config.model,
  };
}

function mapPiAiError(
  errorText: string,
  durationMs: number,
  provider?: string,
): ApiTestResult {
  const details = errorText.trim();
  const lowered = details.toLowerCase();

  if (AUTH_ERROR_RE.test(lowered)) {
    return {
      ok: false,
      latencyMs: durationMs,
      errorType: "unauthorized",
      details,
    };
  }
  if (RATE_LIMIT_RE.test(lowered)) {
    return {
      ok: false,
      latencyMs: durationMs,
      errorType: "rate_limited",
      details,
    };
  }
  if (SERVER_ERROR_RE.test(lowered)) {
    return {
      ok: false,
      latencyMs: durationMs,
      errorType: "server_error",
      details,
    };
  }
  if (provider === "ollama" && /econnrefused/i.test(lowered)) {
    return {
      ok: false,
      latencyMs: durationMs,
      errorType: "ollama_not_running",
      details,
    };
  }
  if (NETWORK_ERROR_RE.test(lowered)) {
    return {
      ok: false,
      latencyMs: durationMs,
      errorType: "network_error",
      details,
    };
  }
  return { ok: false, latencyMs: durationMs, errorType: "unknown", details };
}

/**
 * Run a simple one-shot prompt via pi-ai model directly (no agent session needed).
 */
export async function runPiAiOneShot(
  prompt: string,
  systemPrompt: string,
  config: AppConfig,
  options?: {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    /**
     * 会话 id。opencode / opencode-go 要求每次请求带 `x-opencode-session`
     * （pi-ai 会把该字段转成请求头），缺了直接 400 MissingSessionID。
     * 会话相关的调用（如标题生成）传入真实 session id；一次性调用不传，
     * 这里按请求生成，避免把互不相关的请求登记成同一个会话。
     */
    sessionId?: string;
  },
): Promise<{
  text: string;
  hasThinking: boolean;
  durationMs: number;
  usage?: TokenUsage;
}> {
  // For OAuth providers, map to the actual pi-ai provider ID
  // (e.g. oauth:openai-codex → openai-codex) so the correct model
  // entry (with codex baseUrl + api type) is used from pi-ai's registry.
  const activeIsOAuth = config.provider === "oauth";
  const oauthPiProvider =
    activeIsOAuth && config.activeProviderKey
      ? extractOAuthProviderId(config.activeProviderKey)
      : undefined;
  const effectiveProvider = oauthPiProvider || config.provider || "anthropic";
  const defaultModel =
    config.providers?.[config.activeProviderKey]?.models?.[0]?.id;
  const modelId = config.model?.trim() || defaultModel || "claude-sonnet-4-6";
  const modelString = modelId.includes("/")
    ? modelId
    : `${effectiveProvider}/${modelId}`;
  const keyProvider =
    oauthPiProvider || config.customProtocol || config.provider || "anthropic";

  // Normalize base URL for OpenAI-compatible providers (strips copy-pasted endpoint suffixes)
  const routeProtocol = resolvePiRouteProtocol(
    config.provider,
    config.customProtocol,
  );
  const rawBaseUrl = config.baseUrl?.trim() || undefined;
  const effectiveBaseUrl =
    routeProtocol === "openai" && config.provider !== "ollama"
      ? normalizeOpenAICompatibleBaseUrl(rawBaseUrl) || rawBaseUrl
      : rawBaseUrl;

  let piModel = resolvePiRegistryModel(modelString, {
    configProvider: keyProvider,
    customBaseUrl: effectiveBaseUrl,
    rawProvider: config.provider || "anthropic",
    customProtocol: config.customProtocol,
    preserveModelId: shouldPreserveModelId(
      config.providers?.[config.activeProviderKey],
    ),
  });

  if (!piModel) {
    // Synthetic fallback for unknown/custom models
    const effectiveProtocol = resolvePiRouteProtocol(
      config.provider,
      config.customProtocol,
    ) as CustomProtocolType;
    const api = effectiveBaseUrl ? inferPiApi(effectiveProtocol) : undefined;
    const synthetic = resolveSyntheticPiModelFallback({
      rawModel: config.model,
      resolvedModelString: modelString,
      rawProvider: config.provider,
      routeProtocol: effectiveProtocol,
      baseUrl: effectiveBaseUrl,
    });
    piModel = buildSyntheticPiModel(
      synthetic.modelId,
      synthetic.provider,
      effectiveProtocol,
      effectiveBaseUrl || "",
      api,
    );
    piModel = applyPiModelRuntimeOverrides(piModel, {
      configProvider: keyProvider,
      customBaseUrl: effectiveBaseUrl,
      rawProvider: config.provider || "anthropic",
      customProtocol: config.customProtocol,
    });
    logWarn(
      "[OneShot] Model not in pi-ai registry, using synthetic model:",
      modelString,
      "→",
      api,
    );
  }

  // piModel is guaranteed non-undefined after synthetic fallback
  const resolvedModel = piModel!;

  let apiKey: string | undefined = config.apiKey?.trim();
  if (!apiKey && activeIsOAuth && oauthPiProvider) {
    apiKey = await resolveProviderApiKey(oauthPiProvider);
  }

  const start = Date.now();

  // Use pi-ai's completeSimple for a one-shot call
  // Pass apiKey directly in options — completeSimple uses options.apiKey || env var
  const userMsg: PiUserMessage = {
    role: "user",
    content: prompt,
    timestamp: Date.now(),
  };
  log(
    "[OneShot] Calling completeSimple:",
    resolvedModel.provider,
    resolvedModel.id,
    "baseUrl:",
    resolvedModel.baseUrl,
    "api:",
    resolvedModel.api,
  );
  const response = await completeSimple(
    resolvedModel,
    {
      systemPrompt,
      messages: [userMsg],
    },
    {
      ...options,
      apiKey: apiKey || undefined,
      sessionId: options?.sessionId?.trim() || randomUUID(),
    },
  );

  // pi-ai resolves (not rejects) on provider errors — the error details
  // live in stopReason/errorMessage on the response object.  Surface them
  // so callers (probe, title-gen) get a meaningful error via mapPiAiError.
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    logWarn(
      "[OneShot] Provider error-as-resolve:",
      response.stopReason,
      response.errorMessage,
    );
    throw new Error(response.errorMessage || "Provider returned an error");
  }

  // Extract text and thinking content from response
  const textBlocks = response.content.filter((b) => b.type === "text");
  const thinkingBlocks = response.content.filter((b) => b.type === "thinking");
  const text = textBlocks
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();
  const hasThinking = thinkingBlocks.some(
    (b) => (b as { thinking: string }).thinking?.trim().length > 0,
  );
  log(
    "[OneShot] Response:",
    text ? text.substring(0, 200) : "(empty)",
    "blocks:",
    response.content.length,
    "textBlocks:",
    textBlocks.length,
    "thinkingBlocks:",
    thinkingBlocks.length,
  );
  return {
    text,
    hasThinking,
    durationMs: Date.now() - start,
    usage: normalizeTokenUsage(response.usage, resolvedModel.provider),
  };
}

/**
 * Aux calls have no backfill path, so buildAuxUsageRecord writes a NULL dedup
 * key rather than a fabricated timestamp key. Only title generation has a
 * session to attribute to (the pre-session title preview does not).
 */
function recordAuxUsage(
  usage: TokenUsage | undefined,
  purpose: UsagePurpose,
  model: string,
  provider: string,
  sessionId: string | null,
): void {
  if (!usage) return;
  try {
    recordUsage(
      getDatabase().raw,
      buildAuxUsageRecord(
        usage,
        purpose,
        model,
        provider,
        sessionId,
        Date.now(),
      ),
    );
  } catch (error) {
    logWarn("[OneShot] aux usage record failed:", error);
  }
}

export { recordAuxUsage };

function normalizeProbeAck(raw: string): string {
  // Strip markdown formatting and quotes around/between words, but preserve
  // underscores inside words (PROBE_ACK = 'sdk_probe_ok' contains underscores).
  return raw
    .replace(/(?<!\w)[*_~`"']+|[*_~`"']+(?!\w)/g, "")
    .replace(/[.,!?;:]+$/g, "")
    .trim()
    .toLowerCase();
}

export async function probeWithAgentSdk(
  input: ApiTestInput,
  config: AppConfig,
): Promise<ApiTestResult> {
  const probeConfig = buildProbeConfig(input, config);

  if (input.provider === "custom" && !probeConfig.baseUrl?.trim()) {
    return { ok: false, errorType: "missing_base_url" };
  }

  if (!probeConfig.model?.trim()) {
    return { ok: false, errorType: "unknown", details: "missing_model" };
  }

  if (!probeConfig.apiKey?.trim()) {
    return {
      ok: false,
      errorType: "missing_key",
      details: "API key is required.",
    };
  }

  const probeStart = Date.now();
  try {
    const result = await runPiAiOneShot(
      `What is 2+2? After answering, also include this token: ${PROBE_ACK}`,
      `You are a connectivity test. Answer briefly, then include the token: ${PROBE_ACK}`,
      probeConfig,
    );
    recordAuxUsage(
      result.usage,
      "probe",
      probeConfig.model || "unknown",
      probeConfig.provider || "unknown",
      null,
    );

    if (!result.text && !result.hasThinking) {
      return {
        ok: false,
        latencyMs: result.durationMs,
        errorType: "unknown",
        details: "empty_probe_response",
      };
    }
    // Thinking models may respond only with reasoning content and no text —
    // treat as successful probe since the model is reachable and responding.
    if (!result.text && result.hasThinking) {
      log(
        "[Probe] Thinking-only response — treating as ok (model reachable, cannot validate ack text)",
      );
      return { ok: true, latencyMs: result.durationMs };
    }
    if (!normalizeProbeAck(result.text).includes(PROBE_ACK)) {
      return {
        ok: false,
        latencyMs: result.durationMs,
        errorType: "unknown",
        details: `probe_response_mismatch:${result.text.slice(0, 120)}`,
      };
    }
    return { ok: true, latencyMs: result.durationMs };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const elapsed = Date.now() - probeStart;
    return mapPiAiError(details, elapsed, input.provider);
  }
}

export async function generateTitleWithAgentSdk(
  titlePrompt: string,
  config: AppConfig,
  sessionId?: string,
): Promise<string | null> {
  try {
    // 把真实会话 id 透传给请求：opencode 的 `x-opencode-session` 用它做路由
    // 与 prompt cache，标题请求与会话本身同 id 最省一次路由成本。
    const result = await runPiAiOneShot(
      titlePrompt,
      "Generate a concise title. Reply with only the title text and no extra markup.",
      config,
      sessionId ? { sessionId } : undefined,
    );
    recordAuxUsage(
      result.usage,
      "title",
      config.model || "unknown",
      config.provider || "unknown",
      sessionId ?? null,
    );
    const title = normalizeGeneratedTitle(result.text);
    if (!title && result.hasThinking) {
      logWarn(
        "[SessionTitle] Thinking model returned reasoning only — no usable title text",
      );
    }
    return title;
  } catch (error) {
    logWarn("[SessionTitle] pi-ai title generation failed:", error);
    return null;
  }
}
