import { DESKWAND_API_URL } from "../../shared/oauth-config";
import type { ApiProviderModel, SaveProviderPayload } from "../types";

export interface CloudMode {
  id: string;
  name: string;
  model: string;
}

/**
 * 构造 custom:deskwand provider 的保存 payload。
 * custom 分支在 config-store 中天然保留 baseUrl/models/defaultModel/apiKey，
 * deleteProvider 对 custom key 彻底删除——配置存储层无需改动。
 */
export function buildDeskwandProviderPayload(
  modes: CloudMode[],
  token: string,
): SaveProviderPayload {
  return {
    profileKey: "custom:deskwand",
    config: {
      provider: "custom",
      customProtocol: "openai",
      name: "DeskWand 云",
      baseUrl: `${DESKWAND_API_URL}/api/models`,
      apiKey: token,
      defaultModel:
        modes.find((m) => m.id === "standard")?.model ?? modes[0]?.model ?? "",
      // config-store 的 normalizeProviderModel 会把缺失的 source 默认成 "preset"，
      // 这里保持 payload 只含 id/label（与纯函数测试契约一致）。
      models: modes.map(
        (m) => ({ id: m.model, label: m.name }) as ApiProviderModel,
      ),
      updatedAt: new Date().toISOString(),
    },
  };
}
