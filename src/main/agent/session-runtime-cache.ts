import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createAuthCredentialStore } from "./auth-credential-store";

/**
 * Per-session ModelRuntime 实例缓存。
 *
 * 每个 pi session 持有独立的 ModelRuntime 实例：setRuntimeApiKey 写入的
 * 内存 override 互不泄漏，避免某个 profile 的 key（如占位值）覆盖其他
 * 会话所用 provider 的有效 key，导致请求携带错误凭证（401）。
 */
export async function getOrCreateSessionRuntime<T>(
  cache: Map<string, T>,
  sessionId: string,
  create: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(sessionId);
  if (existing) {
    return existing;
  }
  const created = await create();
  cache.set(sessionId, created);
  return created;
}

/**
 * 默认的 ModelRuntime 工厂：与共享实例（getSharedModelRuntime）参数一致，
 * 仅实例不同。authPath 由调用方从 Electron 环境解析后传入。
 */
export function createSessionModelRuntime(
  authPath: string,
): Promise<ModelRuntime> {
  return ModelRuntime.create({
    authPath,
    modelsPath: null,
    allowModelNetwork: false,
    credentials: createAuthCredentialStore(authPath),
  });
}
