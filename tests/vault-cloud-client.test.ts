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

  it("parses the reported usage payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ usedBytes: 1536, quotaBytes: 104857600 }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      new FetchVaultCloudClient().getUsage("token"),
    ).resolves.toEqual({ usedBytes: 1536, quotaBytes: 104857600 });
  });

  it("accepts a usage payload without a quota", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ usedBytes: 10, quotaBytes: null }), {
            status: 200,
          }),
      ),
    );

    await expect(
      new FetchVaultCloudClient().getUsage("token"),
    ).resolves.toEqual({ usedBytes: 10, quotaBytes: null });
  });

  it("rejects a malformed usage payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ used: 1 }), { status: 200 }),
      ),
    );

    await expect(new FetchVaultCloudClient().getUsage("token")).rejects.toThrow(
      "VAULT_BAD_USAGE",
    );
  });
});
