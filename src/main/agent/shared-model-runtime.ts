import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { app } from "electron";
import { join } from "node:path";
import { createFreshOAuthCredentialStore } from "./fresh-oauth-credential-store";
import { logWarn } from "../utils/logger";

let sharedModelRuntimePromise: Promise<ModelRuntime> | undefined;

/** 会话级 ModelRuntime 实例集合，供登出等全局凭证失效操作遍历清理。 */
const sessionModelRuntimes = new Set<ModelRuntime>();

export function registerSessionModelRuntime(runtime: ModelRuntime): void {
  sessionModelRuntimes.add(runtime);
}

export function unregisterSessionModelRuntime(runtime: ModelRuntime): void {
  sessionModelRuntimes.delete(runtime);
}

export async function invalidateSessionRuntimeApiKeys(
  providerId: string,
): Promise<void> {
  await Promise.allSettled(
    [...sessionModelRuntimes].map(async (runtime) => {
      try {
        await runtime.removeRuntimeApiKey(providerId);
      } catch (error: unknown) {
        logWarn(
          "[ModelRuntime] Failed to invalidate session runtime key:",
          providerId,
          error,
        );
      }
    }),
  );
}

export function getAuthPath(): string {
  return join(app.getPath("userData"), "auth.json");
}

export function getSharedModelRuntime(): Promise<ModelRuntime> {
  sharedModelRuntimePromise ??= ModelRuntime.create({
    authPath: getAuthPath(),
    modelsPath: null,
    allowModelNetwork: false,
    credentials: createFreshOAuthCredentialStore(getAuthPath()),
  }).catch((error: unknown) => {
    sharedModelRuntimePromise = undefined;
    throw error;
  });
  return sharedModelRuntimePromise;
}

export async function resolveProviderApiKey(
  providerId: string,
): Promise<string | undefined> {
  const runtime = await getSharedModelRuntime();
  const resolved = await runtime.getAuth(providerId);
  return resolved?.auth.apiKey;
}
