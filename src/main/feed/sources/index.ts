/**
 * @module main/feed/sources/index
 *
 * 源的统一取数入口：每个源一次请求，谁失败不影响谁。
 *
 * fetchText 是注入的 —— 超时、体积上限归调用方（main/index.ts），
 * 所以这个文件能整条用夹具跑测试。源 URL 全是 catalog 里的常量，
 * 没有用户或模型输入进得来，因此这里不需要 SSRF 校验。
 */
import pLimit from "p-limit";

import { logWarn } from "../../utils/logger";
import { SOURCES, type SourceItem, type SourceSpec } from "./catalog";

export type FetchText = (url: string) => Promise<string | null>;

export interface SourceBucket {
  id: string;
  items: SourceItem[];
}

/** 20 个源一次全发会撞上对面站的连接上限，分小批更稳。 */
const SOURCE_CONCURRENCY = 6;

/**
 * 整批源的总预算。20 个源 / 并发 6 ≈ 4 波，而每一波都可能挂满单源超时 ——
 * 没有这一层，一次网络不好就能让 collect 阶段白等 30 秒以上（搜索早就回来了）。
 */
export const SOURCE_TOTAL_BUDGET_MS = 20_000;

export async function fetchSourceBuckets(input: {
  fetchText: FetchText;
}): Promise<SourceBucket[]> {
  const limit = pLimit(SOURCE_CONCURRENCY);
  const buckets: SourceBucket[] = [];
  const pending = SOURCES.map((spec) =>
    limit(async () => {
      buckets.push(await fetchOneSource(spec, input.fetchText));
    }),
  );

  // 超预算就带着已经回来的那些先走；还在飞的那几个不再等。
  let timer: ReturnType<typeof setTimeout> | null = null;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SOURCE_TOTAL_BUDGET_MS);
  });
  try {
    await Promise.race([Promise.all(pending), budget]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return buckets;
}

async function fetchOneSource(
  spec: SourceSpec,
  fetchText: FetchText,
): Promise<SourceBucket> {
  try {
    const body = await fetchText(spec.url);
    if (body === null) return { id: spec.id, items: [] };
    const parsed = spec.parse(body);
    if (parsed === null) {
      // 200 但不是这个源能认的东西（反爬页）——不是错误，是这次没内容
      logWarn("[feed] source not recognized:", spec.id);
      return { id: spec.id, items: [] };
    }
    return {
      id: spec.id,
      items: parsed
        .filter((item) => item.title && item.url)
        .slice(0, spec.maxItems),
    };
  } catch (error) {
    // 单源失败只丢自己，不改 run 状态
    logWarn("[feed] source failed:", spec.id, error);
    return { id: spec.id, items: [] };
  }
}

export interface TextFetcherOptions {
  timeoutMs: number;
  maxBytes: number;
}

/**
 * 字节上限：实测最大的源是 leiphone（863 KB），再往上留足够余量。
 *
 * **超限一律丢弃这个源，绝不返回半截正文** —— 截断的 XML 交给解析器只会
 * 得到一个「解析失败」，结果是这个源静默地永远产出 0 条，比报错难查得多。
 */
export const SOURCE_MAX_BYTES = 4 * 1024 * 1024;
export const SOURCE_TIMEOUT_MS = 8000;

/**
 * 把「取一个 URL 的文本」包成 FetchText：超时与字节上限都在这里。
 * 不设 User-Agent：实测 20 个源在 undici 的默认 UA 下全部 200 且返回真内容，
 * 没必要多维护一份与 extract.ts 重复的浏览器 UA。
 */
export function createTextFetcher(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  options: TextFetcherOptions,
): FetchText {
  return async (url: string): Promise<string | null> => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: { accept: "*/*" },
      });
    } catch (error) {
      logWarn("[feed] source request failed:", url, error);
      return null;
    }
    if (!response.ok) {
      // 静默丢弃会让「某个源常年 0 条」查不出来
      logWarn("[feed] source not ok:", url, response.status);
      return null;
    }

    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      logWarn("[feed] source too large:", url, declared);
      return null;
    }

    const text = await response.text();
    if (text.length > options.maxBytes) {
      logWarn("[feed] source too large:", url, text.length);
      return null;
    }
    return text;
  };
}
