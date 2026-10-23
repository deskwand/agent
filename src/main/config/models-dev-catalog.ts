/**
 * @module main/config/models-dev-catalog
 *
 * models.dev 是 opencode 与 pi-ai 目录的共同上游。opencode 自家 /models 只返回
 * id，注册表快照又落后于端点（例如 minimax-m3.1-flash-free 目前只存在于端点
 * 和 models.dev），所以端点独有模型的上下文窗口只能从这里补。
 *
 * 约束：
 * - 永不抛错；失败时保留上一次快照，由调用方回落原行为
 * - 进程内单飞 + TTL + 失败退避，避免每个会话各发一次请求
 * - 只保留 provider/model → limit.context 的映射，不缓存原始 payload
 */
import { logWarn } from "../utils/logger";

/** provider → model → contextWindow */
export type ModelsDevCatalog = Map<string, Map<string, number>>;

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const MODELS_DEV_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const FAILURE_BACKOFF_MS = 60_000;
const USER_AGENT = "deskwand";

let snapshot: ModelsDevCatalog | null = null;
let fetchedAt = 0;
let lastFailureAt = 0;
let inflight: Promise<boolean> | null = null;

function toContextWindow(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

export function parseModelsDevCatalog(payload: unknown): ModelsDevCatalog {
  const catalog: ModelsDevCatalog = new Map();
  if (!payload || typeof payload !== "object") return catalog;
  for (const [providerId, provider] of Object.entries(
    payload as Record<string, unknown>,
  )) {
    const models = (provider as { models?: unknown } | null)?.models;
    if (!models || typeof models !== "object") continue;
    const byModel = new Map<string, number>();
    for (const [modelId, raw] of Object.entries(
      models as Record<string, unknown>,
    )) {
      const limit = (raw as { limit?: { context?: unknown } } | null)?.limit;
      const contextWindow = toContextWindow(limit?.context);
      if (contextWindow) byModel.set(modelId, contextWindow);
    }
    if (byModel.size > 0) catalog.set(providerId, byModel);
  }
  return catalog;
}

export function getModelsDevContextWindow(
  providerId: string,
  modelId: string,
): number | undefined {
  return snapshot?.get(providerId)?.get(modelId);
}

export async function ensureModelsDevCatalog(
  options: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    force?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const now = options.now ?? Date.now;
  const timeoutMs = Math.max(500, options.timeoutMs ?? FETCH_TIMEOUT_MS);
  if (!options.force && snapshot && now() - fetchedAt < MODELS_DEV_TTL_MS) {
    return true;
  }
  if (
    !options.force &&
    lastFailureAt &&
    now() - lastFailureAt < FAILURE_BACKOFF_MS
  ) {
    return false;
  }
  // 单飞：加入别人的请求时也必须服从**本调用方**的上限，否则启动预热的
  // 15s 预算会传染给正在发第一条消息的会话。
  if (inflight) return waitForCatalog(inflight, timeoutMs);

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  inflight = (async () => {
    try {
      const response = await fetchImpl(MODELS_DEV_URL, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseModelsDevCatalog(await response.json());
      if (parsed.size === 0) throw new Error("empty catalog");
      snapshot = parsed;
      fetchedAt = now();
      lastFailureAt = 0;
      return true;
    } catch (error) {
      lastFailureAt = now();
      logWarn(
        "[ModelsDev] Failed to load catalog:",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();

  return waitForCatalog(inflight, timeoutMs);
}

/** 等一个已在飞行的请求，但最多只等调用方给的时间。 */
function waitForCatalog(
  pending: Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const settle = (value: boolean) => {
      clearTimeout(timer);
      resolve(value);
    };
    pending.then(settle, () => settle(false));
  });
}

export function __resetModelsDevCatalogForTests(): void {
  snapshot = null;
  fetchedAt = 0;
  lastFailureAt = 0;
  inflight = null;
}
