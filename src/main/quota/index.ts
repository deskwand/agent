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

/**
 * 取所有「有适配器」通道的额度快照，用于面板并列展示。
 *
 * 不枚举凭据、不筛凭据类型：`fetchQuotaSnapshot` 内部已用 resolveProviderApiKey
 * 处理「没有凭据 → null」，两者在用户可见行为上零差别，
 * 却省掉 getSharedModelRuntime 与一层筛选（以及它在整模块 mock 下静默失效的风险）。
 */
export async function listQuotaSnapshots(): Promise<QuotaSnapshot[]> {
  // 适配器表的键就是「谁会显示」的唯一真相来源，顺序即展示顺序。
  // 不另立 DISPLAY_ORDER 常量：那会把同一份知识复制到第二处。
  // JS 对象的字符串键保序，可靠。
  const ids = Object.keys(ADAPTERS);

  // fetchQuotaSnapshot 内部已 catch，**永不 reject**（设计文档 §3.3），
  // 所以这里用 all 而非 allSettled；结果顺序与 ids 一致。
  const snapshots = await Promise.all(ids.map((id) => fetchQuotaSnapshot(id)));

  return snapshots.filter((s): s is QuotaSnapshot => s !== null);
}

export function initQuotaIpc(): void {
  ipcMain.handle("quota.list", () => listQuotaSnapshots());
}
