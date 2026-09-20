import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

import {
  EXCHANGE_RATE_TTL_MS,
  getExchangeRates,
  warmExchangeRateCache,
} from "../../main/usage/exchange-rate";

const FRANKFURTER_URL =
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,EUR,JPY,GBP,HKD";
const NOW = 1_800_000_000_000;

const mockFetch = vi.fn();
let dir = "";
let cachePath = "";

function frankfurterResponse(rates: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ amount: 1, base: "USD", date: "2026-09-18", rates }),
  };
}

function writeCache(rates: Record<string, number>, fetchedAt: number) {
  fs.writeFileSync(
    cachePath,
    JSON.stringify({ base: "USD", rates, fetchedAt }),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(join(os.tmpdir(), "deskwand-rate-"));
  cachePath = join(dir, "exchange-rate.json");
  // vitest.config.mts 的 mockReset: true 会在每个用例前清掉实现，这里重装
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("getExchangeRates", () => {
  it("fetches once and caches the five convertible rates", async () => {
    mockFetch.mockResolvedValue(
      frankfurterResponse({
        CNY: 7.1,
        EUR: 0.92,
        JPY: 157,
        GBP: 0.78,
        HKD: 7.8,
        XXX: 1,
      }),
    );

    const rates = await getExchangeRates(cachePath, NOW);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(FRANKFURTER_URL);
    expect(rates).toEqual({
      CNY: 7.1,
      EUR: 0.92,
      JPY: 157,
      GBP: 0.78,
      HKD: 7.8,
    });
    expect(JSON.parse(fs.readFileSync(cachePath, "utf-8"))).toEqual({
      base: "USD",
      rates: { CNY: 7.1, EUR: 0.92, JPY: 157, GBP: 0.78, HKD: 7.8 },
      fetchedAt: NOW,
    });
  });

  it("returns null and writes nothing when the network fails", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));

    await expect(getExchangeRates(cachePath, NOW)).resolves.toBeNull();
    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it("returns null on a non-200 response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ rates: {} }),
    });

    await expect(getExchangeRates(cachePath, NOW)).resolves.toBeNull();
  });

  it("returns null on a malformed body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ nope: true }),
    });

    await expect(getExchangeRates(cachePath, NOW)).resolves.toBeNull();
  });

  it("omits a currency the source did not report instead of inventing one", async () => {
    mockFetch.mockResolvedValue(frankfurterResponse({ CNY: 7.1, EUR: 0.92 }));

    const rates = await getExchangeRates(cachePath, NOW);

    expect(rates?.CNY).toBe(7.1);
    expect(rates).not.toHaveProperty("JPY");
  });

  it("serves a fresh cache without touching the network", async () => {
    writeCache({ CNY: 7.1 }, NOW - 3 * 60 * 60 * 1000);

    const rates = await getExchangeRates(cachePath, NOW);

    expect(rates).toEqual({ CNY: 7.1 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("re-fetches a stale cache, and falls back to null when that fails too", async () => {
    writeCache({ CNY: 7.1 }, NOW - EXCHANGE_RATE_TTL_MS - 1000);
    mockFetch.mockRejectedValue(new Error("offline"));

    await expect(getExchangeRates(cachePath, NOW)).resolves.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("re-fetches a stale cache and overwrites it on success", async () => {
    writeCache({ CNY: 6.9 }, NOW - EXCHANGE_RATE_TTL_MS - 1000);
    mockFetch.mockResolvedValue(frankfurterResponse({ CNY: 7.1 }));

    const rates = await getExchangeRates(cachePath, NOW);

    expect(rates).toEqual({ CNY: 7.1 });
    expect(JSON.parse(fs.readFileSync(cachePath, "utf-8")).fetchedAt).toBe(NOW);
  });

  it("treats a corrupt cache file as absent", async () => {
    fs.writeFileSync(cachePath, "not json");
    mockFetch.mockResolvedValue(frankfurterResponse({ CNY: 7.1 }));

    const rates = await getExchangeRates(cachePath, NOW);

    expect(rates).toEqual({ CNY: 7.1 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("treats a future fetchedAt (clock skew) as fresh", async () => {
    writeCache({ CNY: 7.1 }, NOW + 60 * 60 * 1000);

    const rates = await getExchangeRates(cachePath, NOW);

    expect(rates).toEqual({ CNY: 7.1 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("treats a cached file with no usable rates as absent", async () => {
    // 一次坏响应写过空缓存后，接下来 24h 不能直接命中 `{}` 而永远不再重试
    writeCache({}, NOW - 60 * 60 * 1000);
    mockFetch.mockResolvedValue(frankfurterResponse({ CNY: 7.1 }));

    const rates = await getExchangeRates(cachePath, NOW);

    expect(rates).toEqual({ CNY: 7.1 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null instead of an empty cache when the source reports nothing usable", async () => {
    mockFetch.mockResolvedValue(frankfurterResponse({ XXX: 1 }));

    await expect(getExchangeRates(cachePath, NOW)).resolves.toBeNull();
    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it("aborts a hung request after 8 seconds", async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(new Error("AbortError")),
            );
          }),
      );

      const pending = getExchangeRates(cachePath, NOW);
      const [, init] = mockFetch.mock.calls[0] as [
        string,
        { signal: AbortSignal },
      ];
      expect(init.signal).toBeInstanceOf(AbortSignal);
      await vi.advanceTimersByTimeAsync(8_000);

      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the 24h TTL as a constant", () => {
    // 防手动验证时临时改小 TTL 后误提交（同 telemetry 心跳的守卫）
    expect(EXCHANGE_RATE_TTL_MS).toBe(86_400_000);
  });
});

describe("warmExchangeRateCache", () => {
  it("fetches on startup and swallows failures", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));

    warmExchangeRateCache(cachePath);
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    // 内部的 .catch 吞掉了拒绝：用例没有未处理异常即通过
  });
});
