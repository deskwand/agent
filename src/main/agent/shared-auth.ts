import {
  AuthStorage,
  ModelRegistry,
  type OAuthCredential,
} from "@earendil-works/pi-coding-agent";
import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { app } from "electron";
import { join } from "path";

// Singleton — safe because Electron main process is single-threaded.
// AuthStorage.create() is synchronous, so no async race possible.
let sharedAuthStorage: AuthStorage | null = null;

export function getSharedAuthStorage(): AuthStorage {
  if (!sharedAuthStorage) {
    const userDataPath = app.getPath("userData");
    sharedAuthStorage = AuthStorage.create(join(userDataPath, "auth.json"));
  }
  return sharedAuthStorage;
}

const TOKEN_REFRESH_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

function extractJwtIat(token: string): number | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    return typeof payload.iat === "number" ? payload.iat : undefined;
  } catch {
    return undefined;
  }
}

const pendingRefreshes = new Map<string, Promise<string | undefined>>();

/**
 * Get an OAuth API key, refreshing the token if it was issued more than
 * an hour ago. This catches server-side token revocation that the SDK's
 * timestamp-only expiry check would miss.
 *
 * Concurrent calls for the same provider share a single refresh.
 */
export async function ensureFreshOAuthToken(
  providerId: string,
): Promise<string | undefined> {
  const pending = pendingRefreshes.get(providerId);
  if (pending) return pending;

  const promise = doEnsureFresh(providerId);
  pendingRefreshes.set(providerId, promise);
  try {
    return await promise;
  } finally {
    pendingRefreshes.delete(providerId);
  }
}

async function doEnsureFresh(providerId: string): Promise<string | undefined> {
  const authStorage = getSharedAuthStorage();
  const providers = authStorage.getOAuthProviders();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return undefined;

  const cred = authStorage.get(providerId);
  if (cred?.type !== "oauth") return undefined;

  // Still fresh — use as-is
  const iat = extractJwtIat(cred.access);
  if (iat && Date.now() - iat * 1000 < TOKEN_REFRESH_THRESHOLD_MS) {
    return provider.getApiKey(cred);
  }

  // Stale (or can't parse iat) — refresh
  const oauthCred: OAuthCredentials = {
    refresh: cred.refresh,
    access: cred.access,
    expires: cred.expires,
  };
  for (const [k, v] of Object.entries(cred)) {
    if (!["type", "refresh", "access", "expires"].includes(k)) {
      (oauthCred as Record<string, unknown>)[k] = v;
    }
  }

  try {
    const refreshed = await provider.refreshToken(oauthCred);
    const newCred: OAuthCredential = { type: "oauth", ...refreshed };
    authStorage.set(providerId, newCred);
    return provider.getApiKey(refreshed);
  } catch {
    // Refresh failed — fall back to existing token
    return provider.getApiKey(oauthCred);
  }
}

export { AuthStorage, ModelRegistry };
