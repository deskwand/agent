/**
 * 汇率：用量页把 USD 金额折算成用户选的显示货币。
 *
 * 源：frankfurter（ECB 每日参考汇率，原 .app 项目停服后的 .dev 续作）。选源与测速
 * 记录见 design-docs/2026-09-20-usage-currency-design.md §1。
 *
 * 静默原则：任何失败都不打扰用户 —— 取不到就是 null，渲染层回退美元显示，不加脚注。
 * 缓存 24h：新鲜缓存不发请求；过期则 fetch，失败即 null。因为"新鲜就不发请求"，
 * 所以"fetch 失败但缓存 ≤24h 时用缓存"这一分支天然被覆盖，不需要单独写。
 *
 * 本模块不 import electron：缓存路径由调用方传入，测试不需要 mock 主进程。
 */
import fs from "node:fs";

import type { CurrencyCode, ExchangeRates } from "../../shared/usage";

const FRANKFURTER_URL =
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,EUR,JPY,GBP,HKD";

/** 缓存有效期：24h。frankfurter 每天发布一次 ECB 价，多取无意义。 */
export const EXCHANGE_RATE_TTL_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 8_000;

/** 可折算的币种（USD 不需要汇率）。 */
const CONVERTIBLE: ReadonlyArray<Exclude<CurrencyCode, "USD">> = [
  "CNY",
  "EUR",
  "JPY",
  "GBP",
  "HKD",
];

function pickRates(raw: unknown): ExchangeRates {
  if (!raw || typeof raw !== "object") return {};
  const rates: ExchangeRates = {};
  for (const code of CONVERTIBLE) {
    const value = (raw as Record<string, unknown>)[code];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      rates[code] = value;
    }
  }
  return rates;
}

function readCache(cachePath: string, now: number): ExchangeRates | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
      fetchedAt?: unknown;
      rates?: unknown;
    };
    if (typeof parsed.fetchedAt !== "number") return null;
    // 时钟回拨 / fetchedAt 在未来：年龄取 0（视为新鲜），不特殊处理
    const age = Math.max(0, now - parsed.fetchedAt);
    if (age > EXCHANGE_RATE_TTL_MS) return null;
    const rates = pickRates(parsed.rates);
    // 空 rates 也视同无缓存：否则一次坏响应写进 `{}` 后，接下来 24h 都直接命中
    // 这个空对象，永远显示美元、再也不重试
    return Object.keys(rates).length > 0 ? rates : null;
  } catch {
    return null; // 文件损坏 = 无缓存
  }
}

function writeCache(
  cachePath: string,
  rates: ExchangeRates,
  fetchedAt: number,
): void {
  try {
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ base: "USD", rates, fetchedAt }),
    );
  } catch {
    // 缓存写不进（磁盘/权限）：只是下次还要重新 fetch，不影响本次结果
  }
}

export async function fetchExchangeRates(): Promise<ExchangeRates | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(FRANKFURTER_URL, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const parsed = (await response.json()) as { rates?: unknown };
    const rates = pickRates(parsed.rates);
    // 一个币种都没拿到 = 这次响应不可用，返回 null 而不是写一个空缓存
    return Object.keys(rates).length > 0 ? rates : null;
  } catch {
    return null; // 超时（AbortError）、断网、非法 JSON —— 全部视同取不到
  } finally {
    clearTimeout(timer);
  }
}

export async function getExchangeRates(
  cachePath: string,
  now: number,
): Promise<ExchangeRates | null> {
  const cached = readCache(cachePath, now);
  if (cached) return cached;
  const fresh = await fetchExchangeRates();
  if (fresh) writeCache(cachePath, fresh, now);
  return fresh;
}

/** 启动预热：把网络延迟花在用户打开用量页之前；失败静默。 */
export function warmExchangeRateCache(cachePath: string): void {
  void getExchangeRates(cachePath, Date.now()).catch(() => {});
}
