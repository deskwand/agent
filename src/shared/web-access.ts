export const WEB_SEARCH_PROVIDERS = [
  "auto",
  "openai",
  "exa",
  "brave",
  "parallel",
  "tavily",
  "perplexity",
  "gemini",
] as const;

export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number];
export type WebAccessAuthProvider = "openai" | "gemini";
export type WebAccessCredentialSource = "inherit" | "dedicated";

export interface WebAccessCredential {
  source: WebAccessCredentialSource;
  profileKey: string;
  apiKey: string;
  baseUrl: string;
}

export interface WebAccessConfig {
  defaultProvider: WebSearchProvider;
  openai: WebAccessCredential;
  gemini: WebAccessCredential;
  exaApiKey: string;
  braveApiKey: string;
  parallelApiKey: string;
  tavilyApiKey: string;
  perplexityApiKey: string;
}

export type WebAccessErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "AUTHENTICATION_FAILED"
  | "RATE_LIMITED"
  | "REQUEST_TIMEOUT"
  | "FETCH_BLOCKED"
  | "CONTENT_TOO_LARGE"
  | "UNSUPPORTED_CONTENT"
  | "CACHE_MISS"
  | "CACHE_EXPIRED"
  | "SELECTOR_NOT_FOUND"
  | "CANCELLED";

export interface WebAccessToolDetails {
  responseId?: string;
  provider?: Exclude<WebSearchProvider, "auto">;
  errorCode?: WebAccessErrorCode;
  queryCount?: number;
  urlCount?: number;
  successful?: number;
  totalChars?: number;
  truncated?: boolean;
}

export const DEFAULT_WEB_ACCESS_CONFIG: WebAccessConfig = {
  defaultProvider: "auto",
  openai: { source: "inherit", profileKey: "", apiKey: "", baseUrl: "" },
  gemini: { source: "inherit", profileKey: "", apiKey: "", baseUrl: "" },
  exaApiKey: "",
  braveApiKey: "",
  parallelApiKey: "",
  tavilyApiKey: "",
  perplexityApiKey: "",
};

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function toString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCredential(value: unknown): WebAccessCredential {
  const record = toRecord(value);
  return {
    source: record.source === "dedicated" ? "dedicated" : "inherit",
    profileKey: toString(record.profileKey),
    apiKey: toString(record.apiKey),
    baseUrl: toString(record.baseUrl),
  };
}

function normalizeProvider(value: unknown): WebSearchProvider {
  return WEB_SEARCH_PROVIDERS.find((provider) => provider === value) ?? "auto";
}

export function normalizeWebAccessConfig(raw: unknown): WebAccessConfig {
  const value = toRecord(raw);
  return {
    defaultProvider: normalizeProvider(value.defaultProvider),
    openai: normalizeCredential(value.openai),
    gemini: normalizeCredential(value.gemini),
    exaApiKey: toString(value.exaApiKey),
    braveApiKey: toString(value.braveApiKey),
    parallelApiKey: toString(value.parallelApiKey),
    tavilyApiKey: toString(value.tavilyApiKey),
    perplexityApiKey: toString(value.perplexityApiKey),
  };
}

export const MAX_WEB_SEARCH_QUERIES = 10;
export const MAX_WEB_ACCESS_URLS = 10;
export const MAX_WEB_ACCESS_DOMAIN_FILTERS = 20;
export const MAX_WEB_ACCESS_QUERY_LENGTH = 4_000;
export const MAX_WEB_ACCESS_URL_LENGTH = 8_192;
export const MAX_WEB_ACCESS_DOMAIN_LENGTH = 253;
