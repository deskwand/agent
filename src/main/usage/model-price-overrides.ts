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
 *
 * 规矩：**每一条都要有可追溯的官方来源**（URL 或官方公告写进注释），查不到官方价的
 * 宁可留 `—`。下面是 2026-09-20 核过的 7 条。
 * 设计文档：design-docs/2026-09-20-usage-cost-design.md §3.1
 */
import type { ModelCost } from "@earendil-works/pi-ai";

const DEEPSEEK_FLASH: ModelCost = {
  // 官方是峰谷定价（空闲价 = 高峰价的一半；高峰 = 北京时间周一至周五 9:00-12:00、14:00-18:00），
  // 而本表每项只能存一个单价，所以取两档均值：最坏偏差 ±33%，比按任一档都少偏。
  //   高峰  input 0.3   / output 1.2 / cacheRead 0.006
  //   空闲  input 0.15  / output 0.6 / cacheRead 0.003
  // 如果用量明显集中在工作日白天，把下面三个数换成高峰档即可。
  input: 0.225,
  output: 0.9,
  cacheRead: 0.0045,
  cacheWrite: 0,
};

export const MODEL_PRICE_OVERRIDES: Record<string, ModelCost> = {
  // deepseek-flash = DeepSeek-V4.1-Flash，2026-09-10 上线，官方把模型名从
  // deepseek-v4-flash 改成了 deepseek-flash（旧名仍接受但已路由到同一模型）。
  // https://api-docs.deepseek.com/quick_start/pricing/
  "*|deepseek-flash": DEEPSEEK_FLASH,

  // deepseek-chat / deepseek-reasoner：官方公告已于 2026-07-24 停止使用，停用前分别指向
  // deepseek-v4-flash 的非思考/思考模式，而该模型现已按 V4.1 Flash 计价，所以套用同一组数。
  // 保留在表里是因为不少 relay 仍在用这两个通用名字。
  // https://api-docs.deepseek.com/zh-cn/updates/
  "*|deepseek-chat": DEEPSEEK_FLASH,
  "*|deepseek-reasoner": DEEPSEEK_FLASH,

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
