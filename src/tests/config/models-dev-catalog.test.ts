import { beforeEach, describe, expect, it, vi } from "vitest";

const logWarnMock = vi.hoisted(() => vi.fn());
vi.mock("../../main/utils/logger", () => ({ logWarn: logWarnMock }));

import {
  __resetModelsDevCatalogForTests,
  ensureModelsDevCatalog,
  getModelsDevContextWindow,
  parseModelsDevCatalog,
} from "../../main/config/models-dev-catalog";

const PAYLOAD = {
  "opencode-go": {
    models: {
      "minimax-m3.1-flash-free": {
        id: "minimax-m3.1-flash-free",
        limit: { context: 1000000, output: 512000 },
        modalities: { input: ["text", "image", "video"], output: ["text"] },
      },
      "no-limit": { id: "no-limit" },
      "string-limit": { id: "string-limit", limit: { context: "1000000" } },
    },
  },
  opencode: {
    models: {
      "minimax-m3": { id: "minimax-m3", limit: { context: 512000 } },
      broken: null,
    },
  },
  empty: { models: {} },
};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function fetchOnce(): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl = vi.fn(async () => {
    calls += 1;
    return okResponse(PAYLOAD);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

describe("parseModelsDevCatalog", () => {
  it("maps limit.context onto each model", () => {
    const catalog = parseModelsDevCatalog(PAYLOAD);
    expect(catalog.get("opencode-go")?.get("minimax-m3.1-flash-free")).toBe(
      1000000,
    );
    expect(catalog.get("opencode")?.get("minimax-m3")).toBe(512000);
  });

  it("drops entries without a usable numeric context window", () => {
    const catalog = parseModelsDevCatalog(PAYLOAD);
    expect(catalog.get("opencode-go")?.has("no-limit")).toBe(false);
    expect(catalog.get("opencode-go")?.has("string-limit")).toBe(false);
    expect(catalog.has("empty")).toBe(false);
    expect(catalog.get("opencode")?.has("broken")).toBe(false);
  });

  it("returns an empty map for junk payloads", () => {
    for (const junk of [null, undefined, 42, "nope", [], {}]) {
      expect(parseModelsDevCatalog(junk).size).toBe(0);
    }
  });
});

describe("ensureModelsDevCatalog", () => {
  beforeEach(() => {
    __resetModelsDevCatalogForTests();
    logWarnMock.mockReset();
  });

  it("fetches once and exposes the snapshot synchronously", async () => {
    const { fetchImpl, calls } = fetchOnce();
    await expect(ensureModelsDevCatalog({ fetchImpl })).resolves.toBe(true);
    expect(calls()).toBe(1);
    expect(
      getModelsDevContextWindow("opencode-go", "minimax-m3.1-flash-free"),
    ).toBe(1000000);
    expect(getModelsDevContextWindow("opencode-go", "nope")).toBeUndefined();
    expect(
      getModelsDevContextWindow("other-provider", "minimax-m3"),
    ).toBeUndefined();
  });

  it("identifies itself with a user agent", async () => {
    const fetchImpl = vi.fn(async () => okResponse(PAYLOAD)) as unknown as {
      (input: string, init?: RequestInit): Promise<Response>;
      mock: { calls: Array<[string, RequestInit | undefined]> };
    };
    await ensureModelsDevCatalog({ fetchImpl: fetchImpl as typeof fetch });
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      "User-Agent": "deskwand",
    });
  });

  it("bounds a joining caller by its own timeout", async () => {
    let release: ((response: Response) => void) | undefined;
    const hanging = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ) as unknown as typeof fetch;

    const warmup = ensureModelsDevCatalog({
      fetchImpl: hanging,
      timeoutMs: 10_000,
    });
    const startedAt = Date.now();
    const joined = await ensureModelsDevCatalog({
      fetchImpl: hanging,
      timeoutMs: 500,
    });
    const elapsed = Date.now() - startedAt;

    // 启动预热的 15s 预算不得传染给正在发第一条消息的会话
    expect(joined).toBe(false);
    expect(elapsed).toBeLessThan(2000);

    release?.(okResponse(PAYLOAD));
    await expect(warmup).resolves.toBe(true);
    expect(
      getModelsDevContextWindow("opencode-go", "minimax-m3.1-flash-free"),
    ).toBe(1000000);
  });

  it("does not refetch inside the TTL and refetches when forced", async () => {
    let now = 1_000_000;
    const { fetchImpl, calls } = fetchOnce();
    await ensureModelsDevCatalog({ fetchImpl, now: () => now });
    now += 60_000;
    await expect(
      ensureModelsDevCatalog({ fetchImpl, now: () => now }),
    ).resolves.toBe(true);
    expect(calls()).toBe(1);
    await ensureModelsDevCatalog({ fetchImpl, now: () => now, force: true });
    expect(calls()).toBe(2);
  });

  it("shares one request between concurrent callers", async () => {
    const { fetchImpl, calls } = fetchOnce();
    const results = await Promise.all([
      ensureModelsDevCatalog({ fetchImpl }),
      ensureModelsDevCatalog({ fetchImpl }),
      ensureModelsDevCatalog({ fetchImpl }),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(calls()).toBe(1);
  });

  it("keeps the previous snapshot when a refresh fails", async () => {
    const { fetchImpl } = fetchOnce();
    await ensureModelsDevCatalog({ fetchImpl });
    const failing = vi.fn(async () => {
      throw new Error("ENOTFOUND models.dev");
    }) as unknown as typeof fetch;
    await expect(
      ensureModelsDevCatalog({ fetchImpl: failing, force: true }),
    ).resolves.toBe(false);
    expect(
      getModelsDevContextWindow("opencode-go", "minimax-m3.1-flash-free"),
    ).toBe(1000000);
    expect(logWarnMock).toHaveBeenCalled();
  });

  it("treats non-2xx, empty and malformed payloads as failure", async () => {
    const cases: Array<() => Response> = [
      () => ({ ok: false, status: 503, json: async () => ({}) }) as Response,
      () => okResponse({}),
      () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token <");
          },
        }) as unknown as Response,
    ];
    for (const body of cases) {
      __resetModelsDevCatalogForTests();
      const fetchImpl = vi.fn(body) as unknown as typeof fetch;
      await expect(ensureModelsDevCatalog({ fetchImpl })).resolves.toBe(false);
      expect(
        getModelsDevContextWindow("opencode-go", "minimax-m3.1-flash-free"),
      ).toBeUndefined();
    }
  });

  it("backs off after a failure instead of retrying every call", async () => {
    let now = 1_000_000;
    let calls = 0;
    const failing = vi.fn(async () => {
      calls += 1;
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await ensureModelsDevCatalog({ fetchImpl: failing, now: () => now });
    now += 5_000;
    await ensureModelsDevCatalog({ fetchImpl: failing, now: () => now });
    expect(calls).toBe(1);
  });
});
