import { API_PROVIDER_PRESETS } from "../../shared/api-model-presets";
import type { OpenRouterModelsResult } from "../../shared/ipc-types";

type FetchLike = typeof fetch;

type OpenRouterPricing = Record<string, string | undefined>;

interface OpenRouterModelRecord {
  id: string;
  name?: string;
  context_length?: number;
  top_provider?: {
    max_completion_tokens?: number;
  };
  architecture?: {
    input_modalities?: string[];
  };
  pricing?: OpenRouterPricing;
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModelRecord[];
}

export function isOpenRouterFreeModel(
  pricing: OpenRouterPricing = {},
): boolean {
  const prompt = pricing.prompt;
  const completion = pricing.completion;
  return prompt === "0" && completion === "0";
}

function toModelInput(
  modalities?: string[],
): Array<"text" | "image"> | undefined {
  if (!Array.isArray(modalities)) return undefined;
  const inputs = modalities.filter(
    (modality): modality is "text" | "image" =>
      modality === "text" || modality === "image",
  );
  return inputs.length ? inputs : undefined;
}

function shapeModel(record: OpenRouterModelRecord) {
  const isFree = isOpenRouterFreeModel(record.pricing);
  const displayName = record.name?.trim() || record.id;
  return {
    id: record.id,
    label: isFree ? `${displayName} (Free)` : displayName,
    source: "preset" as const,
    contextWindow: record.context_length,
    maxTokens: record.top_provider?.max_completion_tokens,
    input: toModelInput(record.architecture?.input_modalities),
  };
}

function compareModels(
  left: OpenRouterModelRecord,
  right: OpenRouterModelRecord,
): number {
  const leftFree = isOpenRouterFreeModel(left.pricing);
  const rightFree = isOpenRouterFreeModel(right.pricing);
  if (leftFree !== rightFree) {
    return leftFree ? -1 : 1;
  }
  return (left.name || left.id).localeCompare(right.name || right.id);
}

export function getOpenRouterFallbackModels(): OpenRouterModelsResult["models"] {
  return API_PROVIDER_PRESETS.openrouter.models.map((model) => ({
    id: model.id,
    label: model.name,
    source: "preset" as const,
  }));
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const FETCH_TIMEOUT_MS = 15_000;

export async function fetchOpenRouterModels(
  fetchImpl: FetchLike = fetch,
): Promise<OpenRouterModelsResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetchImpl(OPENROUTER_MODELS_URL, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorMsg = `OpenRouter models request failed: HTTP ${response.status}`;
      console.error("[OpenRouterModels]", errorMsg);
      return {
        models: getOpenRouterFallbackModels(),
        usedFallback: true,
        error: errorMsg,
      };
    }

    const payload = (await response.json()) as OpenRouterModelsResponse;
    const records = Array.isArray(payload.data)
      ? payload.data.filter((record): record is OpenRouterModelRecord =>
          Boolean(record?.id),
        )
      : [];

    if (records.length === 0) {
      const errorMsg = "OpenRouter models API returned an empty list";
      console.error("[OpenRouterModels]", errorMsg);
      return {
        models: getOpenRouterFallbackModels(),
        usedFallback: true,
        error: errorMsg,
      };
    }

    const models = [...records].sort(compareModels).map(shapeModel);
    console.log(
      `[OpenRouterModels] Fetched ${models.length} models (${models.filter((m) => m.label.includes("(Free)")).length} free)`,
    );
    return {
      models,
      usedFallback: false,
    };
  } catch (err) {
    const errorMsg =
      err instanceof Error
        ? `OpenRouter models fetch error: ${err.message}`
        : `OpenRouter models fetch error: ${String(err)}`;
    console.error("[OpenRouterModels]", errorMsg);
    return {
      models: getOpenRouterFallbackModels(),
      usedFallback: true,
      error: errorMsg,
    };
  }
}
