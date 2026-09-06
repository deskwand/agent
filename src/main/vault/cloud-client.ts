import { DESKWAND_API_URL } from "../../shared/oauth-config";

export interface VaultCloudClient {
  putObject(token: string, objectId: string, payload: Buffer): Promise<void>;
  getObject(token: string, objectId: string): Promise<Buffer>;
  deleteObject(token: string, objectId: string): Promise<void>;
  getIndex(token: string): Promise<Buffer | null>;
  putIndex(token: string, payload: Buffer): Promise<void>;
  listObjectIds(token: string): Promise<string[]>;
}

export class FetchVaultCloudClient implements VaultCloudClient {
  async putObject(
    token: string,
    objectId: string,
    payload: Buffer,
  ): Promise<void> {
    await this.request(
      token,
      `/api/vault/objects/${encodeURIComponent(objectId)}`,
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

  async getIndex(token: string): Promise<Buffer | null> {
    try {
      const response = await this.request(token, "/api/vault/index", {});
      return Buffer.from(await response.arrayBuffer());
    } catch (error: unknown) {
      if (error instanceof VaultCloudError && error.status === 404) return null;
      throw error;
    }
  }

  async listObjectIds(token: string): Promise<string[]> {
    const response = await this.request(token, "/api/vault/objects", {});
    const payload: unknown = await response.json();
    if (!isObjectIdPayload(payload)) throw new Error("VAULT_BAD_OBJECT_LIST");
    return payload.object_ids;
  }

  async putIndex(token: string, payload: Buffer): Promise<void> {
    await this.request(token, "/api/vault/index", {
      method: "PUT",
      body: payload as unknown as BodyInit,
    });
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
      throw new VaultCloudError(response.status);
    }
    return response;
  }
}

export class VaultCloudError extends Error {
  constructor(readonly status: number) {
    super(`VAULT_CLOUD_HTTP_${status}`);
  }
}

function isObjectIdPayload(value: unknown): value is { object_ids: string[] } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { object_ids?: unknown };
  return (
    Array.isArray(candidate.object_ids) &&
    candidate.object_ids.every((id) => typeof id === "string")
  );
}
