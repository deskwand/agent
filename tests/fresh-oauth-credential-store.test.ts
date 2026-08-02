import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFreshOAuthCredentialStore } from "../src/main/agent/fresh-oauth-credential-store";

// Mock pi-ai providers so refresh can be observed without network.
vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinProviders: vi.fn(),
}));

import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

const refreshMock = vi.fn();
const builtinProvidersMock = vi.mocked(builtinProviders);

function makeToken(iat: number): string {
  const payload = Buffer.from(
    JSON.stringify({ iat, iss: "https://auth.openai.com" }),
  ).toString("base64url");
  return `header.${payload}.sig`;
}

function makeCred(iat: number, accessTail = "abc"): Record<string, unknown> {
  return {
    type: "oauth",
    access: makeToken(iat),
    refresh: `rt.${accessTail}`,
    expires: Date.now() + 7 * 24 * 3600 * 1000,
    accountId: "acc-1",
  };
}

describe("createFreshOAuthCredentialStore", () => {
  let dir: string;
  let authPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fresh-oauth-"));
    authPath = join(dir, "auth.json");
    refreshMock.mockReset();
    builtinProvidersMock.mockReturnValue([
      {
        id: "openai-codex",
        auth: {
          oauth: {
            refresh: refreshMock,
          },
        },
      },
    ] as never);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a fresh token as-is without refreshing", async () => {
    const store = createFreshOAuthCredentialStore(authPath);
    await store.modify(
      "openai-codex",
      async () => makeCred(Math.floor(Date.now() / 1000) - 60) as never,
    );

    const cred = await store.read("openai-codex");

    expect(refreshMock).not.toHaveBeenCalled();
    expect(cred?.type).toBe("oauth");
  });

  it("refreshes a token issued more than an hour ago and persists it", async () => {
    const store = createFreshOAuthCredentialStore(authPath);
    await store.modify(
      "openai-codex",
      async () => makeCred(Math.floor(Date.now() / 1000) - 2 * 3600) as never,
    );

    const refreshed = makeCred(Math.floor(Date.now() / 1000), "newtail");
    refreshMock.mockResolvedValue(refreshed);

    const cred = await store.read("openai-codex");

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(cred?.access).toBe(refreshed.access);
    // Persisted back to auth.json
    const onDisk = JSON.parse(readFileSync(authPath, "utf-8"));
    expect(onDisk["openai-codex"].access).toBe(refreshed.access);
    // A second read sees the refreshed token as fresh
    refreshMock.mockClear();
    const again = await store.read("openai-codex");
    expect(refreshMock).not.toHaveBeenCalled();
    expect(again?.access).toBe(refreshed.access);
  });

  it("falls back to the existing token when refresh fails", async () => {
    const store = createFreshOAuthCredentialStore(authPath);
    const stale = makeCred(Math.floor(Date.now() / 1000) - 3 * 3600, "stale");
    await store.modify("openai-codex", async () => stale as never);
    refreshMock.mockRejectedValue(new Error("network down"));

    const cred = await store.read("openai-codex");

    expect(cred?.access).toBe(stale.access);
  });

  it("passes non-oauth credentials through untouched", async () => {
    const store = createFreshOAuthCredentialStore(authPath);
    await store.modify(
      "deepseek",
      async () => ({ type: "api_key", key: "sk-test" }) as never,
    );

    const cred = await store.read("deepseek");

    expect(refreshMock).not.toHaveBeenCalled();
    expect(cred).toEqual({ type: "api_key", key: "sk-test" });
  });

  it("deduplicates concurrent refreshes for the same provider", async () => {
    const store = createFreshOAuthCredentialStore(authPath);
    await store.modify(
      "openai-codex",
      async () => makeCred(Math.floor(Date.now() / 1000) - 2 * 3600) as never,
    );
    refreshMock.mockResolvedValue(
      makeCred(Math.floor(Date.now() / 1000), "dedupe"),
    );

    const [a, b] = await Promise.all([
      store.read("openai-codex"),
      store.read("openai-codex"),
    ]);

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(a?.access).toBe(b?.access);
  });

  it("keeps the stored credential when modify returns undefined (SDK concurrency semantics)", async () => {
    const store = createFreshOAuthCredentialStore(authPath);
    const cred = makeCred(Math.floor(Date.now() / 1000) - 3600, "keep");
    await store.modify("openai-codex", async () => cred as never);

    // 并发刷新竞态：另一路径已刷新，fn 返回 undefined 表示"不写入"
    const result = await store.modify("openai-codex", async () => undefined);

    expect(result).toEqual(cred);
    const onDisk = JSON.parse(readFileSync(authPath, "utf-8"));
    expect(onDisk["openai-codex"].access).toBe(cred.access);
  });
});
