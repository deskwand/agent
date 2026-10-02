/**
 * @module main/config/provider-models
 *
 * Lists the models an endpoint actually offers. Used by the API settings
 * "connect and discover models" flow, and by the diagnostics auth step
 * (which is the same network call).
 */
import type { AppConfig } from "./config-store";
import type { ApiTestResult, CustomProtocolType } from "../../renderer/types";
import OpenAI from "openai";
import { Anthropic } from "@anthropic-ai/sdk";
import {
  normalizeAnthropicBaseUrl,
  normalizeOllamaBaseUrl,
  normalizeOpenAICompatibleBaseUrl,
  resolveOllamaCredentials,
  resolveOpenAICredentials,
  shouldAllowEmptyAnthropicApiKey,
  shouldUseAnthropicAuthToken,
} from "./auth-utils";
import { PROVIDER_PRESETS } from "./config-store";
import { DEFAULT_OLLAMA_BASE_URL } from "../../shared/ollama-base-url";
import { fetchOpenRouterModels } from "./openrouter-models";

export type ProviderModelsSource = "live" | "unsupported" | "error";

export type ProviderModelErrorType = NonNullable<ApiTestResult["errorType"]>;

export interface ProviderModelEntry {
  id: string;
  label: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: ("text" | "image")[];
}

export interface ListProviderModelsInput {
  provider: AppConfig["provider"];
  apiKey: string;
  baseUrl?: string;
  customProtocol?: CustomProtocolType;
}

export interface ListProviderModelsResult {
  ok: boolean;
  models: ProviderModelEntry[];
  source: ProviderModelsSource;
  /** 因非聊天模型被丢掉的条数，用于区分"端点返回 0 条"与"全被过滤" */
  filtered: number;
  error?: string;
  errorType?: ProviderModelErrorType;
}

/**
 * 非聊天模型家族。官方 /models 会把 embedding / TTS / 图像生成等一起返回，
 * 直接进模型菜单会把菜单灌满。
 */
const NON_CHAT_MODEL_RE =
  /(embed|embedding|tts|whisper|transcri|audio|realtime|moderation|dall-e|gpt-image|chatgpt-image|image|imagen|video|sora|veo|rerank|aqa|stable-diffusion|flux)/i;

const REQUEST_TIMEOUT_MS = 15000;
const LOCAL_ANTHROPIC_PLACEHOLDER_KEY = "sk-ant-local-proxy";

type ProtocolInput = Pick<
  ListProviderModelsInput,
  "provider" | "customProtocol"
>;

export function isChatModelId(id: string): boolean {
  return !NON_CHAT_MODEL_RE.test(id);
}

export function filterChatModels<T extends { id: string }>(
  models: T[],
): { models: T[]; filtered: number } {
  const kept = models.filter((model) => isChatModelId(model.id));
  return { models: kept, filtered: models.length - kept.length };
}

export function isOpenAICompatible(input: ProtocolInput): boolean {
  return (
    input.provider === "openai" ||
    input.provider === "deepseek" ||
    input.provider === "ollama" ||
    input.provider === "openrouter" ||
    input.provider === "opencode" ||
    input.provider === "opencode-go" ||
    (input.provider === "custom" && input.customProtocol === "openai")
  );
}

export function isAnthropicCompatible(input: ProtocolInput): boolean {
  return (
    input.provider === "anthropic" ||
    (input.provider === "custom" && input.customProtocol === "anthropic")
  );
}

export function isGeminiProtocol(input: ProtocolInput): boolean {
  return (
    input.provider === "gemini" ||
    (input.provider === "custom" && input.customProtocol === "gemini")
  );
}

export function resolveClientBaseUrl(
  input: Pick<
    ListProviderModelsInput,
    "provider" | "customProtocol" | "baseUrl"
  >,
): string | undefined {
  const raw = input.baseUrl?.trim();

  if (input.provider === "ollama") {
    return normalizeOllamaBaseUrl(raw || DEFAULT_OLLAMA_BASE_URL);
  }

  if (isOpenAICompatible(input)) {
    if (raw) return normalizeOpenAICompatibleBaseUrl(raw);
    if (input.provider === "custom") return undefined;
    return normalizeOpenAICompatibleBaseUrl(
      (PROVIDER_PRESETS as unknown as Record<string, { baseUrl?: string }>)[
        input.provider
      ]?.baseUrl,
    );
  }

  if (isAnthropicCompatible(input)) {
    if (raw) return normalizeAnthropicBaseUrl(raw);
    if (input.provider === "custom") return undefined;
    return normalizeAnthropicBaseUrl(
      (PROVIDER_PRESETS as unknown as Record<string, { baseUrl?: string }>)[
        input.provider
      ]?.baseUrl,
    );
  }

  return raw || undefined;
}

