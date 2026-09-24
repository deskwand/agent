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
      new FetchVaultCloudClient().putIndex(
        "token",
        "files",
        Buffer.from("index"),
      ),
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
      new FetchVaultCloudClient().putIndex(
        "token",
        "files",
        Buffer.from("index"),
      ),
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

  it("putIndex writes the scoped index key", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await new FetchVaultCloudClient().putIndex(
      "token",
      "skills",
      Buffer.from("index"),
    );

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/vault/index/skills");
  });

  it("getIndex reads the scoped index key", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new FetchVaultCloudClient().getIndex("token", "files"),
    ).resolves.toBeNull();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/vault/index/files");
  });
});
