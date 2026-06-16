import { createHash } from "node:crypto";

export interface PiSessionRuntimeSignatureInput {
  configProvider?: string;
  customProtocol?: string;
  modelProvider?: string;
  modelApi?: string;
  modelBaseUrl?: string;
  contextWindow?: number;
  maxTokens?: number;
  effectiveCwd?: string;
  apiKey?: string;
}

function normalizeText(value: string | undefined): string {
  return value?.trim() || "";
}

function fingerprintSecret(value: string | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  return createHash("sha256").update(normalized).digest("hex");
}

function normalizePositiveNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function buildPiSessionRuntimeSignature(
  input: PiSessionRuntimeSignatureInput,
): string {
  return JSON.stringify({
    configProvider: normalizeText(input.configProvider),
    customProtocol: normalizeText(input.customProtocol),
    modelProvider: normalizeText(input.modelProvider),
    modelApi: normalizeText(input.modelApi),
    modelBaseUrl: normalizeText(input.modelBaseUrl).replace(/\/+$/, ""),
    contextWindow: normalizePositiveNumber(input.contextWindow),
    maxTokens: normalizePositiveNumber(input.maxTokens),
    effectiveCwd: normalizeText(input.effectiveCwd),
    apiKeyFingerprint: fingerprintSecret(input.apiKey),
  });
}