export function makeAnthropicClient(opts: {
  effectiveKey: string;
  useAuthToken: boolean;
  baseUrl: string | undefined;
}): Anthropic {
  const base = { baseURL: opts.baseUrl, timeout: REQUEST_TIMEOUT_MS };
  return opts.useAuthToken
    ? new Anthropic({ ...base, authToken: opts.effectiveKey })
    : new Anthropic({ ...base, apiKey: opts.effectiveKey });
}

function readApiError(err: unknown): { status?: number; message: string } {
  const status =
    typeof (err as { status?: unknown })?.status === "number"
      ? (err as { status: number }).status
      : undefined;
  const message = err instanceof Error ? err.message : String(err);
  return { status, message };
}

function classifyError(err: unknown): {
  errorType: ProviderModelErrorType;
  error: string;
} {
  const { status, message } = readApiError(err);
  if (status === 401 || status === 403) {
    return { errorType: "unauthorized", error: message };
  }
  if (status === 429) {
    return { errorType: "rate_limited", error: message };
  }
  if (typeof status === "number" && status >= 500) {
    return { errorType: "server_error", error: message };
  }
  if (
    /enotfound|econnrefused|etimedout|eai_again|enetunreach|fetch failed|network/i.test(
      message,
    )
  ) {
    return { errorType: "network_error", error: message };
  }
  return { errorType: "unknown", error: message };
}

function missingKeyResult(): ListProviderModelsResult {
  return {
    ok: false,
    models: [],
    source: "error",
    filtered: 0,
    error: "No API key provided",
    errorType: "missing_key",
  };
}

function unsupportedResult(): ListProviderModelsResult {
  return { ok: true, models: [], source: "unsupported", filtered: 0 };
}

function errorResult(err: unknown): ListProviderModelsResult {
  const classified = classifyError(err);
  return {
    ok: false,
    models: [],
    source: "error",
    filtered: 0,
    error: classified.error,
    errorType: classified.errorType,
  };
}

async function listOpenAICompatible(
  input: ListProviderModelsInput,
): Promise<ListProviderModelsResult> {
  const clientBaseUrl = resolveClientBaseUrl(input);
  const resolved =
    input.provider === "ollama"
      ? resolveOllamaCredentials({
          provider: input.provider,
          customProtocol: input.customProtocol,
          apiKey: input.apiKey,
          baseUrl: clientBaseUrl,
        })
      : resolveOpenAICredentials({
          provider: input.provider,
          customProtocol: input.customProtocol,
          apiKey: input.apiKey,
          baseUrl: clientBaseUrl,
        });

  if (!resolved?.apiKey) {
    return missingKeyResult();
  }

  try {
    const client = new OpenAI({
      apiKey: resolved.apiKey,
      baseURL: resolved.baseUrl || clientBaseUrl,
      timeout: REQUEST_TIMEOUT_MS,
    });
    const raw: ProviderModelEntry[] = [];
    for await (const model of await client.models.list()) {
      const id = typeof model.id === "string" ? model.id.trim() : "";
      if (!id) continue;
      raw.push({ id, label: id });
    }
    const { models, filtered } = filterChatModels(raw);
    return { ok: true, models, source: "live", filtered };
  } catch (err) {
    if (readApiError(err).status === 404) {
      return unsupportedResult();
    }
    return errorResult(err);
  }
}

