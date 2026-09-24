export interface CodingSubscription {
  profileKey: string;
  name: string;
  baseUrl: string;
  modelIds: readonly string[];
  defaultModel: string;
  keyUrl: string;
  termsUrl: string;
  noteKey: string;
}

// Subscription endpoints are deliberately separate from pay-as-you-go APIs.
export const CODING_SUBSCRIPTIONS: readonly CodingSubscription[] = [
  {
    profileKey: "custom:subscription-bailian-coding",
    name: "百炼 Coding Plan",
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    modelIds: ["qwen3.7-plus", "kimi-k2.5", "glm-5"],
    defaultModel: "qwen3.7-plus",
    keyUrl:
      "https://bailian.console.aliyun.com/cn-beijing/subscription/coding-plan",
    termsUrl: "https://help.aliyun.com/zh/model-studio/more-tools",
    noteKey: "api.subscriptionBailianNote",
  },
  {
    profileKey: "custom:subscription-ark-coding",
    name: "火山方舟 Coding Plan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    modelIds: ["ark-code-latest", "doubao-seed-2.1-pro"],
    defaultModel: "ark-code-latest",
    keyUrl: "https://ark.volcengine.com/region:cn-beijing/apikey",
    termsUrl: "https://docs.volcengine.com/docs/82379/2188959?lang=zh",
    noteKey: "api.subscriptionArkNote",
  },
];

export function getCodingSubscription(
  key: string,
): CodingSubscription | undefined {
  return CODING_SUBSCRIPTIONS.find((plan) => plan.profileKey === key);
}

export function isCodingSubscriptionProfileKey(key: string): boolean {
  return getCodingSubscription(key) !== undefined;
}
