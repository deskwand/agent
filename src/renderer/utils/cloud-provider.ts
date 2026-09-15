import { DESKWAND_API_URL } from "../../shared/oauth-config";
import type { ApiProviderModel, SaveProviderPayload } from "../types";

/**
 * 构造 custom:deskwand provider 的保存 payload。
 * 模型名直接用服务端下发的真实模型 id（保留原始模型名称，不再有模式名）。
 * pricing 按 model_id 升序返回，因此首个模型即兜底默认模型。
 *
 * preferredDefaultModel 用于启动时重建 payload：用户之前选的默认模型如果仍在列表里
 * 就沿用，否则回落到首个模型；不传则直接用首个模型。
 */
export function buildDeskwandProviderPayload(
  models: Array<{ model_id: string }>,
  token: string,
  t?: (key: string, opts?: { defaultValue: string }) => string,
  preferredDefaultModel?: string,
): SaveProviderPayload {
  return {
    profileKey: "custom:deskwand",
    config: {
      provider: "custom",
      customProtocol: "openai",
      name: t
        ? t("providers.deskwandCloud", { defaultValue: "DeskWand 云" })
        : "DeskWand 云",
      baseUrl: `${DESKWAND_API_URL}/api/models`,
      apiKey: token,
      defaultModel:
        preferredDefaultModel &&
        models.some((m) => m.model_id === preferredDefaultModel)
          ? preferredDefaultModel
          : (models[0]?.model_id ?? ""),
      // config-store 的 normalizeProviderModel 会把缺失的 source 默认成 "preset"，
      // 这里保持 payload 只含 id/label（与纯函数测试契约一致）。
      models: models.map(
        (m) =>
          ({
            id: m.model_id,
            label: m.model_id,
          }) as ApiProviderModel,
      ),
      updatedAt: new Date().toISOString(),
    },
  };
}
