import { ipcMain } from "electron";
import type { QuotaSnapshot } from "../../shared/quota";
import { resolveProviderApiKey } from "../agent/shared-model-runtime";
import { log } from "../utils/logger";
import { fetchCodexQuota } from "./codex";

/** 打开面板时的重复点击保护窗口。Claude 适配器进来时必须收紧（设计文档 §5.3）。 */
export const QUOTA_CACHE_TTL_MS = 60_000;

/**
 * 失败回落的最长陈旧度：超过它就不再用旧快照兜底，宁可整块不显示。
 *
 * 没有这个上限时，凭据永久失效（refresh 抛错、或凭证被撤销但没走登出）会让面板
 * **无期限**显示最后一次成功的数据，且与实时数据无法区分——「接口抖一下」与
 * 「这条路已经废了」在代码里分辨不出来，所以只按时间设界。
 */
export const STALE_FALLBACK_MAX_MS = 15 * 60_000;

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

/** 缓存代次：clearQuotaCache() 时 +1，用来拦住「清理之前就已出发」的在飞请求写回。 */
let cacheGeneration = 0;

/**
 * 登录态变化后调用：清掉缓存与在途条目，避免已登出账号的数字继续被读到。
 */
export function clearQuotaCache(): void {
  cacheGeneration += 1;
  cache.clear();
  // 在途条目也必须清：否则后来者会复用一个「登出前出发」的 promise，
  // 直接拿到已登出账号的数据——且它因代次不匹配不会被缓存，连兜底都没有。
  inflight.clear();
}

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

  const startedGeneration = cacheGeneration;

  const request = (async () => {
    const token = await resolveProviderApiKey(providerId);
    if (!token) return null;
    return adapter(token);
  })().catch((error: unknown) => {
    log("[Quota] 抓取失败:", providerId, error);
    return null;
  });

  const tracked = request.then((snapshot) => {
    // 只写「本次清理之后」出发的请求结果：清理前出发的即使落地也不写回。
    if (snapshot && startedGeneration === cacheGeneration) {
      cache.set(providerId, { snapshot, fetchedAt: Date.now() });
    }
    return snapshot;
  });

  inflight.set(providerId, tracked);

  // 比对身份再删：clearQuotaCache() 可能已把整表清空并让后来者写入新条目，
  // 这时这次删除不能误删别人的在途条目。
  // 用 `return` 而不是 `void`：链在返回值上，**首个调用方** await 到结果时 inflight 清理已跑完；
  // 后来的 joiner 从表里拿到的是 `tracked` 本身，清理早于它们的续体只因 finally 反应是同步注册的。
  // 注意：`inflight` 里存的是 `tracked`（不是这个 finally 包装），所以别拿
  // `result === inflight.get(id)` 做去重判断——那恒为 false。
  return tracked.finally(() => {
    if (inflight.get(providerId) === tracked) inflight.delete(providerId);
  });
}

/**
 * 取所有「有适配器」通道的额度快照，用于面板并列展示。
 *
 * 不枚举凭据、不筛凭据类型：`fetchQuotaSnapshot` 内部已用 resolveProviderApiKey
 * 处理「没有凭据 → null」，两者在用户可见行为上零差别，
 * 却省掉 getSharedModelRuntime 与一层筛选（以及它在整模块 mock 下静默失效的风险）。
 */
/** 上一次成功的快照，但只在够新的情况下才作为失败回落使用（见 STALE_FALLBACK_MAX_MS）。 */
function staleFallback(providerId: string): QuotaSnapshot | null {
  const entry = cache.get(providerId);
  if (!entry) return null;
  return Date.now() - entry.fetchedAt < STALE_FALLBACK_MAX_MS
    ? entry.snapshot
    : null;
}

export async function listQuotaSnapshots(): Promise<QuotaSnapshot[]> {
  // 适配器表的键就是「谁会显示」的唯一真相来源，顺序即展示顺序。
  // 不另立 DISPLAY_ORDER 常量：那会把同一份知识复制到第二处。
  // JS 对象的字符串键保序，可靠。
  const ids = Object.keys(ADAPTERS);

  // fetchQuotaSnapshot 内部已 catch，**永不 reject**（设计文档 §3.3），
  // 所以这里用 all 而非 allSettled；结果顺序与 ids 一致。
  const snapshots = await Promise.all(
    ids.map(
      async (id) =>
        (await fetchQuotaSnapshot(id)) ??
        // 失败回落：本次没拿到，但有**够新**的上一次成功快照就先用它，
        // 避免面板因一次 500 而塌掉。**不写入缓存、不刷新 fetchedAt**，所以下次仍会重试网络。
        // 为什么不放在 fetchQuotaSnapshot 的 catch 里：那里回落的旧快照是 truthy，
        // 会被上面的写入分支重新盖上时间戳，反而让失败粘住 60s。
        staleFallback(id) ??
        null,
    ),
  );

  return snapshots.filter((s): s is QuotaSnapshot => s !== null);
}

export function initQuotaIpc(): void {
  ipcMain.handle("quota.list", () => listQuotaSnapshots());
}
