/** 子 Agent 配置（存储到 config store）。保留向后兼容，当前未使用。 */
export interface SubagentConfig {
  defaultModel?: {
    mode: "model" | "inherit";
    providerProfileKey?: string;
    modelId?: string;
  };
}
