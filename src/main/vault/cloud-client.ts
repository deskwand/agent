import { DESKWAND_API_URL } from "../../shared/oauth-config";
import type { VaultBackupUsage } from "../../shared/vault";

export type VaultIndexScope = "files" | "skills";

export interface VaultCloudClient {
  putObject(
    token: string,
    scope: VaultIndexScope,
    objectId: string,
    payload: Buffer,
  ): Promise<void>;
  getObject(token: string, objectId: string): Promise<Buffer>;
  deleteObject(token: string, objectId: string): Promise<void>;
  getIndex(token: string, scope: VaultIndexScope): Promise<Buffer | null>;
  putIndex(
    token: string,
    scope: VaultIndexScope,
    payload: Buffer,
  ): Promise<void>;
  listObjectIds(token: string, scope: VaultIndexScope): Promise<string[]>;
  getUsage?(token: string): Promise<VaultBackupUsage>;
}

export class FetchVaultCloudClient implements VaultCloudClient {
  async putObject(
    token: string,
    scope: VaultIndexScope,
    objectId: string,
    payload: Buffer,
  ): Promise<void> {
    await this.request(
      token,
      `/api/vault/objects/${encodeURIComponent(objectId)}?scope=${scope}`,
      {
        method: "PUT",
        body: payload as unknown as BodyInit,
      },
    );
  }

  async getObject(token: string, objectId: string): Promise<Buffer> {
    const response = await this.request(
      token,
      `/api/vault/objects/${encodeURIComponent(objectId)}`,
      {},
    );
    return Buffer.from(await response.arrayBuffer());
  }

  async deleteObject(token: string, objectId: string): Promise<void> {
    await this.request(
      token,
      `/api/vault/objects/${encodeURIComponent(objectId)}`,
      { method: "DELETE" },
    );
  }

  async getIndex(
    token: string,
    scope: VaultIndexScope,
  ): Promise<Buffer | null> {
    try {
      const response = await this.request(
        token,
        `/api/vault/index/${scope}`,
        {},
      );
      return Buffer.from(await response.arrayBuffer());
    } catch (error: unknown) {
      if (error instanceof VaultCloudError && error.status === 404) return null;
      throw error;
    }
  }

  async listObjectIds(
    token: string,
    scope: VaultIndexScope,
  ): Promise<string[]> {
    const response = await this.request(
      token,
      `/api/vault/objects?scope=${scope}`,
      {},
    );
    const payload: unknown = await response.json();
    if (!isObjectIdPayload(payload)) throw new Error("VAULT_BAD_OBJECT_LIST");
    return payload.object_ids;
  }

  async putIndex(
    token: string,
    scope: VaultIndexScope,
    payload: Buffer,
  ): Promise<void> {
    await this.request(token, `/api/vault/index/${scope}`, {
      method: "PUT",
      body: payload as unknown as BodyInit,
    });
  }

  async getUsage(token: string): Promise<VaultBackupUsage> {
    const response = await this.request(token, "/api/vault/usage", {});
    const payload: unknown = await response.json();
    if (!isBackupUsagePayload(payload)) throw new Error("VAULT_BAD_USAGE");
    return payload;
  }

  private async request(
    token: string,
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const response = await fetch(`${DESKWAND_API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        ...init.headers,
      },
    });
    if (!response.ok) {
      let code: string | undefined;
      try {
        const body: unknown = await response.clone().json();
        if (isCloudErrorPayload(body)) code = body.error.code;
      } catch {
        // Legacy/non-JSON error responses use the HTTP status fallback.
      }
      throw new VaultCloudError(response.status, code);
    }
    return response;
  }
}

export class VaultCloudError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(code ?? `VAULT_CLOUD_HTTP_${status}`);
  }
}

function isCloudErrorPayload(
  value: unknown,
): value is { error: { code: string } } {
  if (!value || typeof value !== "object") return false;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return false;
  return typeof (error as { code?: unknown }).code === "string";
}

function isObjectIdPayload(value: unknown): value is { object_ids: string[] } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { object_ids?: unknown };
  return (
    Array.isArray(candidate.object_ids) &&
    candidate.object_ids.every((id) => typeof id === "string")
  );
}

function isBackupUsagePayload(value: unknown): value is VaultBackupUsage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { usedBytes?: unknown; quotaBytes?: unknown };
  const quota = candidate.quotaBytes;
  return (
    isNonNegativeNumber(candidate.usedBytes) &&
    (quota === null || isNonNegativeNumber(quota))
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
