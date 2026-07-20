/**
 * 全局默认子 Agent 模型配置。
 * - "model"：固定 Provider Profile + 模型
 * - "inherit"：显式跟随主模型
 */
export type SubagentDefaultModel =
  | { mode: "model"; providerProfileKey: string; modelId: string }
  | { mode: "inherit" };

/** 子 Agent 整体配置（存储到 config store） */
export interface SubagentConfig {
  /** 全局默认子 Agent 模型 */
  defaultModel: SubagentDefaultModel;
}

/** 默认配置：跟随主模型 */
export const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
  defaultModel: { mode: "inherit" },
};
