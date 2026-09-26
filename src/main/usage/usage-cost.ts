/**
 * 参考成本：查价索引、分档定价、逐条归集。
 *
 * 价目表来自 pi-ai 注册表（USD / 1M tokens），**不读** provider 上报的 Usage.cost：
 * 订阅制 OAuth 会上报未实际扣费的金额，自定义 relay 走 synthetic model 时恒为 0。
 * 设计文档：design-docs/2026-09-20-usage-cost-design.md
 */

import type { ModelCost, ModelCostRates } from "@earendil-works/pi-ai";
import { getModels, getProviders } from "@earendil-works/pi-ai/compat";
import type { UsageTokens } from "../../shared/usage";
import {
  MODEL_PEAK_PRICING,
  MODEL_PRICE_OVERRIDES,
  type PeakRates,
} from "./model-price-overrides";

export interface UsageCostRow extends UsageTokens {
  ts: number;
  provider: string | null;
  model: string | null;
}

/**
 * 四张表分开存，查找顺序就是优先级：
 * 覆盖精确 → 内置精确 → 覆盖通配 → 内置模型兜底。
 * 合成一张表表达不了这个顺序（覆盖表要同时压过内置的精确键与兜底键）。
 */
export interface PriceIndex {
  overrideExact: Map<string, ModelCost>;
  registryExact: Map<string, ModelCost>;
  overrideWildcard: Map<string, ModelCost>;
  registryModel: Map<string, ModelCost>;
  /** 键是**裸模型 id**（表键剥掉 `*|` 前缀）：计划不区分 provider，故只需一张表。 */
  plans: Map<string, PeakRates>;
}

/** 查价键与归集键共用的唯一构造函数；键即覆盖表里写的那个字符串。 */
export function providerModelKey(
  provider: string | null,
  model: string | null,
): string {
  return `${provider ?? ""}|${model ?? ""}`;
}

/**
 * 负价是上游的哨兵值（实测 openrouter/auto 按本机用量算出 -$3.1e8），当成无价目；
 * 0 是合法的免费模型价，照常参与计算。
 */
function isUsableCost(cost: ModelCost | undefined): cost is ModelCost {
  if (!cost) return false;
  return (
    cost.input >= 0 &&
    cost.output >= 0 &&
    cost.cacheRead >= 0 &&
    cost.cacheWrite >= 0
  );
}

export function buildPriceIndex(
  registry: Iterable<{ provider: string; id: string; cost: ModelCost }>,
  overrides: Record<string, ModelCost>,
  peakPlans: Record<string, PeakRates> = {},
): PriceIndex {
  const index: PriceIndex = {
    overrideExact: new Map(),
    registryExact: new Map(),
    overrideWildcard: new Map(),
    registryModel: new Map(),
    plans: new Map(),
  };

  for (const [key, cost] of Object.entries(overrides)) {
    if (!isUsableCost(cost)) continue;
    const separator = key.indexOf("|");
    if (separator < 0) continue;
    const provider = key.slice(0, separator);
    const model = key.slice(separator + 1);
    if (!model) continue;
    if (provider === "*") index.overrideWildcard.set(model, cost);
    else index.overrideExact.set(providerModelKey(provider, model), cost);
  }

  for (const entry of registry) {
    if (!isUsableCost(entry.cost)) continue;
    index.registryExact.set(
      providerModelKey(entry.provider, entry.id),
      entry.cost,
    );
    // 同一模型跨 provider 时取第一个命中的：遍历顺序确定，兜底结果可复现
    if (!index.registryModel.has(entry.id)) {
      index.registryModel.set(entry.id, entry.cost);
    }
  }

  for (const [key, rates] of Object.entries(peakPlans)) {
    // 不以 `*|` 开头的键（含写坏的键）静默丢弃，与覆盖表对坏键的处理一致；
    // 全表必须以 `*|` 开头这条由单测钉住，免得丢弃变成静默缺陷。
    const model = key.startsWith("*|") ? key.slice(2) : "";
    if (!model) continue;
    index.plans.set(model, rates);
  }

  return index;
}

export function resolveModelCost(
  index: PriceIndex,
  provider: string | null,
  model: string | null,
): ModelCost | null {
  if (!model) return null;
  const key = providerModelKey(provider, model);
  return (
    index.overrideExact.get(key) ??
    index.registryExact.get(key) ??
    index.overrideWildcard.get(model) ??
    index.registryModel.get(model) ??
    null
  );
}

/**
 * 分档判定：阈值比较的是**单次请求**的 prompt 大小（input + cacheRead + cacheWrite），
 * 与 pi-ai 的 calculateCost 同语义；多个档位都满足时取阈值最大的那档。
 */
export function ratesFor(
  cost: ModelCost,
  promptTokens: number,
): ModelCostRates {
  let rates: ModelCostRates = cost;
  let matched = -1;
  for (const tier of cost.tiers ?? []) {
    if (
      promptTokens > tier.inputTokensAbove &&
      tier.inputTokensAbove > matched
    ) {
      rates = tier;
      matched = tier.inputTokensAbove;
    }
  }
  return rates;
}

export function costOfTokens(
  rates: ModelCostRates,
  tokens: UsageTokens,
): number {
  return (
    (rates.input * tokens.input +
      rates.output * tokens.output +
      rates.cacheRead * tokens.cacheRead +
      rates.cacheWrite * tokens.cacheWrite) /
    1_000_000
  );
}

/**
 * 逐条定价。分档按单次请求判定，所以必须一条一条算：先按 (供应商, 模型) 聚合再套价，
 * 实测偏差 +64%（design §4）。
 */
