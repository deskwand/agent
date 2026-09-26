/**
 * 价目表覆盖表 —— 上游（pi-ai）滞后的补价口子。
 *
 * 什么时候加一条：
 *  - pi-ai 注册表里没有的模型 id（deskwand 预置模型、relay 上的名字、上游改名后的新名）
 *  - pi-ai 注册表里的单价写错、过期，而我们知道正确的价
 * 什么时候删一条：pi-ai 追上之后 —— 同键覆盖会静默遮蔽内置值，留着就看不出上游已经修了。
 *
 * 键：`"供应商|模型"` 精确覆盖；`"*|模型"` 跨供应商兜底（用户 relay 与 deskwand 云的
 * provider id 都是运行期生成的，代码里枚举不出来，只能靠通配键）。
 * 值：USD / 1M tokens，与 pi-ai 注册表同口径；任一项为负会被当作无价目丢弃，0 是合法的
 * 免费价（GLM-4.6V-Flash 就是）。支持 `tiers`（按单次请求 prompt 大小分档），语义与
 * pi-ai 的 calculateCost 一致。
 * 优先级：覆盖表精确 → 内置精确 → 覆盖表通配 → 内置模型兜底（见 usage-cost.ts）。
 * DeepSeek 系模型不在本表：它们按时段定价，在文件尾部的 `MODEL_PEAK_PRICING` 里，
 * 且**同键不得同时出现在两张表**（单测钉住）。查价时计划命中即取代本表（见 usage-cost.ts）。
 *
 * 规矩：**每一条都要有可追溯的官方来源**（URL 或官方公告写进注释），查不到官方价的
 * 宁可留 `—`。下面是 2026-09-20 核过的 4 条。
 * 设计文档：design-docs/2026-09-20-usage-cost-design.md §3.1
 */
import type { ModelCost, ModelCostRates } from "@earendil-works/pi-ai";

export const MODEL_PRICE_OVERRIDES: Record<string, ModelCost> = {
  // xAI grok-code-fast-1 = 官方模型名 grok-build-0.1 的别名（同 grok-code-fast）。
  // 官方按单次 prompt 是否达到 200k 分档，达到后**整条请求**都按高价计 —— 与本表的
  // tiers 语义一致（本表判定用「>」，与 200k 边界差 1 token，可忽略）。
  // https://docs.x.ai/developers/pricing
  "*|grok-code-fast-1": {
    input: 1,
    output: 2,
    cacheRead: 0.2,
    cacheWrite: 0,
    tiers: [
      {
        inputTokensAbove: 200_000,
        input: 2,
        output: 4,
        cacheRead: 0.4,
        cacheWrite: 0,
      },
    ],
  },

  // 阿里云百炼 qwen-max，中国内地 USD 目录价（国际站是 1.6 / 6.4 / 0.32；Batch 半价）
  // https://docs.modelstudio.console.alibabacloud.com/zh/model-studio/qwen-max
  "*|qwen-max": {
    input: 0.345,
    output: 1.377,
    cacheRead: 0.072,
    cacheWrite: 0,
  },

  // 智谱 GLM-4.6V-Flash：官方定价页标注「完全免费」，所以 0 是真实价格而不是缺价 ——
  // 这正是页面要区分 `$0` 与 `—` 的原因。
  // https://open.bigmodel.cn/pricing
  "*|glm-4.6v-flash": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },

  // Anthropic Claude 3.7 Sonnet：官方已于 2026-02-19 退役，这里用官方最后公布价
  // （$3 / $15，缓存写 3.75、缓存读 0.30），只在 relay 上仍出现这个名字时作参考。
  // https://platform.claude.com/docs/en/about-claude/model-deprecations
  "*|claude-3-7-sonnet-latest": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
};

