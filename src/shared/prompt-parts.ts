/**
 * 系统侧三块的量级：系统提示词本体 / 工具定义 / 技能清单。
 *
 * 三个数都是**估算的文本长度**，而且只是**权重**：真实用量只有 provider 报的
 * `totalPromptInput` 那一个数。渲染层拿它们把「总量 − 消息侧」的残差分成三行，
 * 主进程负责量（文本只在 SDK 手里），渲染层负责按比例分。
 *
 * `promptTokens` 不含技能段，三块互不重叠。
 */
export interface PromptParts {
  promptTokens: number;
  toolTokens: number;
  skillTokens: number;
}