export function costOfRecord(
  index: PriceIndex,
  row: UsageCostRow,
): number | null {
  // 计划命中即取代价目表，不再走优先级链
  const plan = index.plans.get(row.model ?? "");
  if (plan) {
    // 计划值不含 tiers，所以刻意不调用 ratesFor
    return costOfTokens(isPeakAt(row.ts) ? plan.peak : plan.offPeak, row);
  }

  const cost = resolveModelCost(index, row.provider, row.model);
  if (!cost) return null;
  const promptTokens = row.input + row.cacheRead + row.cacheWrite;
  return costOfTokens(ratesFor(cost, promptTokens), row);
}

function readRegistry(): Array<{
  provider: string;
  id: string;
  cost: ModelCost;
}> {
  const entries: Array<{ provider: string; id: string; cost: ModelCost }> = [];
  for (const provider of getProviders()) {
    for (const model of getModels(provider)) {
      // 用注册表的 provider id 建键：它就是写进 usage_records.provider 的那个字符串
      // （实测 1,354 个模型里 model.provider 与它 100% 一致）
      entries.push({ provider, id: model.id, cost: model.cost });
    }
  }
  return entries;
}

let cachedIndex: PriceIndex | null = null;

/**
 * 首次查询时建一次索引，之后复用（不碰 DB、不碰 Electron，测试可注入自己的索引）。
 *
 * 缓存不失效是安全的，前提是**注册表在启动后不再变**：数据来自 pi-ai 的静态生成
 * 模块。若将来允许运行期往 pi-ai 注册表里注册新 provider，这里必须跟着失效。
 */
export function loadPriceIndex(): PriceIndex {
  if (!cachedIndex) {
    cachedIndex = buildPriceIndex(
      readRegistry(),
      MODEL_PRICE_OVERRIDES,
      MODEL_PEAK_PRICING,
    );
  }
  return cachedIndex;
}

/**
 * 本地日期键，格式与 SQL 的 `date(ts / 1000, 'unixepoch', 'localtime')` **逐字符一致**
 * （YYYY-MM-DD，零填充）。归集在 JS、聚合在 SQL，两侧日界不一致会把同一天拆成两行。
 */
export function localDateKey(ts: number): string {
  const day = new Date(ts);
  const year = day.getFullYear();
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

export interface UsageCostAggregate {
  /** 区间内合计（`ts >= cutoff`）。 */
  total: number;
  /** 全部区间逐日金额，供热力图（它不随区间变）；键即 localDateKey。 */
  byDay: Map<string, number>;
  /** 区间内按 (供应商, 模型) 的金额；无价目为 null。 */
  byModel: Map<string, number | null>;
}

/**
 * 逐条定价后归集。
 *
 * 定价只取决于 (供应商, 模型)，所以同一个模型组的记录要么全部有价、要么全部无价 ——
 * 用两个临时容器（金额累加 Map + 无价目 Set）拼出结果，避免在 Map 里做
 * "null 覆盖 0 / 0 覆盖 null" 这类顺序相关的判断。
 */
export function aggregateCosts(
  rows: UsageCostRow[],
  cutoff: number,
  index: PriceIndex,
): UsageCostAggregate {
  const byDay = new Map<string, number>();
  const costByModel = new Map<string, number>();
  const unpricedModels = new Set<string>();
  let total = 0;

  for (const row of rows) {
    const cost = costOfRecord(index, row);
    if (cost !== null) {
      const day = localDateKey(row.ts);
      byDay.set(day, (byDay.get(day) ?? 0) + cost);
    }
    if (row.ts < cutoff) continue;
    const key = providerModelKey(row.provider, row.model);
    if (cost === null) {
      unpricedModels.add(key);
      continue;
    }
    costByModel.set(key, (costByModel.get(key) ?? 0) + cost);
    total += cost;
  }

  const byModel = new Map<string, number | null>();
  for (const key of unpricedModels) byModel.set(key, null);
  for (const [key, cost] of costByModel) byModel.set(key, cost);

  return { total, byDay, byModel };
}

/**
 * DeepSeek 峰谷时段。官方用 UTC 定义（高峰 = UTC 01:00–04:00 与 06:00–10:00，
 * 周一至周五），所以判定固定走 getUTC*，**与运行机器时区无关**。
 * 注意这与本文件的 localDateKey 刻意相反：那里日界要和 SQLite 的 localtime 对齐
 * 才能把同一天归成一行，而这里要对齐的是官方定义，不是本机。
 *
 * 不排除中国法定节假日（官方口径含这一条）：实测偏差 $0.42 / $350.54 = 0.12%，
 * 方向恒为高估。见 design-docs/2026-09-25-deepseek-peak-pricing-design.md §2.5、§5。
 */
const DEEPSEEK_PEAK_SCHEDULE = {
  /** 半开区间 [start, end)，UTC 分钟数。 */
  windows: [
    { startMinute: 60, endMinute: 240 },
    { startMinute: 360, endMinute: 600 },
  ],
  /** 0 = 周日 … 6 = 周六，与 Date.getUTCDay() 及 src/shared/usage.ts 同一约定。 */
  weekdays: [1, 2, 3, 4, 5],
};

/**
 * 该时刻是否落在 DeepSeek 高峰时段。
 *
 * 跨窗口边界的流式请求按该行 ts 整体归一头，偏差 ≤ 一条请求，可忽略。
 */
export function isPeakAt(ts: number): boolean {
  const at = new Date(ts);
  if (!DEEPSEEK_PEAK_SCHEDULE.weekdays.includes(at.getUTCDay())) return false;
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  return DEEPSEEK_PEAK_SCHEDULE.windows.some(
    (window) => minute >= window.startMinute && minute < window.endMinute,
  );
}