async function listAnthropic(
  input: ListProviderModelsInput,
): Promise<ListProviderModelsResult> {
  const clientBaseUrl = resolveClientBaseUrl(input);
  const allowEmpty = shouldAllowEmptyAnthropicApiKey({
    provider: input.provider,
    customProtocol: input.customProtocol,
    baseUrl: clientBaseUrl,
  });
  const effectiveKey =
    input.apiKey.trim() || (allowEmpty ? LOCAL_ANTHROPIC_PLACEHOLDER_KEY : "");

  if (!effectiveKey) {
    return missingKeyResult();
  }

  try {
    const client = makeAnthropicClient({
      effectiveKey,
      useAuthToken: shouldUseAnthropicAuthToken({
        provider: input.provider,
        customProtocol: input.customProtocol,
        apiKey: effectiveKey,
      }),
      baseUrl: clientBaseUrl,
    });
    const raw: ProviderModelEntry[] = [];
    for await (const model of await client.models.list()) {
      const id = typeof model.id === "string" ? model.id.trim() : "";
      if (!id) continue;
      const displayName = (model as { display_name?: unknown }).display_name;
      const label =
        typeof displayName === "string" && displayName.trim()
          ? displayName.trim()
          : id;
      raw.push({ id, label });
    }
    const { models, filtered } = filterChatModels(raw);
    return { ok: true, models, source: "live", filtered };
  } catch (err) {
    if (readApiError(err).status === 404) {
      return unsupportedResult();
    }
    return errorResult(err);
  }
}

async function listGemini(
  input: ListProviderModelsInput,
): Promise<ListProviderModelsResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    return missingKeyResult();
  }

  try {
    const { GoogleGenAI } =
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports
      (await import("@google/genai")) as typeof import("@google/genai");
    const clientBaseUrl = resolveClientBaseUrl(input);
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        ...(clientBaseUrl ? { baseUrl: clientBaseUrl } : {}),
        timeout: REQUEST_TIMEOUT_MS,
      },
    });

    const raw: ProviderModelEntry[] = [];
    let filteredByAction = 0;
    const pager = await client.models.list({ config: { pageSize: 200 } });
    for await (const model of pager) {
      const name = typeof model.name === "string" ? model.name.trim() : "";
      if (!name) continue;
      const id = name.replace(/^models\//, "");
      const actions = Array.isArray(model.supportedActions)
        ? model.supportedActions
        : undefined;
      if (
        actions &&
        actions.length > 0 &&
        !actions.includes("generateContent")
      ) {
        filteredByAction += 1;
        continue;
      }
      const displayName =
        typeof model.displayName === "string" ? model.displayName.trim() : "";
      const entry: ProviderModelEntry = { id, label: displayName || id };
      if (typeof model.inputTokenLimit === "number") {
        entry.contextWindow = model.inputTokenLimit;
      }
      if (typeof model.outputTokenLimit === "number") {
        entry.maxTokens = model.outputTokenLimit;
      }
      raw.push(entry);
    }

    const { models, filtered } = filterChatModels(raw);
    return {
      ok: true,
      models,
      source: "live",
      filtered: filtered + filteredByAction,
    };
  } catch (err) {
    if (readApiError(err).status === 404) {
      return unsupportedResult();
    }
    return errorResult(err);
  }
}

async function listFromOpenRouterCatalogue(): Promise<ListProviderModelsResult> {
  try {
    const result = await fetchOpenRouterModels();
    const raw: ProviderModelEntry[] = result.models.map((model) => ({
      id: model.id,
      label: model.label || model.id,
      ...(typeof model.contextWindow === "number"
        ? { contextWindow: model.contextWindow }
        : {}),
      ...(typeof model.maxTokens === "number"
        ? { maxTokens: model.maxTokens }
        : {}),
      ...(Array.isArray(model.input) ? { input: model.input } : {}),
    }));
    const { models, filtered } = filterChatModels(raw);
    // 公开目录拉取失败时 fetchOpenRouterModels 会回落静态预设（usedFallback），
    // 那不是"端点返回的真实列表"，所以按 unsupported 处理，让上层回落内置目录。
    return result.usedFallback
      ? { ...unsupportedResult(), models, filtered }
      : { ok: true, models, source: "live", filtered };
  } catch (err) {
    return errorResult(err);
  }
}

export async function listProviderModels(
  input: ListProviderModelsInput,
): Promise<ListProviderModelsResult> {
  if (input.provider === "openrouter") {
    return await listFromOpenRouterCatalogue();
  }
  // 注：ollama 走下面的 OpenAI 兼容分支（即它的 /v1/models），与本模块引入前
  // 的诊断认证步行为完全一致；连接流程不会走到 ollama。
  if (isGeminiProtocol(input)) {
    return await listGemini(input);
  }
  if (isAnthropicCompatible(input)) {
    return await listAnthropic(input);
  }
  if (isOpenAICompatible(input)) {
    return await listOpenAICompatible(input);
  }
  return unsupportedResult();
}
