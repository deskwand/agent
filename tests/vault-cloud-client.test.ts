import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FetchVaultCloudClient,
  VaultCloudError,
} from "../src/main/vault/cloud-client";

describe("FetchVaultCloudClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves the server error code from a failed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "VAULT_QUOTA_EXCEEDED",
                message: "Vault quota exceeded",
              },
            }),
            { status: 413 },
          ),
      ),
    );

    await expect(
      new FetchVaultCloudClient().putIndex("token", Buffer.from("index")),
    ).rejects.toMatchObject({
      status: 413,
      code: "VAULT_QUOTA_EXCEEDED",
    });
  });

  it("falls back to the HTTP status for a legacy error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("service unavailable", { status: 503 })),
    );

    await expect(
      new FetchVaultCloudClient().putIndex("token", Buffer.from("index")),
    ).rejects.toEqual(new VaultCloudError(503));
  });
});
