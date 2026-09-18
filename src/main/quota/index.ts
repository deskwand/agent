import { ipcMain } from "electron";
import type { QuotaSnapshot } from "../../shared/quota";
import { resolveProviderApiKey } from "../agent/shared-model-runtime";
import { log } from "../utils/logger";
import { fetchCodexQuota } from "./codex";

/** 打开面板时的重复点击保护窗口。Claude 适配器进来时必须收紧（设计文档 §5.3）。 */
export const QUOTA_CACHE_TTL_MS = 60_000;

/**
 * providerId → 取额度的方法。**键即白名单**：不在表里就不查凭据、不打网络。
 * 这张表回答的是「能查什么额度」，与登录白名单（oauth-service 的
 * SUPPORTED_OAUTH_PROVIDERS，回答「能登录什么」）是两个语义，不要合并。
 */
const ADAPTERS: Record<
  string,
  (token: string) => Promise<QuotaSnapshot | null>
> = {
  "openai-codex": fetchCodexQuota,
};

interface CacheEntry {
  snapshot: QuotaSnapshot;
  fetchedAt: number;
}

/** 只缓存成功结果；失败不写，避免「失败粘 60 秒」挡住自愈。 */
const cache = new Map<string, CacheEntry>();
/** providerId → 在途请求，用来把并发调用合并成一次真实抓取。 */
const inflight = new Map<string, Promise<QuotaSnapshot | null>>();

export async function fetchQuotaSnapshot(
  providerId: string,
): Promise<QuotaSnapshot | null> {
  const adapter = ADAPTERS[providerId];
  if (!adapter) return null;

  const cached = cache.get(providerId);
  if (cached && Date.now() - cached.fetchedAt < QUOTA_CACHE_TTL_MS) {
    return cached.snapshot;
  }

  const pending = inflight.get(providerId);
  if (pending) return pending;

  const request = (async () => {
    const token = await resolveProviderApiKey(providerId);
    if (!token) return null;
    return adapter(token);
  })().catch((error: unknown) => {
    log("[Quota] 抓取失败:", providerId, error);
    return null;
  });

  const tracked = request
    .then((snapshot) => {
      if (snapshot) cache.set(providerId, { snapshot, fetchedAt: Date.now() });
      return snapshot;
    })
    .finally(() => {
      inflight.delete(providerId);
    });

  inflight.set(providerId, tracked);
  return tracked;
}

export function initQuotaIpc(): void {
  ipcMain.handle("quota.get", (_event, providerId: string) =>
    fetchQuotaSnapshot(providerId),
  );
}
