import type { SharedCustomProtocolType } from "./api-model-presets";

export type LocalGatewayId = "magpie";

export interface LocalGatewayPreset {
  id: LocalGatewayId;
  name: string;
  baseUrl: string;
  defaultApiKey: string;
  protocol: SharedCustomProtocolType;
  /** 模型 id 原样发给端点，不做注册表剥前缀 */
  passthroughModelIds: boolean;
  docsUrl: string;
  /** 编辑弹窗里密钥字段下方的提示文案 key */
  keyHintKey: string;
}

export interface LocalGatewayProbeResult {
  available: boolean;
  modelCount?: number;
}

export type LocalGatewayProbeState =
  | { state: "probing" }
  | { state: "available"; modelCount?: number }
  | { state: "unavailable" };

export const LOCAL_GATEWAY_PRESETS: readonly LocalGatewayPreset[] = [
  {
    id: "magpie",
    name: "Magpie",
    baseUrl: "http://127.0.0.1:3425/v1",
    defaultApiKey: "magpie",
    protocol: "openai",
    passthroughModelIds: true,
    docsUrl: "https://usemagpie.ai/",
    keyHintKey: "api.localGatewayKeyHint",
  },
];

export function getLocalGatewayPreset(
  id: string | undefined,
): LocalGatewayPreset | undefined {
  return LOCAL_GATEWAY_PRESETS.find((preset) => preset.id === id);
}

export function isLocalGatewayId(value: unknown): value is LocalGatewayId {
  return (
    typeof value === "string" &&
    LOCAL_GATEWAY_PRESETS.some((preset) => preset.id === value)
  );
}

export function shouldPreserveModelId(
  profile: { localGateway?: LocalGatewayId } | undefined,
): boolean {
  return Boolean(
    getLocalGatewayPreset(profile?.localGateway)?.passthroughModelIds,
  );
}