/**
 * 峰谷计划表 —— 按时段定价的模型（目前只有 DeepSeek）。
 *
 * 与覆盖表分开的理由：覆盖表一项只能存一个单价，表达不了「同一模型两档价」。
 * 两者共用一套键语法，且**同键不得同时出现在两张表**（单测钉住），否则无从判断该用哪套。
 *
 * 查价规则：**计划命中即取代价目表**，压过覆盖表/注册表的四级优先级链 ——
 * 一条计划本身就是一套完整的定价方案。挡的是「上游哪天给某个 DeepSeek 新 id
 * 补上精确键、或补一个错的价，计划被静默架空」。
 *
 * 规矩同覆盖表：每一条都要有可追溯的官方来源。下面是 2026-09-25 核过的 6 条，
 * 全部出自同一页的峰谷两列，逐行抄录（**不写成 `×0.5` 乘数**：乘数在官方改比例时
 * 会静默算错，抄两列才能与官方页逐行对账）。
 * https://api-docs.deepseek.com/quick_start/pricing/
 * 设计文档：design-docs/2026-09-25-deepseek-peak-pricing-design.md
 *
 * 两点须知：
 *  - 不排除中国法定节假日（官方口径含此条）：实测于含 1 个法定节假日的 75 天窗口，
 *    单日偏差 0.12%；按工作日高峰溢价的**均值**（$2.04/天，右偏，中位数只有
 *    $0.45）外推到一年 11 个工作日节假日，年化约 1%，方向恒为高估。
 *    design-docs/2026-09-25-deepseek-peak-pricing-design.md §2.5 有完整推导。
 *  - pi-ai 注册表里这两个模型的单价**恰好等于高峰价**（0.3/1.2/0.006 与
 *    1.32/3.96/0.044），所以本表落地之前是「全天按高峰算」的。
 *
 * **跨 provider 生效的代价**（有意为之，见 spec §1）：计划压过注册表的 provider 精确价，
 * 所以 opencode-go 的 deepseek-v4-pro（0.66/1.98/0.022，恰等于官方**空闲**价）在高峰
 * 时段口径价翻倍、opencode 的 deepseek-v4-pro（1.74/3.84/0.145）换成官方价。
 * 不想覆盖某个渠道时，只能把该渠道排除出计划表能力范围（当前无此口子）——
 * 目前本机 usage_records 里没有这两个 provider 的记录。
 */

const DEEPSEEK_FLASH_PEAK: ModelCostRates = {
  input: 0.3,
  output: 1.2,
  cacheRead: 0.006,
  cacheWrite: 0,
};
const DEEPSEEK_FLASH_OFFPEAK: ModelCostRates = {
  input: 0.15,
  output: 0.6,
  cacheRead: 0.003,
  cacheWrite: 0,
};

const DEEPSEEK_PRO_PEAK: ModelCostRates = {
  input: 1.32,
  output: 3.96,
  cacheRead: 0.044,
  cacheWrite: 0,
};
const DEEPSEEK_PRO_OFFPEAK: ModelCostRates = {
  input: 0.66,
  output: 1.98,
  cacheRead: 0.022,
  cacheWrite: 0,
};

/** 一档定价：高峰与空闲各一组单价。刻意不含 `tiers` —— DeepSeek 无分档。 */
export interface PeakRates {
  peak: ModelCostRates;
  offPeak: ModelCostRates;
}

/**
 * 键一律是 `*|模型`：与覆盖表同一套键语法，`*` 表示计划对所有 provider 生效
 * （deskwand 云与用户 relay 的 provider id 都是运行期生成的，枚举不出来）。
 * 值是人手写的字面量，不做运行期负价守卫 —— 由 usage-cost.test.ts 的不变量用例钉住。
 */
export const MODEL_PEAK_PRICING: Record<string, PeakRates> = {
  // deepseek-flash = DeepSeek-V4.1-Flash（2026-09-10 官方改名）。
  "*|deepseek-flash": {
    peak: DEEPSEEK_FLASH_PEAK,
    offPeak: DEEPSEEK_FLASH_OFFPEAK,
  },
  // 旧名：官方仍接受，但对应模型已退役，请求由 V4.1-Flash 承接并按 Flash 计价。
  "*|deepseek-v4-flash": {
    peak: DEEPSEEK_FLASH_PEAK,
    offPeak: DEEPSEEK_FLASH_OFFPEAK,
  },
  "*|deepseek-v4-flash-vision-exp": {
    peak: DEEPSEEK_FLASH_PEAK,
    offPeak: DEEPSEEK_FLASH_OFFPEAK,
  },
  // 退役名：2026-07-24 官方停用，停用前分别指向 v4-flash 的非思考/思考模式。
  // 本机 usage_records 里零记录，保留纯为 relay 上仍可能出现这两个通用名。
  "*|deepseek-chat": {
    peak: DEEPSEEK_FLASH_PEAK,
    offPeak: DEEPSEEK_FLASH_OFFPEAK,
  },
  "*|deepseek-reasoner": {
    peak: DEEPSEEK_FLASH_PEAK,
    offPeak: DEEPSEEK_FLASH_OFFPEAK,
  },
  // deepseek-v4-pro = DeepSeek-V4-Pro-0813。
  "*|deepseek-v4-pro": {
    peak: DEEPSEEK_PRO_PEAK,
    offPeak: DEEPSEEK_PRO_OFFPEAK,
  },
};
