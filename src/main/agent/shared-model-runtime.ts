import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { app } from "electron";
import { join } from "node:path";

let sharedModelRuntimePromise: Promise<ModelRuntime> | undefined;

export function getAuthPath(): string {
  return join(app.getPath("userData"), "auth.json");
}

export function getSharedModelRuntime(): Promise<ModelRuntime> {
  sharedModelRuntimePromise ??= ModelRuntime.create({
    authPath: getAuthPath(),
    modelsPath: null,
    allowModelNetwork: false,
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
